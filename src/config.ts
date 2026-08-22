import * as vscode from 'vscode';

export interface BrowserConfig {
	defaultUrl: string;
	retainContextWhenHidden: boolean;
	historyLimit: number;
	proxyEnabled: boolean;
}

export function getConfig(): BrowserConfig {
	const cfg = vscode.workspace.getConfiguration('browser');
	return {
		defaultUrl: cfg.get<string>('defaultUrl', 'http://localhost:80'),
		retainContextWhenHidden: cfg.get<boolean>('retainContextWhenHidden', true),
		historyLimit: cfg.get<number>('historyLimit', 200),
		proxyEnabled: cfg.get<boolean>('proxyEnabled', false),
	};
}
