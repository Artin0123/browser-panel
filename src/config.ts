import * as vscode from 'vscode';

export interface BrowserConfig {
	defaultUrl: string;
	retainContextWhenHidden: boolean;
	proxyEnabled: boolean;
}

export function getConfig(): BrowserConfig {
	const cfg = vscode.workspace.getConfiguration('browser');
	const rawUrl = cfg.get<unknown>('defaultUrl', 'http://localhost:80');
	return {
		defaultUrl: typeof rawUrl === 'string' ? rawUrl : 'http://localhost:80',
		retainContextWhenHidden: cfg.get<boolean>('retainContextWhenHidden', true),
		proxyEnabled: cfg.get<boolean>('proxyEnabled', false),
	};
}
