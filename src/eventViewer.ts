'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as client from './client_mgr';
import { WSEvent } from './freeioe_ws';


export interface EventNode {
	resource: vscode.Uri;
	enabled?: boolean;
	label: string;
	event?: WSEvent;
}

export class IOTEventModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly mgr: client.ClientMgr) {
	}

	public get roots() : Thenable<EventNode[]> {
		return new Promise((c, e) => {
			const list: EventNode[] = [];
			for (const dev of this.mgr.Devices) {
				list.push({
					resource: this.mgr.getDeviceUri(dev.name, 'freeioe_event'),
					enabled: this.mgr.isConnect(dev.name),
					label: dev.name,
				});
			}
			return c(list);
		});
	}

	public getChildren(node: EventNode): EventNode[] |  Thenable<EventNode[]> {
		return this.mgr.getClient(node.resource).then(client => {
			return client.list_events().then((list) => {
				return new Promise((c, e) => {
					const result: EventNode[] = [];
					for (let i = 0; i < list.length; i++) {
						result.push({
							resource: vscode.Uri.parse(`${node.resource}${i}.json`),
							label: list[i].info,
							event: list[i],
						});
					}
					return c(result);
				});
			}, (reason) => {
				return Promise.resolve([]);
			});
		}, (reason) => {
			return Promise.resolve([]);
		});
	}
	private remove_ext(filename : string) {
		const ext = path.extname(filename);
		return filename.substr(0, filename.length - ext.length);
	}

	public getEventInfo(resource: vscode.Uri) : Thenable<string> {
		let uri_path = resource.path.substr(1);
		if (uri_path.length > 0) {
			uri_path = this.remove_ext(uri_path);
			const index = parseInt(uri_path);
			return this.mgr.getClient(resource).then(client => {
				return client.list_events().then( list => JSON.stringify(list[index], null, 4) );
			}, (reason) => {
				return reason;
			});
		} else {
			return Promise.reject('Not Event Node!');
		}
	}
}


export class DeviceTreeDataProvider implements vscode.TreeDataProvider<EventNode>, vscode.TextDocumentContentProvider  {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

	constructor(private context: vscode.ExtensionContext, private readonly model: IOTEventModel) { }

	public refresh(resource: any): any {
		if (!resource || resource.path === '/') {
			this._onDidChangeTreeData.fire(null);
		} else {
			this._onDidChangeTreeData.fire(resource);
		}
	}
	public reload(node: EventNode): any {
		this._onDidChange.fire(node.resource);
	}

	public getTreeItem(element: EventNode): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			label: element.label,
            collapsibleState: (element.event || !element.enabled) ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
            iconPath:this.getTreeItemIcon(element),
			contextValue: 'FreeIOE.Event',
			tooltip: element.event ? element.event.type : element.label,
			command: {
				command: 'IOTEventViewer.openFile',
				arguments: [element.resource],
				title: 'Open Device Configuration'
			}
		};
	}

	private getTreeItemIcon(element: EventNode) {
		if (element.event) {
			if (element.event.level === 0) {
				return this.context.asAbsolutePath(path.join('media', 'light', 'warning_green.svg'));
			}
			if (element.event.level === 1) {
				return this.context.asAbsolutePath(path.join('media', 'light', 'warning_blue.svg'));
			}
			if (element.event.level === 2) {
				return this.context.asAbsolutePath(path.join('media', 'light', 'warning_orange.svg'));
			}
			if (element.event.level === 3) {
				return this.context.asAbsolutePath(path.join('media', 'light', 'warning_red.svg'));
			}
			if (element.event.level >= 3) {
				return this.context.asAbsolutePath(path.join('media', 'light', 'warning_purple.svg'));
			}
		}
	}

	public getChildren(element?: EventNode): EventNode[] | Thenable<EventNode[]> {
		return element ? this.model.getChildren(element) : this.model.roots;
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		return this.model.getEventInfo(uri);
    }
}


export class IOTEventViewer {
	private treeModel: IOTEventModel;
	private treeDataProvider: DeviceTreeDataProvider;
	private iotViewer: vscode.TreeView<EventNode>;

	constructor(context: vscode.ExtensionContext, client_mgr: client.ClientMgr) {
		this.treeModel = new IOTEventModel(client_mgr);
		this.treeDataProvider = new DeviceTreeDataProvider(context, this.treeModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('freeioe_event', this.treeDataProvider));
		this.iotViewer = vscode.window.createTreeView('IOTEventViewer', { treeDataProvider: this.treeDataProvider });

		client_mgr.DeviceStatusChanged( client => this.treeDataProvider.refresh(client.EventUri));

		vscode.commands.registerCommand('IOTEventViewer.refresh', (resource?: any) => this.treeDataProvider.refresh(resource));
		vscode.commands.registerCommand('IOTEventViewer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTEventViewer.revealResource', () => this.reveal());
		
		vscode.commands.registerCommand('IOTEventViewer.reload', (node) => this.treeDataProvider.reload(node));
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

	private getNode(): EventNode | undefined {
		if (vscode.window.activeTextEditor) {
			const uri = vscode.window.activeTextEditor.document.uri;
			if (uri.scheme === 'freeioe_event') {
				return { resource: uri, label: 'unknown' };
			}
		}
		return undefined;
	}

	public onInterval() {
		//this.treeDataProvider.onInterval();
	}
}