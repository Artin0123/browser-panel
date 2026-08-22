import * as vscode from 'vscode';

/**
 * Minimal runtime localization for extension-host strings.
 * Supported: en (fallback), zh-CN, zh-TW.
 */
export function localize(en: string, zhCn: string, zhTw: string): string {
	const lang = (vscode.env.language || '').toLowerCase();
	if (lang.startsWith('zh')) {
		return lang.includes('tw') || lang.includes('hant') ? zhTw : zhCn;
	}
	return en;
}
