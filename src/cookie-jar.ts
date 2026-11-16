export interface StoredCookie {
	name: string;
	value: string;
	domain: string;
	hostOnly: boolean;
	path: string;
	secure: boolean;
	expiresAt: number | null;
	createdAt: number;
	lastUsed: number;
}

export const MAX_COOKIES_PER_ORIGIN = 50;
export const MAX_COOKIES_TOTAL = 300;
export const MAX_JAR_SERIALIZED_BYTES = 64 * 1024;

function isIpAddress(host: string): boolean {
	// IPv4 or bracketed/colon IPv6
	return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** RFC 6265 §5.1.3 domain-match. Both inputs must be lowercase hostnames. */
export function domainMatch(reqHost: string, cookieDomain: string): boolean {
	if (reqHost === cookieDomain) {
		return true;
	}
	if (isIpAddress(reqHost) || isIpAddress(cookieDomain)) {
		return false;
	}
	return reqHost.endsWith('.' + cookieDomain);
}

/** RFC 6265 §5.1.4 default-path algorithm. */
export function defaultPath(uriPath: string): string {
	if (!uriPath || uriPath[0] !== '/') {
		return '/';
	}
	const lastSlash = uriPath.lastIndexOf('/');
	if (lastSlash <= 0) {
		return '/';
	}
	return uriPath.slice(0, lastSlash);
}

/** RFC 6265 §5.1.4 path-match algorithm. */
export function pathMatch(reqPath: string, cookiePath: string): boolean {
	if (reqPath === cookiePath) {
		return true;
	}
	if (!reqPath.startsWith(cookiePath)) {
		return false;
	}
	return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}

function cookieKey(name: string, domain: string, path: string): string {
	return `${name}|${domain}|${path}`;
}

/**
 * Pure-Node extension-host cookie jar (RFC 6265 subset), keyed by target origin.
 * Cookies never enter the webview/browser: Set-Cookie is stripped from responses
 * and outgoing Cookie headers are assembled here.
 */
export class CookieJar {
	private readonly _origins = new Map<string, Map<string, StoredCookie>>();

	constructor(private readonly _onChange?: () => void) {}

	/** Total number of stored cookies across all origins. */
	size(): number {
		let count = 0;
		for (const map of this._origins.values()) {
			count += map.size;
		}
		return count;
	}

	/** Remove all stored cookies. */
	clear(): void {
		if (this._origins.size === 0) {
			return;
		}
		this._origins.clear();
		this._onChange?.();
	}

	/** Parse a single Set-Cookie header value and store/delete it for targetUrl.origin. */
	receive(targetUrl: URL, setCookieHeader: string, isHttps: boolean, now = Date.now()): void {
		if (!setCookieHeader || typeof setCookieHeader !== 'string') {
			return;
		}
		const parts = setCookieHeader.split(';');
		const nameValue = parts[0];
		const eqIdx = nameValue.indexOf('=');
		if (eqIdx <= 0) {
			return; // missing '=' or empty cookie name
		}
		const name = nameValue.slice(0, eqIdx).trim();
		if (!name) {
			return;
		}
		const value = nameValue.slice(eqIdx + 1).trim();

		const reqHost = targetUrl.hostname.toLowerCase();
		let domainAttr: string | undefined;
		let pathAttr: string | undefined;
		let secure = false;
		let maxAge: number | undefined;
		let expires: number | undefined;

		for (let i = 1; i < parts.length; i++) {
			const seg = parts[i].trim();
			if (!seg) {
				continue;
			}
			const attrEq = seg.indexOf('=');
			const attrName = (attrEq === -1 ? seg : seg.slice(0, attrEq)).trim().toLowerCase();
			const attrVal = attrEq === -1 ? '' : seg.slice(attrEq + 1).trim();

			switch (attrName) {
				case 'domain': {
					const normalized = attrVal.replace(/^\.+/, '').toLowerCase();
					if (normalized) {
						domainAttr = normalized;
					}
					break;
				}
				case 'path':
					if (attrVal.startsWith('/')) {
						pathAttr = attrVal;
					}
					break;
				case 'secure':
					secure = true;
					break;
				case 'max-age':
					if (/^-?\d+$/.test(attrVal)) {
						maxAge = Number(attrVal);
					}
					break;
				case 'expires': {
					const parsed = Date.parse(attrVal);
					if (!Number.isNaN(parsed)) {
						expires = parsed;
					}
					break;
				}
				// SameSite and HttpOnly are intentionally ignored: the proxy is the HTTP
				// client, so there is no cross-site browser context or document.cookie.
				default:
					break;
			}
		}

		let domain: string;
		let hostOnly: boolean;
		if (domainAttr !== undefined) {
			if (!domainMatch(reqHost, domainAttr)) {
				return; // reject cookies whose Domain does not domain-match the request host
			}
			domain = domainAttr;
			hostOnly = false;
		} else {
			domain = reqHost;
			hostOnly = true;
		}

		const path = pathAttr ?? defaultPath(targetUrl.pathname);

		let expiresAt: number | null = null;
		if (maxAge !== undefined) {
			expiresAt = maxAge <= 0 ? 0 : now + maxAge * 1000;
		} else if (expires !== undefined) {
			expiresAt = expires;
		}

		const origin = targetUrl.origin;
		const key = cookieKey(name, domain, path);
		let originMap = this._origins.get(origin);

		if (expiresAt !== null && expiresAt <= now) {
			if (originMap?.delete(key)) {
				if (originMap.size === 0) {
					this._origins.delete(origin);
				}
				this._onChange?.();
			}
			return;
		}

		if (!originMap) {
			originMap = new Map();
			this._origins.set(origin, originMap);
		}

		const existing = originMap.get(key);
		originMap.set(key, {
			name,
			value,
			domain,
			hostOnly,
			path,
			secure,
			expiresAt,
			createdAt: existing ? existing.createdAt : now,
			lastUsed: now,
		});

		this._pruneExpired(now);
		this._enforceLimits(originMap);
		this._onChange?.();
	}

	/** Assemble the Cookie header value for an outgoing request, or '' if none match. */
	send(targetUrl: URL, isHttps: boolean, now = Date.now()): string {
		const originMap = this._origins.get(targetUrl.origin);
		if (!originMap || originMap.size === 0) {
			return '';
		}
		const reqHost = targetUrl.hostname.toLowerCase();
		const reqPath = targetUrl.pathname || '/';
		const matched: StoredCookie[] = [];
		let expiredAny = false;

		for (const [key, cookie] of originMap) {
			if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
				originMap.delete(key);
				expiredAny = true;
				continue;
			}
			if (cookie.secure && !isHttps) {
				continue;
			}
			const hostOk = cookie.hostOnly
				? reqHost === cookie.domain
				: domainMatch(reqHost, cookie.domain);
			if (!hostOk || !pathMatch(reqPath, cookie.path)) {
				continue;
			}
			cookie.lastUsed = now;
			matched.push(cookie);
		}

		if (originMap.size === 0) {
			this._origins.delete(targetUrl.origin);
		}
		if (expiredAny) {
			this._onChange?.();
		}

		if (matched.length === 0) {
			return '';
		}

		matched.sort((a, b) => {
			if (b.path.length !== a.path.length) {
				return b.path.length - a.path.length;
			}
			return a.createdAt - b.createdAt;
		});

		return matched.map((c) => `${c.name}=${c.value}`).join('; ');
	}

	/** Serialize the jar to JSON (<= 64 KB), pruning expired entries first. */
	serialize(now = Date.now()): string {
		this._pruneExpired(now);
		let json = this._toJson();
		while (Buffer.byteLength(json, 'utf8') > MAX_JAR_SERIALIZED_BYTES && this._evictOldestGlobal()) {
			json = this._toJson();
		}
		return json;
	}

	/** Restore jar state from serialized JSON. Malformed input is ignored safely. */
	load(json: string, now = Date.now()): void {
		if (!json || typeof json !== 'string') {
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(json);
		} catch {
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return;
		}

		this._origins.clear();
		for (const [origin, list] of Object.entries(parsed as Record<string, unknown>)) {
			if (!Array.isArray(list)) {
				continue;
			}
			const originMap = new Map<string, StoredCookie>();
			for (const item of list) {
				if (!item || typeof item !== 'object') {
					continue;
				}
				const c = item as Partial<StoredCookie>;
				if (
					typeof c.name !== 'string' ||
					!c.name ||
					typeof c.value !== 'string' ||
					typeof c.domain !== 'string' ||
					!c.domain ||
					typeof c.hostOnly !== 'boolean' ||
					typeof c.path !== 'string' ||
					!c.path.startsWith('/') ||
					typeof c.secure !== 'boolean' ||
					(c.expiresAt !== null && (typeof c.expiresAt !== 'number' || !Number.isFinite(c.expiresAt))) ||
					typeof c.createdAt !== 'number' ||
					!Number.isFinite(c.createdAt) ||
					typeof c.lastUsed !== 'number' ||
					!Number.isFinite(c.lastUsed)
				) {
					continue;
				}
				if (c.expiresAt !== null && c.expiresAt <= now) {
					continue;
				}
				const key = cookieKey(c.name, c.domain, c.path);
				originMap.set(key, {
					name: c.name,
					value: c.value,
					domain: c.domain,
					hostOnly: c.hostOnly,
					path: c.path,
					secure: c.secure,
					expiresAt: c.expiresAt,
					createdAt: c.createdAt,
					lastUsed: c.lastUsed,
				});
			}
			if (originMap.size > 0) {
				this._origins.set(origin, originMap);
				this._enforcePerOriginLimit(originMap);
			}
		}
		while (this.size() > MAX_COOKIES_TOTAL && this._evictOldestGlobal()) {
			// trim to global cap
		}
	}

	private _toJson(): string {
		const obj: Record<string, StoredCookie[]> = {};
		for (const [origin, map] of this._origins) {
			if (map.size > 0) {
				obj[origin] = [...map.values()];
			}
		}
		return JSON.stringify(obj);
	}

	private _pruneExpired(now: number): void {
		for (const [origin, map] of this._origins) {
			for (const [key, cookie] of map) {
				if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
					map.delete(key);
				}
			}
			if (map.size === 0) {
				this._origins.delete(origin);
			}
		}
	}

	private _enforcePerOriginLimit(originMap: Map<string, StoredCookie>): void {
		while (originMap.size > MAX_COOKIES_PER_ORIGIN) {
			let oldestKey: string | undefined;
			let oldestUsed = Infinity;
			for (const [key, cookie] of originMap) {
				if (cookie.lastUsed < oldestUsed) {
					oldestUsed = cookie.lastUsed;
					oldestKey = key;
				}
			}
			if (oldestKey === undefined) {
				break;
			}
			originMap.delete(oldestKey);
		}
	}

	private _evictOldestGlobal(): boolean {
		let targetOrigin: string | undefined;
		let targetKey: string | undefined;
		let oldestUsed = Infinity;

		for (const [origin, map] of this._origins) {
			for (const [key, cookie] of map) {
				if (cookie.lastUsed < oldestUsed) {
					oldestUsed = cookie.lastUsed;
					targetOrigin = origin;
					targetKey = key;
				}
			}
		}

		if (targetOrigin === undefined || targetKey === undefined) {
			return false;
		}
		const map = this._origins.get(targetOrigin);
		if (!map) {
			return false;
		}
		map.delete(targetKey);
		if (map.size === 0) {
			this._origins.delete(targetOrigin);
		}
		return true;
	}

	private _enforceLimits(originMap: Map<string, StoredCookie>): void {
		this._enforcePerOriginLimit(originMap);
		while (this.size() > MAX_COOKIES_TOTAL && this._evictOldestGlobal()) {
			// trim to global cap
		}
	}
}
