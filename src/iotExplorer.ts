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
export class FsModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly client: client.Client, readonly schema: string) {
	}

	public get_client(): Thenable<freeioe_client.WSClient> {
		return this.client.get_client().then( client => client);
	}

	public get roots(): Thenable<IOTNode[]> {
		return this.get_client().then(client => {
			return new Promise((c, e) => {
				let config = this.client.ActiveDeviceConfig;
				let host = `${config.host}:${config.port}`;
				client.list_apps().then((list: freeioe_client.Application[]) => {
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${this.schema}://${host}///${entry.inst}`), app: entry.inst, isDirectory: true }))));
				}, (reason) => {
					return e(reason);
				});
			});
		});
	}

	public getChildren(node: IOTNode): Thenable<IOTNode[]> {
		return this.get_client().then(client => {
			let uri = node.resource.scheme + "://" + node.resource.authority + "///" + node.app;
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

	public valid_beta(): Thenable<void> {
		return new Promise((c, e) => {
			if (!this.client.Beta) {
				vscode.window.showWarningMessage(`Device is not in beta mode! So you cannot edit application content!`);
				return e(`Beta is not enabled!`);
			} else {
				return c();
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

export class IOTFileSystemProvider implements vscode.FileSystemProvider {
	private model: FsModel;

	constructor(context: vscode.ExtensionContext, client: client.Client) { 
		this.model = new FsModel(client, 'ioe');
		
		vscode.commands.registerCommand('IOTExplorer.reload', (resource: vscode.Uri) => this.try_reload_file(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationStart', (resource: vscode.Uri) => this.model.applicationStart(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationStop', (resource: vscode.Uri) => this.model.applicationStop(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationRestart', (resource: vscode.Uri) => this.model.applicationRestart(resource));
		vscode.commands.registerCommand('IOTExplorer.applicationConfig', (resource: vscode.Uri) => this.model.applicationConfig(resource));
	}

	// helper functions
	private valid_path(uri: vscode.Uri) : boolean {
		if (!this.model.client.Connected) {
			return false;
		}
		let config = this.model.client.ActiveDeviceConfig;
		if (uri.authority !== `${config.host}:${config.port}`) {
			return false;
		}
		return true;
	}

	private try_reload_file(uri: vscode.Uri) : void {
		this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
	}

	public activeUri(uri: vscode.Uri) : void {
		this._fireSoon({ type: vscode.FileChangeType.Created, uri });
	}

	// --- manage file metadata

	stat(uri: vscode.Uri): Thenable<vscode.FileStat> {
		if (!this.valid_path(uri)) {
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
		if (!this.valid_path(uri)) {
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
		if (!this.valid_path(uri)) {
			throw vscode.FileSystemError.FileNotFound();
		}
		return this.model.getContent(uri).then( (content: string) => new Buffer(content));
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
		if (!this.valid_path(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
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
		if (!this.valid_path(oldUri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
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
		if (!this.valid_path(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
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
		if (!this.valid_path(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
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
		if (!this.valid_path(uri)) {
			throw vscode.FileSystemError.NoPermissions();
		}
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
}

