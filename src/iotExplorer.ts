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

	private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

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
		return this.get_client().then(client => {
			let host = this.client.getWSHost();
			return new Promise((c, e) => {
				client.list_apps().then( (list: freeioe_client.Application[]) => {
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${this.schema}://${host}///${entry.inst}`), app:entry.inst, isDirectory: true }))));
				}, (reason) => {
					e(reason);
				});
			});
		});
	}

	public getChildren(node: IOTNode): Thenable<IOTNode[]> {
		return this.get_client().then(client => {
			return new Promise((c, e) => {
				let uri = node.resource.scheme + "://" + node.resource.authority + "///" + node.app;
				let path = node.resource.path.substr(3);
				path = path.substr(node.app.length);
				if (path.length === 0) {
					path = "//";
				}
				client.dir_app(node.app, path, false).then( (list: freeioe_client.ApplicationFileNode[]) => {
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${uri}/${entry.id}`), app: node.app, isDirectory: entry.children !== false }))));
				}, (reason) => {
					e(reason);
				});
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
	private parse_uri(resource: vscode.Uri) : IOTUriNode {
		let path = resource.path.substr(3);
		let app = path.split('/')[0];
		return {app: app, path: path.substr(app.length)};
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
					return e('Cannot move node between applications');
				}
				if (oldNode.path === newNode.path) {
					c(true);
				} else {
					return client.rename(newNode.app, oldNode.path, newNode.path);
				}
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
			return client.create(node.app, node.path, type);
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
		this.model.setContent(uri, content.toString()).then( (result: boolean) => {
			if (result) {
				this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
			} else {
				// TODO:
				//this._fireSoon({ type: vscode.FileSystemError, uri});
			}
		}, (reason) => {
			// TODO:
		});
    }

    // --- manage files/folders

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
		this.model.renameNode(oldUri, newUri).then( (result:boolean) => {
			if (result) {
				this._fireSoon(
					{ type: vscode.FileChangeType.Deleted, uri: oldUri },
					{ type: vscode.FileChangeType.Created, uri: newUri }
				);
			}
		});
    }

    delete(uri: vscode.Uri): void {
		let folder = uri.with({ path: dirname(uri.path) });
		this.model.deleteNode(uri).then( (result:boolean) => {
			if (result) {
				this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { uri, type: vscode.FileChangeType.Deleted });
			}
		});
    }

    createDirectory(uri: vscode.Uri): void {
		let folder = uri.with({ path: dirname(uri.path) });
		this.model.createNode(uri, 'directory').then( (result:boolean) => {
			if (result) {
				this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { type: vscode.FileChangeType.Created, uri });
			}
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
		context.subscriptions.push(vscode.workspace.registerFileSystemProvider('ioe', this.fileSystemProvider));
		this.iotExplorer = vscode.window.createTreeView('IOTExplorer', { treeDataProvider: this.fileSystemProvider });

		vscode.commands.registerCommand('IOTExplorer.refresh', () => this.fileSystemProvider.refresh());
		vscode.commands.registerCommand('IOTExplorer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTExplorer.revealResource', () => this.reveal());
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource);
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
			if (uri.scheme === 'iot') {
				let path = uri.path.substr(3);
				let app = path.split('/')[0];
				return { resource: uri, app:app, isDirectory: false };
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
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource);
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
				let path = uri.path.substr(3);
				let app = path.split('/')[0];
				return { resource: uri, app:app, isDirectory: false };
			}
		}
		return undefined;
	}
}