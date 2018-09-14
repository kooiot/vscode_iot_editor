'use strict';

import * as vscode from 'vscode';
import { basename, dirname } from 'path';
import * as freeioe_client  from './freeioe_client';
import * as client from './client_mgr';


export interface IOTNode {
	resource: vscode.Uri;
	app: string;
	isDirectory: boolean;
}

interface IOTUriNode {
	app: string;
	path: string;
}
export class FsModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly mgr: client.ClientMgr, readonly schema: string) {
	}


	public getChildren(node: IOTNode): Thenable<IOTNode[]> {
		return this.mgr.getClient(node.resource).then(client => {
			let uri = node.resource.scheme + "://" + node.resource.authority + "/" + node.app;
			let nn = this.parse_uri(node.resource);
			return client.dir_app(node.app, nn.path, false).then((list: freeioe_client.ApplicationFileNode[]) => {
				return new Promise((c, e) => {
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${uri}/${entry.id}`), app: node.app, isDirectory: entry.children !== false }))));
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
	public parse_uri(resource: vscode.Uri) : IOTUriNode {
		let path = resource.path.substr(1);
		let app = path.split('/')[0];
		return {app: app, path: path.substr(app.length)};
	}

	public valid_beta(resource: vscode.Uri): Thenable<void> {
		return this.mgr.getClient(resource).then(client => client.Beta ? Promise.resolve(): Promise.reject(`Device ${resource} not in BETA mode!`));
	}
	public is_connect(resource: vscode.Uri) : boolean {
		return this.mgr.isConnected(resource);
	}

	public getContent(resource: vscode.Uri): Thenable<string> {
		return this.mgr.getClient(resource).then(client => {
			let node = this.parse_uri(resource);
			return client.download_file(node.app, node.path);
		});
	}

	public setContent(resource: vscode.Uri, content: string) : Thenable<boolean> {
		return this.mgr.getClient(resource).then(client => {
			let node = this.parse_uri(resource);
			return client.upload_file(node.app, node.path, content);
		});
	}

	public renameNode(oldUri: vscode.Uri, newUri: vscode.Uri): Thenable<boolean> {
		return this.mgr.getClient(oldUri).then(client => {
			let oldNode = this.parse_uri(oldUri);
			let newNode = this.parse_uri(newUri);
			if (oldNode.app !== newNode.app) {
				console.log('Cannot move node between applications');
				return Promise.resolve(false);
			}
			if (oldNode.path === newNode.path) {
				return Promise.resolve(true);
			}
			if (dirname(oldNode.path) !== dirname(newNode.path)) {
				console.log('Rename only happened in same folder');
				return Promise.resolve(false);
			}
			return client.rename(newNode.app, oldNode.path, basename(newNode.path));
		});
	}

	public deleteNode(resource: vscode.Uri) : Thenable<boolean> {
		return this.mgr.getClient(resource).then(client => {
			let node = this.parse_uri(resource);
			return client.delete(node.app, node.path);
		});
	}

	public createNode(resource: vscode.Uri, type: string) : Thenable<boolean> {
		return this.mgr.getClient(resource).then(client => {
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
		return this.mgr.getClient(resource).then(client => {
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
		let uri = (item instanceof vscode.Uri) ? item : item.resource;
		let node = this.parse_uri(uri);
		return this.mgr.startApplication(uri, node.app);
	}
	
	public applicationStop(item: IOTNode | vscode.Uri) : Thenable<void> {
		let uri = (item instanceof vscode.Uri) ? item : item.resource;
		let node = this.parse_uri(uri);
		return this.mgr.stopApplication(uri, node.app, 'Stop from IOTExplorer');
	}
	
	public applicationRestart(item: IOTNode | vscode.Uri) : Thenable<void> {
		let uri = (item instanceof vscode.Uri) ? item : item.resource;
		let node = this.parse_uri(uri);
		return this.mgr.restartApplication(uri, node.app, 'Restart from IOTExplorer');
	}
	
	public applicationConfig(item: IOTNode | vscode.Uri) : Thenable<void> {
		let uri = (item instanceof vscode.Uri) ? item : item.resource;
		let node = this.parse_uri(uri);
		return this.mgr.configApplication(uri, node.app);
	}
}

export class IOTFileSystemProvider implements vscode.FileSystemProvider {
	private model: FsModel;

	constructor(context: vscode.ExtensionContext, client_mgr: client.ClientMgr) { 
		this.model = new FsModel(client_mgr, 'ioe');
		
		client_mgr.DeviceStatusChanged( client => this.try_reload_file(client.FsUri));
		
		vscode.commands.registerCommand('IOTExplorer.reload', (resource: vscode.Uri) => this.try_reload_file(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationStart', (resource: vscode.Uri) => this.model.applicationStart(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationStop', (resource: vscode.Uri) => this.model.applicationStop(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationRestart', (resource: vscode.Uri) => this.model.applicationRestart(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationConfig', (resource: vscode.Uri) => this.model.applicationConfig(resource));
	}

	// helper functions

	private try_reload_file(uri: vscode.Uri) : void {
		this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
	}

	public activeUri(uri: vscode.Uri) : void {
		this._fireSoon({ type: vscode.FileChangeType.Created, uri });
	}

	// --- manage file metadata

	stat(uri: vscode.Uri): Thenable<vscode.FileStat> {
		if (!this.model.is_connect(uri)) {
			if (uri.path === '/') {
				return Promise.resolve({
					size: 0,
					type: vscode.FileType.Directory,
					ctime: 0,
					mtime: 0,
				});
			} else {
				throw vscode.FileSystemError.FileNotFound();
			}
		}
		return this.model.statNode(uri).then((stat: freeioe_client.IOTFileStat) => {
			return new Promise((c, e) => {
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
				return c(fs);
			});
		});
	}

	readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]> {
		if (!this.model.is_connect(uri)) {
			if (uri.path === '/') {
				return Promise.resolve([]);
			} else {
				throw vscode.FileSystemError.FileNotFound();
			}
		}
		return this.model.dirNode(uri).then((nodes: IOTNode[]) => {
			return new Promise((c, e) => {
				let result: [string, vscode.FileType][] = [];
				for (const node of nodes) {
					result.push([basename(node.resource.fsPath), node.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
				}
				return c(result);
			});
		});
	}

    // --- manage file contents

    readFile(uri: vscode.Uri): Thenable<Uint8Array> {
		if (!this.model.is_connect(uri)) {
			throw vscode.FileSystemError.FileNotFound();
		}
		return this.model.getContent(uri).then( (content: string) => new Buffer(content));
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
		if (!this.model.is_connect(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
		this.model.valid_beta(uri).then( () => {
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
		}, (reason) => {
			vscode.window.showWarningMessage(`Device is not in beta mode! ${reason}`);
		});
    }

    // --- manage files/folders

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
		if (!this.model.is_connect(oldUri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
		this.model.valid_beta(oldUri).then( () => {
			this.model.renameNode(oldUri, newUri).then((result: boolean) => {
				if (result) {
					this._fireSoon(
						{ type: vscode.FileChangeType.Deleted, uri: oldUri },
						{ type: vscode.FileChangeType.Created, uri: newUri }
					);
				}
			});
		}, (reason) => {
			vscode.window.showWarningMessage(`Device is not in beta mode! ${reason}`);
		});
    }

    delete(uri: vscode.Uri): void {
		if (!this.model.is_connect(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
		this.model.valid_beta(uri).then(() => {
			let folder = uri.with({ path: dirname(uri.path) });
			this.model.deleteNode(uri).then((result: boolean) => {
				if (result) {
					this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { uri, type: vscode.FileChangeType.Deleted });
				}
			});
		}, (reason) => {
			vscode.window.showWarningMessage(`Device is not in beta mode! ${reason}`);
		});
    }

    createDirectory(uri: vscode.Uri): void {
		if (!this.model.is_connect(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
		this.model.valid_beta(uri).then(() => {
			let folder = uri.with({ path: dirname(uri.path) });
			this.model.createNode(uri, 'directory').then((result: boolean) => {
				if (result) {
					this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { type: vscode.FileChangeType.Created, uri });
				}
			});
		}, (reason) => {
			vscode.window.showWarningMessage(`Device is not in beta mode! ${reason}`);
		});
    }

    createFile(uri: vscode.Uri): void {
		if (!this.model.is_connect(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
		this.model.valid_beta(uri).then(() => {
			let folder = uri.with({ path: dirname(uri.path) });
			this.model.createNode(uri, 'file').then((result: boolean) => {
				if (result) {
					this._fireSoon({ type: vscode.FileChangeType.Changed, uri: folder }, { type: vscode.FileChangeType.Created, uri });
				}
			});
		}, (reason) => {
			vscode.window.showWarningMessage(`Device is not in beta mode! ${reason}`);
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
}

