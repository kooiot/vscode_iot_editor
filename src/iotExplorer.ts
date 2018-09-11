'use strict';

import * as vscode from 'vscode';
import { basename, dirname } from 'path';
import * as freeioe_client  from './freeioe_client';
import * as client from './client';


export interface IOTNode {
	resource: vscode.Uri;
	app: string;
	isDirectory: boolean;
}

interface IOTUriNode {
	app: string;
	path: string;
}
export class IOTModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly client: client.Client, readonly schema: string) {
	}

	public get_client(): Thenable<freeioe_client.WSClient> {
		return new Promise((c, e) => {
			this.client.get_client().then( client => {
				c(client);
			}, (reason) => {
                e(reason);
            });
		});
	}

	public get roots(): Thenable<IOTNode[]> {
		return new Promise((c, e) => {
			return this.get_client().then(client => {
				let host = this.client.WSHost;
				client.list_apps().then( (list: freeioe_client.Application[]) => {
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${this.schema}://${host}///${entry.inst}`), app:entry.inst, isDirectory: true }))));
				}, (reason) => {
					e(reason);
				});
			}, (reason) => {
				e(reason);
			});
		});
	}

	public getChildren(node: IOTNode): Thenable<IOTNode[]> {
		return new Promise((c, e) => {
			return this.get_client().then(client => {
				let uri = node.resource.scheme + "://" + node.resource.authority + "///" + node.app;
				let nn = this.parse_uri(node.resource);
				client.dir_app(node.app, nn.path, false).then( (list: freeioe_client.ApplicationFileNode[]) => {
					c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${uri}/${entry.id}`), app: node.app, isDirectory: entry.children !== false }))));
				}, (reason) => {
					e(reason);
				});
			}, (reason) => {
				e(reason);
			});
		});
	}

	private sort(nodes: IOTNode[]): IOTNode[] {
		return nodes.sort((n1, n2) => {
			if (n1.isDirectory && !n2.isDirectory) {
				return -1;
			}

			if (!n1.isDirectory && n2.isDirectory) {
				return 1;
			}

			return basename(n1.resource.fsPath).localeCompare(basename(n2.resource.fsPath));
		});
	}
	public parse_uri(resource: vscode.Uri) : IOTUriNode {
		let path = resource.path.substr(3);
		let app = path.split('/')[0];
		return {app: app, path: path.substr(app.length + 1)};
	}

	public valid_beta(): Thenable<void> {
		return new Promise((c, e) => {
			if (!this.client.Beta) {
				vscode.window.showWarningMessage(`Device is not in beta mode! So you cannot edit application content!`);
				e(`Beta is not enabled!`);
			} else {
				c();
			}
		});
	}

	public getContent(resource: vscode.Uri): Thenable<string> {
		return this.get_client().then(client => {
			let node = this.parse_uri(resource);
			return client.download_file(node.app, node.path);
		});
	}

	public setContent(resource: vscode.Uri, content: string) : Thenable<boolean> {
		return this.get_client().then(client => {
			let node = this.parse_uri(resource);
			return client.upload_file(node.app, node.path, content);
		});
	}

	public renameNode(oldUri: vscode.Uri, newUri: vscode.Uri): Thenable<boolean> {
		return this.get_client().then(client => {
			return new Promise((c, e) => {
				let oldNode = this.parse_uri(oldUri);
				let newNode = this.parse_uri(newUri);
				if (oldNode.app !== newNode.app) {
					e('Cannot move node between applications');
					return;
				}
				if (oldNode.path === newNode.path) {
					c(true);
					return;
				}
				if (dirname(oldNode.path) !== dirname(newNode.path)) {
					e('Rename only happened in same folder');
					return;
				}
				return client.rename(newNode.app, oldNode.path, basename(newNode.path));
			});
		});
	}

	public deleteNode(resource: vscode.Uri) : Thenable<boolean> {
		return this.get_client().then(client => {
			let node = this.parse_uri(resource);
			return client.delete(node.app, node.path);
		});
	}

	public createNode(resource: vscode.Uri, type: string) : Thenable<boolean> {
		return this.get_client().then(client => {
			let node = this.parse_uri(resource);
			if (type === 'file') {
				return client.create_file(node.app, node.path);
			}
			if (type === 'directory') {
				return client.create_directory(node.app, node.path);
			}
			return false;
		});
	}

	public statNode(resource: vscode.Uri) : Thenable<freeioe_client.IOTFileStat> {
		return this.get_client().then(client => {
			let node = this.parse_uri(resource);
			return client.stat(node.app, node.path);
		});
	}

	public dirNode(resource: vscode.Uri) : Thenable<IOTNode[]> {
		let uri_node = this.parse_uri(resource);
		let node: IOTNode = Object.assign({}, {
			resource: resource,
			app: uri_node.app,
			isDirectory: true
		});
		return this.getChildren(node);
	}

	public applicationStart(item: IOTNode | vscode.Uri) : Thenable<void> {
		let node = this.parse_uri((item instanceof vscode.Uri) ? item : item.resource);
		return this.client.startApplication(node.app);
	}
	
	public applicationStop(item: IOTNode | vscode.Uri) : Thenable<void> {
		let node = this.parse_uri((item instanceof vscode.Uri) ? item : item.resource);
		return this.client.stopApplication(node.app, 'Stop from IOTExplorer');
	}
	
	public applicationRestart(item: IOTNode | vscode.Uri) : Thenable<void> {
		let node = this.parse_uri((item instanceof vscode.Uri) ? item : item.resource);
		return this.client.restartApplication(node.app, 'Restart from IOTExplorer');
	}
	
	public applicationConfig(item: IOTNode | vscode.Uri) : Thenable<void> {
		let node = this.parse_uri((item instanceof vscode.Uri) ? item : item.resource);
		return this.client.configApplication(node.app);
	}
}

export class IOTTreeDataProvider implements vscode.TreeDataProvider<IOTNode>, vscode.TextDocumentContentProvider  {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	constructor(private readonly model: IOTModel) { }

	public refresh(): any {
		this._onDidChangeTreeData.fire();
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

export class IOTFileSystemProvider implements vscode.TreeDataProvider<IOTNode>, vscode.FileSystemProvider {

    // --- manage file metadata

    stat(uri: vscode.Uri):  Thenable<vscode.FileStat> {
		return new Promise((c, e) => {
			this.model.statNode(uri).then( (stat: freeioe_client.IOTFileStat) => {
				let fs: vscode.FileStat = Object.assign({});
				fs.size = stat.size;
				if (stat.mode === 'file') {
					fs.type = vscode.FileType.File;
				} else if (stat.mode === 'directory') {
					fs.type = vscode.FileType.Directory;
				} else if (stat.mode === 'link') {
					fs.type = vscode.FileType.SymbolicLink;
				} else {
					fs.type = vscode.FileType.Unknown;
				}
				fs.ctime = stat.access;
				fs.mtime = stat.modification;
				c(fs);
			}, (reason) => {
				e(reason);
			});
		});
    }

    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]> {
		return new Promise((c, e) => {
			this.model.dirNode(uri).then( (nodes: IOTNode[]) => {
				let result: [string, vscode.FileType][] = [];
				for (const node of nodes) {
					result.push([basename(node.resource.fsPath), node.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
				}
				c(result);
			}, (reason) => {
				e(reason);
			});
		});
    }

    // --- manage file contents

    readFile(uri: vscode.Uri): Thenable<Uint8Array> {
        return new Promise((c, e) => {
			this.model.getContent(uri).then( (content: string) => {
				c(new Buffer(content));
			}, (reason) => {
				e(reason);
			});
		});
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
		this.model.valid_beta().then( () => {
			this.model.setContent(uri, content.toString()).then((result: boolean) => {
				if (result) {
					this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
				} else {
					// TODO:
					//this._fireSoon({ type: vscode.FileSystemError, uri});
				}
			}, (reason) => {
				// TODO:
			});
		});
    }

    // --- manage files/folders

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
		this.model.valid_beta().then( () => {
			this.model.renameNode(oldUri, newUri).then((result: boolean) => {
				if (result) {
					this._fireSoon(
						{ type: vscode.FileChangeType.Deleted, uri: oldUri },
						{ type: vscode.FileChangeType.Created, uri: newUri }
					);
				}
			});
		});
    }

    delete(uri: vscode.Uri): void {
		this.model.valid_beta().then(() => {
			let folder = uri.with({ path: dirname(uri.path) });
			this.model.deleteNode(uri).then((result: boolean) => {
				if (result) {
					this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { uri, type: vscode.FileChangeType.Deleted });
				}
			});
		});
    }

    createDirectory(uri: vscode.Uri): void {
		this.model.valid_beta().then(() => {
			let folder = uri.with({ path: dirname(uri.path) });
			this.model.createNode(uri, 'directory').then((result: boolean) => {
				if (result) {
					this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { type: vscode.FileChangeType.Created, uri });
				}
			});
		});
    }

    createFile(uri: vscode.Uri): void {
		this.model.valid_beta().then(() => {
			let folder = uri.with({ path: dirname(uri.path) });
			this.model.createNode(uri, 'file').then((result: boolean) => {
				if (result) {
					this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { type: vscode.FileChangeType.Created, uri });
				}
			});
		});
    }

    // --- manage file events

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle: NodeJS.Timer | undefined;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(resource: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => { });
    }

    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
		this._bufferedEvents.push(...events);
		if (this._fireSoonHandle) {
			clearTimeout(this._fireSoonHandle);
		}
        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }

	// tree data provider

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	constructor(private readonly model: IOTModel) { }

	public refresh(): any {
		this._onDidChangeTreeData.fire();
	}


	public getTreeItem(element: IOTNode): vscode.TreeItem {
		// return {
		// 	resourceUri: element.resource,
		// 	collapsibleState: element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
		// 	command: element.isDirectory ? void 0 : {
		// 		command: 'IOTExplorer.openFile',
		// 		arguments: [element.resource],
		// 		title: 'Open IOT File'
		// 	}
		// };
		
		const treeItem = new vscode.TreeItem(element.resource, element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		if (!element.isDirectory) {
			treeItem.command = { command: 'IOTExplorer.openFile', title: "Open File", arguments: [element.resource], };
			treeItem.contextValue = 'file';
		}
		treeItem.contextValue = 'IOTExplorer';
		return treeItem;
	}

	public getChildren(element?: IOTNode): IOTNode[] | Thenable<IOTNode[]> {
		return element ? this.model.getChildren(element) : this.model.roots;
	}

	public getParent(element: IOTNode): IOTNode | undefined {
		const parent = element.resource.with({ path: dirname(element.resource.path) });
		const app = element.app;
		return parent.path !== '//' ? { resource: parent, app: app, isDirectory: true } : undefined;
	}
}


export class IOTExplorer {
	private iotModel: IOTModel;
	private fileSystemProvider: IOTFileSystemProvider;
	private iotExplorer: vscode.TreeView<IOTNode>;

	constructor(context: vscode.ExtensionContext, device_client: client.Client) {
		this.iotModel = new IOTModel(device_client, 'ioe');

		this.fileSystemProvider = new IOTFileSystemProvider(this.iotModel);
		context.subscriptions.push(vscode.workspace.registerFileSystemProvider('ioe', this.fileSystemProvider, { isCaseSensitive: true }));
		this.iotExplorer = vscode.window.createTreeView('IOTExplorer', { treeDataProvider: this.fileSystemProvider });

		vscode.commands.registerCommand('IOTExplorer.refresh', () => this.fileSystemProvider.refresh());
		vscode.commands.registerCommand('IOTExplorer.new_file', (node: any) => this.new_file(node));
		vscode.commands.registerCommand('IOTExplorer.new_folder', (node: any) => this.new_folder(node));
		vscode.commands.registerCommand('IOTExplorer.delete', (node: IOTNode) => this.delete(node));
		vscode.commands.registerCommand('IOTExplorer.rename', (node: IOTNode) => this.rename(node));
		vscode.commands.registerCommand('IOTExplorer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTExplorer.revealResource', () => this.reveal());
		
		vscode.commands.registerCommand('IOTExplorer.applicationStart', (node) => this.iotModel.applicationStart(node));
		vscode.commands.registerCommand('IOTExplorer.applicationStop', (node) => this.iotModel.applicationStop(node));
		vscode.commands.registerCommand('IOTExplorer.applicationRestart', (node) => this.iotModel.applicationRestart(node));
		vscode.commands.registerCommand('IOTExplorer.applicationConfig', (node) => this.iotModel.applicationConfig(node));
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource, {preserveFocus: true});
	}

	private new_file(item: IOTNode | undefined ) {
		let cur_item = item ? item : this.iotExplorer.selection[0];
		if (!cur_item) {
			return;
		}

		if (cur_item.isDirectory) {
			return vscode.window.showInputBox({prompt: "Please input new file name"}).then(new_name => {
				let new_file: IOTNode = { resource: vscode.Uri.parse(`${cur_item.resource.toString()}/${new_name}`), app:cur_item.app, isDirectory: false }
				this.fileSystemProvider.createFile(new_file.resource);
				this.fileSystemProvider.refresh();
				this.openResource(new_file.resource);
			});
		}
	}
	private new_folder(item: IOTNode | undefined ) {
		let cur_item = item ? item : this.iotExplorer.selection[0];
		if (!cur_item) {
			return;
		}
		
		if (cur_item.isDirectory) {
			return vscode.window.showInputBox({ prompt: "Please input new folder name" }).then(new_name => {
				let new_file: IOTNode = { resource: vscode.Uri.parse(`${cur_item.resource.toString()}/${new_name}`), app: cur_item.app, isDirectory: true }
				this.fileSystemProvider.createDirectory(new_file.resource);
				this.fileSystemProvider.refresh();
			});
		}
	}
	private delete(item: IOTNode) {
		if (!item) {
			return;
		}
		this.fileSystemProvider.delete(item.resource);
		this.fileSystemProvider.refresh();
	}
	private rename(item: IOTNode) {
		if (!item) {
			return;
		}
		let old_name = basename(item.resource.path);
		return vscode.window.showInputBox({prompt: "Please input new name", value: old_name}).then(new_name => {
			if (new_name !== old_name) {
				let old_path = item.resource.toString();
				old_path = old_path.substr(0, old_path.length - old_name.length);
				let new_uri = vscode.Uri.parse(`${old_path}${new_name}`);
				this.fileSystemProvider.rename(item.resource, new_uri, {overwrite: false});
				this.fileSystemProvider.refresh();
				for (let doc of vscode.workspace.textDocuments) {
					if (doc.uri === item.resource) {
						// TODO;
					}
				}
			}
        });
	}

	private reveal(): void {
		const node = this.getNode();
		if (node) {
			this.iotExplorer.reveal(node);
		}
	}

	private getNode(): IOTNode | undefined {
		if (vscode.window.activeTextEditor) {
			let uri = vscode.window.activeTextEditor.document.uri;
			if (uri.scheme === 'ioe') {
				let node = this.iotModel.parse_uri(uri);
				return { resource: uri, app:node.app, isDirectory: false };
			}
		}
		return undefined;
	}
}

export class IOTViewer {
	private iotModel: IOTModel;
	private treeDataProvider: IOTTreeDataProvider;
	private iotViewer: vscode.TreeView<IOTNode>;

	constructor(context: vscode.ExtensionContext, device_client: client.Client) {
		this.iotModel = new IOTModel(device_client, 'iot');

		this.treeDataProvider = new IOTTreeDataProvider(this.iotModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('iot', this.treeDataProvider));
		this.iotViewer = vscode.window.createTreeView('IOTViewer', { treeDataProvider: this.treeDataProvider });

		vscode.commands.registerCommand('IOTViewer.refresh', () => this.treeDataProvider.refresh());
		vscode.commands.registerCommand('IOTViewer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTViewer.revealResource', () => this.reveal());
		
		vscode.commands.registerCommand('IOTViewer.applicationStart', () => this.applicationStart());
		vscode.commands.registerCommand('IOTViewer.applicationStop', () => this.applicationStop());
		vscode.commands.registerCommand('IOTViewer.applicationRestart', () => this.applicationRestart());
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

	private applicationStart(): void {

	}
	private applicationStop(): void {

	}
	private applicationRestart(): void {

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
}