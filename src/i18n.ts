import * as vscode from 'vscode';

/**
 * Minimal runtime localization for extension-host strings.
 * Supported: en (fallback), zh-CN, zh-TW/HK/MO (Traditional).
 */
export function localize(en: string, zhCn: string, zhTw: string): string {
	const lang = (vscode.env.language || '').toLowerCase();
	if (lang.startsWith('zh')) {
		// tw/hk/mo (and explicit hant) use Traditional Chinese; the rest default to Simplified.
		return lang.includes('hant') || lang.includes('tw') || lang.includes('hk') || lang.includes('mo')
			? zhTw
			: zhCn;
	}
	return en;
}
