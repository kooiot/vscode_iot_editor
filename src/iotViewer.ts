'use strict';

import * as vscode from 'vscode';
import { dirname } from 'path';
import * as client from './client';
import { FsModel, IOTNode } from './iotExplorer';


export class IOTTreeDataProvider implements vscode.TreeDataProvider<IOTNode>, vscode.TextDocumentContentProvider  {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

	constructor(private readonly model: FsModel) { }

	public refresh(): any {
		this._onDidChangeTreeData.fire();
	}

	public reload(node: IOTNode): any {
		this._onDidChange.fire(node.resource);
	}

	public getTreeItem(element: IOTNode): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			collapsibleState: element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
			contextValue: 'IOTViewer',
			command: element.isDirectory ? void 0 : {
				command: 'IOTViewer.openFile',
				arguments: [element.resource],
				title: 'Open IOT Resource'
			}
		};
	}

	public getChildren(element?: IOTNode): IOTNode[] | Thenable<IOTNode[]> {
		return element ? this.model.getChildren(element) : this.model.roots;
	}

	public getParent(element: IOTNode): IOTNode | undefined {
		const parent = element.resource.with({ path: dirname(element.resource.path) });
		const app = element.app;
		return parent.path !== '//' ? { resource: parent, app: app, isDirectory: true } : undefined;
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		return this.model.getContent(uri).then(content => content);
	}
}

export class IOTViewer {
	private iotModel: FsModel;
	private treeDataProvider: IOTTreeDataProvider;
	private iotViewer: vscode.TreeView<IOTNode>;

	constructor(context: vscode.ExtensionContext, device_client: client.Client) {
		this.iotModel = new FsModel(device_client, 'iot');

		this.treeDataProvider = new IOTTreeDataProvider(this.iotModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('iot', this.treeDataProvider));
		this.iotViewer = vscode.window.createTreeView('IOTViewer', { treeDataProvider: this.treeDataProvider });

		vscode.commands.registerCommand('IOTViewer.refresh', () => this.treeDataProvider.refresh());
		vscode.commands.registerCommand('IOTViewer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTViewer.revealResource', () => this.reveal());
		
		vscode.commands.registerCommand('IOTViewer.reload', (node) => this.treeDataProvider.reload(node));
		vscode.commands.registerCommand('IOTViewer.applicationStart', (node) => this.iotModel.applicationStart(node));
		vscode.commands.registerCommand('IOTViewer.applicationStop', (node) => this.iotModel.applicationStop(node));
		vscode.commands.registerCommand('IOTViewer.applicationRestart', (node) => this.iotModel.applicationRestart(node));
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource, {preserveFocus: true});
	}

	private reveal(): void {
		const node = this.getNode();
		if (node) {
			this.iotViewer.reveal(node);
		}
	}

	private getNode(): IOTNode | undefined {
		if (vscode.window.activeTextEditor) {
			let uri = vscode.window.activeTextEditor.document.uri;
			if (uri.scheme === 'iot') {
				let node = this.iotModel.parse_uri(uri);
				return { resource: uri, app:node.app, isDirectory: false };
			}
		}
		return undefined;
	}

	public onInterval() {
		//this.treeDataProvider.onInterval();
	}
}