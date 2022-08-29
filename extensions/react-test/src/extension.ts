/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { stringify } from 'yaml';

import { FlatConfigEditor } from './flatConfigEditor';
import { UiProviderPanel } from './uiProviderPanel';

export async function activate(extension: vscode.ExtensionContext) {
	const editor = FlatConfigEditor.register(extension);
	extension.subscriptions.push(editor);

	extension.subscriptions.push(vscode.commands.registerCommand('flat.showPreview', () => showEditor({ isPreview: true, onSide: false })));
	extension.subscriptions.push(vscode.commands.registerCommand('flat.showRaw', () => showEditor({ isPreview: false, onSide: false })));
	extension.subscriptions.push(vscode.commands.registerCommand('flat.showPreviewToSide', () => showEditor({ isPreview: true, onSide: true })));
	extension.subscriptions.push(vscode.commands.registerCommand('flat.showRawToSide', () => showEditor({ isPreview: false, onSide: true })));
	extension.subscriptions.push(vscode.commands.registerCommand('flat.initializeFlatYml', async () => await initializeFlatYml()));
	extension.subscriptions.push(vscode.commands.registerCommand('reactTest.go', () => showEditor({ isPreview: true })));
	extension.subscriptions.push(vscode.commands.registerCommand('reactTest.launch', async () => await UiProviderPanel.render(extension)));
}

async function initializeFlatYml(): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;

	if (!folders) {
		return;
	}
	const rootPath: vscode.WorkspaceFolder = folders[0];

	const workflowsDir = path.join(rootPath.uri.fsPath, '.github/workflows');
	const flatYmlPath = path.join(workflowsDir, 'flat.yml');

	if (fs.existsSync(flatYmlPath)) {
		showEditor({ isPreview: true });
		return;
	}

	fs.mkdirSync(workflowsDir, { recursive: true });

	const flatStub = {
		name: 'data',
		on: {
			schedule: [{ cron: '0 0 * * *' }],
			workflow_dispatch: {},
			push: {
				paths: ['.github/workflows/flat.yml'],
			},
		},
		jobs: {
			scheduled: {
				'runs-on': 'ubuntu-latest',
				steps: [
					{
						name: 'Setup deno',
						uses: 'denoland/setup-deno@main',
						with: {
							'deno-version': 'v1.10.x',
						},
					},
					{
						name: 'Check out repo',
						uses: 'actions/checkout@v2',
					},
				],
			},
		},
	};

	fs.writeFileSync(path.join(workflowsDir, 'flat.yml'), stringify(flatStub));
	showEditor({ isPreview: true });
}

function showEditor({ isPreview = false, onSide = false }: { isPreview?: boolean, onSide?: boolean }) {
	const workspaceRootUri = vscode.workspace.workspaceFolders?.[0].uri;

	if (!workspaceRootUri) {
		return;
	}

	const flatFileUri = vscode.Uri.joinPath(
		workspaceRootUri,
		'.github/workflows',
		'flat.yml'
	);

	vscode.commands.executeCommand(
		'vscode.openWith',
		flatFileUri,
		isPreview ? 'flat.config' : 'default',
		onSide ? { viewColumn: vscode.ViewColumn.Beside, preview: false } : {}
	);
}