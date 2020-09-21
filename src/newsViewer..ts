'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { ClientMgr } from './client_mgr';


export interface NewNode {
	resource: vscode.Uri;
	folder?: boolean;
	label: string;
	uri: vscode.Uri;
}

export class IOTNewsModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly mgr: ClientMgr) {
	}

	public get roots() : Thenable<NewNode[]> {
		return new Promise((c, e) => {
			return c([]);
		});
	}
	
	public getChildren(node: NewNode): NewNode[] |  Thenable<NewNode[]> {
		return [];
	}

	public getEventInfo(resource: vscode.Uri) : Thenable<string> {
		return Promise.resolve("");
	}
}


export class NewsDataProvider implements vscode.TreeDataProvider<NewNode>, vscode.TextDocumentContentProvider  {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

	constructor(private context: vscode.ExtensionContext, private readonly model: IOTNewsModel) { }

	public refresh(resource: any): any {
		if (!resource || resource.path === '/') {
			this._onDidChangeTreeData.fire(null);
		} else {
			this._onDidChangeTreeData.fire(resource);
		}
	}
	public reload(node: NewNode): any {
		this._onDidChange.fire(node.resource);
	}

	public getTreeItem(element: NewNode): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			label: element.label,
            collapsibleState: element.folder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            iconPath:this.getTreeItemIcon(element),
			contextValue: 'FreeIOE.News',
			tooltip: element.uri.toString(),
			command: {
				command: 'IOTNewsViewer.openFile',
				arguments: [element.resource],
				title: 'Open FreeIOE News'
			}
		};
	}

	private getTreeItemIcon(element: NewNode) {
		if (element.folder) {
			return this.context.asAbsolutePath(path.join('media', 'light', 'warning_purple.svg'));
		}
	}

	public getChildren(element?: NewNode): NewNode[] | Thenable<NewNode[]> {
		return element ? this.model.getChildren(element) : this.model.roots;
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		return this.model.getEventInfo(uri);
    }
}


export class IOTNewsViewer {
	private treeModel: IOTNewsModel;
	private treeDataProvider: NewsDataProvider;
	private iotViewer: vscode.TreeView<NewNode>;

	constructor(context: vscode.ExtensionContext, client_mgr: ClientMgr) {
		this.treeModel = new IOTNewsModel(client_mgr);
		this.treeDataProvider = new NewsDataProvider(context, this.treeModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('freeioe_news', this.treeDataProvider));
		this.iotViewer = vscode.window.createTreeView('IOTNewsViewer', { treeDataProvider: this.treeDataProvider });

		client_mgr.DeviceStatusChanged( client => this.treeDataProvider.refresh(client.EventUri));

		vscode.commands.registerCommand('IOTNewsViewer.refresh', (resource?: any) => this.treeDataProvider.refresh(resource));
		vscode.commands.registerCommand('IOTNewsViewer.openFile', resource => this.openResource(resource));
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource, {preserveFocus: true});
	}

	public onInterval() {
		//this.treeDataProvider.onInterval();
	}

	public what_s_fuck() {
		this.iotViewer.dispose();
	}
}