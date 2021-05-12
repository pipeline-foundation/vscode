/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import type * as vscode from 'vscode';

export interface WebviewInitData {
	readonly isExtensionDevelopmentDebug: boolean;
	readonly webviewResourceRoot: string;
	readonly webviewCspSource: string;
	readonly remote: { readonly authority: string | undefined };
}

/**
 * Construct a uri that can load resources inside a webview
 *
 * We encode the resource component of the uri so that on the main thread
 * we know where to load the resource from (remote or truly local):
 *
 * ```txt
 * /remote-authority?/scheme/resource-authority/path...
 * ```
 */
export function asWebviewUri(
	initData: WebviewInitData,
	uuid: string,
	resource: vscode.Uri,
): vscode.Uri {
	const uri = initData.webviewResourceRoot
		.replace('{{resource}}', (initData.remote.authority ?? '') + '/' + resource.scheme + '/' + encodeURIComponent(resource.authority) + resource.path)
		.replace('{{uuid}}', uuid);
	return URI.parse(uri).with({
		fragment: resource.fragment,
		query: resource.query,
	});
}
