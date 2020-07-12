/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { extname } from 'path';

import { Command } from '../commandManager';
import { MarkdownEngine } from '../markdownEngine';
import { TableOfContentsProvider } from '../tableOfContentsProvider';
import { isMarkdownFile } from '../util/file';


export interface OpenDocumentLinkArgs {
	readonly path: string;
	readonly fragment: string;
	readonly fromResource: any;
}

enum OpenMarkdownLinks {
	beside = 'beside',
	currentGroup = 'currentGroup',
}

export class OpenDocumentLinkCommand implements Command {
	private static readonly id = '_markdown.openDocumentLink';
	public readonly id = OpenDocumentLinkCommand.id;

	public static createCommandUri(
		fromResource: vscode.Uri,
		path: string,
		fragment: string,
	): vscode.Uri {
		return vscode.Uri.parse(`command:${OpenDocumentLinkCommand.id}?${encodeURIComponent(JSON.stringify(<OpenDocumentLinkArgs>{
			path: encodeURIComponent(path),
			fragment,
			fromResource: encodeURIComponent(fromResource.toString(true)),
		}))}`);
	}

	public constructor(
		private readonly engine: MarkdownEngine
	) { }

	public async execute(args: OpenDocumentLinkArgs) {
		const fromResource = vscode.Uri.parse(decodeURIComponent(args.fromResource));
		const targetPath = decodeURIComponent(args.path);
		const targetResource = vscode.Uri.file(targetPath);
		const column = this.getViewColumn(fromResource);
		try {
			return await this.tryOpen(targetResource, args, column);
		} catch {
			if (extname(targetResource.path) === '') {
				return this.tryOpen(targetResource.with({ path: targetResource.path + '.md' }), args, column);
			}
			await vscode.commands.executeCommand('vscode.open', targetResource, column);
			return undefined;
		}
	}

	private async tryOpen(resource: vscode.Uri, args: OpenDocumentLinkArgs, column: vscode.ViewColumn) {
		if (vscode.window.activeTextEditor && isMarkdownFile(vscode.window.activeTextEditor.document)) {
			if (vscode.window.activeTextEditor.document.uri.fsPath === resource.fsPath) {
				return this.tryRevealLine(vscode.window.activeTextEditor, args.fragment);
			}
		}

		const stat = await vscode.workspace.fs.stat(resource);
		if (stat.type === vscode.FileType.Directory) {
			return vscode.commands.executeCommand('revealInExplorer', resource);
		}

		return vscode.workspace.openTextDocument(resource)
			.then(document => vscode.window.showTextDocument(document, column))
			.then(editor => this.tryRevealLine(editor, args.fragment));
	}

	private getViewColumn(resource: vscode.Uri): vscode.ViewColumn {
		const config = vscode.workspace.getConfiguration('markdown', resource);
		const openLinks = config.get<OpenMarkdownLinks>('links.openLocation', OpenMarkdownLinks.currentGroup);
		switch (openLinks) {
			case OpenMarkdownLinks.beside:
				return vscode.ViewColumn.Beside;
			case OpenMarkdownLinks.currentGroup:
			default:
				return vscode.ViewColumn.Active;
		}
	}

	private async tryRevealLine(editor: vscode.TextEditor, fragment?: string) {
		if (editor && fragment) {
			const toc = new TableOfContentsProvider(this.engine, editor.document);
			const entry = await toc.lookup(fragment);
			if (entry) {
				return editor.revealRange(new vscode.Range(entry.line, 0, entry.line, 0), vscode.TextEditorRevealType.AtTop);
			}
			const lineNumberFragment = fragment.match(/^L(\d+)$/i);
			if (lineNumberFragment) {
				const line = +lineNumberFragment[1] - 1;
				if (!isNaN(line)) {
					return editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
				}
			}
		}
	}
}


export async function resolveLinkToMarkdownFile(path: string): Promise<vscode.Uri | undefined> {
	try {
		const standardLink = await tryResolveLinkToMarkdownFile(path);
		if (standardLink) {
			return standardLink;
		}
	} catch {
		// Noop
	}

	// If no extension, try with `.md` extension
	if (extname(path) === '') {
		return tryResolveLinkToMarkdownFile(path + '.md');
	}

	return undefined;
}

async function tryResolveLinkToMarkdownFile(path: string): Promise<vscode.Uri | undefined> {
	const resource = vscode.Uri.file(path);

	let document: vscode.TextDocument;
	try {
		document = await vscode.workspace.openTextDocument(resource);
	} catch {
		return undefined;
	}
	if (isMarkdownFile(document)) {
		return document.uri;
	}
	return undefined;
}
