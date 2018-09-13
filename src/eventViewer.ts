'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as client from './client';
import * as freeioe_client from './freeioe_client';
import { WSEvent } from './freeioe_ws';


export interface EventNode {
	resource: vscode.Uri;
	label: string;
	event?: WSEvent;
}

export class IOTEventModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly client: client.Client) {
	}

	public get_client(): Thenable<freeioe_client.WSClient> {
		return this.client.get_client().then(client => client);
	}
	
	public get root() : EventNode[] {
		let list: EventNode[] = [];
		list.push({
			resource: vscode.Uri.parse(`freeioe_event://${this.client.ActiveDevice}`),
			label: this.client.ActiveDevice,
		});
		return list;
	}

	public get events(): Thenable<EventNode[]> {
		return this.client.get_client().then(client => {
			return new Promise((c, e) => {
				let list: EventNode[] = [];
				let events = client.Events;
				for (var i = 0; i < events.length; i++) {
					list.push({
						resource: vscode.Uri.parse(`freeioe_event://${this.client.ActiveDevice}/${i}.json`),
						label: events[i].info,
						event: events[i],
					});
				}
				return c(list);
			});
		});
	}
	
	public getChildren(node: EventNode): EventNode[] |  Thenable<EventNode[]> {
		let path = node.resource.path.substr(1);
		if (path.length > 0) {
			return [];
		}
		return this.events;
	}

	public getEvent(index: number) : Thenable<EventNode> {
		let events = this.events;
		return events.then((events) => {
			return events[index];
		});
	}
}


export class DeviceTreeDataProvider implements vscode.TreeDataProvider<EventNode>, vscode.TextDocumentContentProvider  {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

	constructor(private context: vscode.ExtensionContext, private readonly model: IOTEventModel) { }

	public refresh(): any {
		this._onDidChangeTreeData.fire();
	}
	public reload(node: EventNode): any {
		this._onDidChange.fire(node.resource);
	}

	public getTreeItem(element: EventNode): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			label: element.label,
            collapsibleState: element.event? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
            iconPath:this.getTreeItemIcon(element),
			contextValue: 'FreeIOE.Event',
			tooltip: "",
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
		return element ? this.model.getChildren(element) : this.model.root;
	}
    

	private remove_ext(filename : string) {
		let ext = path.extname(filename);
		return filename.substr(0, filename.length - ext.length);
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		let uri_path = uri.path.substr(1);
		if (uri_path.length > 0) {
			uri_path = this.remove_ext(uri_path);
			return this.model.getEvent(parseInt(uri_path)).then( event => {
				return JSON.stringify(event.event ? event.event : event.label, null, 4);
			});
		}
    }
}


export class IOTEventViewer {
	private treeModel: IOTEventModel;
	private treeDataProvider: DeviceTreeDataProvider;
	private iotViewer: vscode.TreeView<EventNode>;

	constructor(context: vscode.ExtensionContext, device_client: client.Client) {

		this.treeModel = new IOTEventModel(device_client);
		this.treeDataProvider = new DeviceTreeDataProvider(context, this.treeModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('freeioe_event', this.treeDataProvider));
		this.iotViewer = vscode.window.createTreeView('IOTEventViewer', { treeDataProvider: this.treeDataProvider });

		vscode.commands.registerCommand('IOTEventViewer.refresh', () => this.treeDataProvider.refresh());
		vscode.commands.registerCommand('IOTEventViewer.reload', (node) => this.treeDataProvider.reload(node));
		vscode.commands.registerCommand('IOTEventViewer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTEventViewer.revealResource', () => this.reveal());
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
			let uri = vscode.window.activeTextEditor.document.uri;
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