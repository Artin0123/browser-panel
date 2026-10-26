import * as vscode from 'vscode';

export interface BrowserConfig {
	defaultUrl: string;
	retainContextWhenHidden: boolean;
	historyLimit: number;
	proxyEnabled: boolean;
	acceptSelfSignedCerts: boolean;
}

export function getConfig(): BrowserConfig {
	const cfg = vscode.workspace.getConfiguration('browser');
	// Defensive reads: settings are user-editable and may hold the wrong type
	// (e.g. historyLimit: "abc" from settings.json sync), which would otherwise
	// propagate NaN/string into runtime logic.
	const rawLimit = cfg.get<unknown>('historyLimit', 200);
	const rawUrl = cfg.get<unknown>('defaultUrl', 'http://localhost:80');
	return {
		defaultUrl: typeof rawUrl === 'string' ? rawUrl : 'http://localhost:80',
		retainContextWhenHidden: cfg.get<boolean>('retainContextWhenHidden', true),
		historyLimit:
			typeof rawLimit === 'number' && Number.isFinite(rawLimit)
				? Math.min(10000, Math.max(1, Math.floor(rawLimit)))
				: 200,
		proxyEnabled: cfg.get<boolean>('proxyEnabled', false),
		acceptSelfSignedCerts: cfg.get<boolean>('acceptSelfSignedCerts', true),
	};
}
