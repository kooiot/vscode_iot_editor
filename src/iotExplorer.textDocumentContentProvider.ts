import * as vscode from 'vscode';
import { basename, dirname } from 'path';
import * as freeioe_client  from './freeioe_client';
import * as client from './client';


export interface IOTNode {
	resource: vscode.Uri;
	app: string;
	isDirectory: boolean;
}

export class IOTModel {

	private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly client: client.Client) {
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
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`iot://${host}///${entry.inst}`), app:entry.inst, isDirectory: true }))));
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

	public getContent(resource: vscode.Uri): Thenable<string> {
		return this.get_client().then(client => {
			return new Promise((c, e) => {
				let path = resource.path.substr(3);
				let app = path.split('/')[0];
				path = path.substr(app.length);
				client.download_file(app, path).then( (content) => {
					c(content);
				});
			});
		});
	}
}

export class IOTTreeDataProvider implements vscode.TreeDataProvider<IOTNode>, vscode.FileSystemProvider  {

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
				command: 'IOTExplorer.openIOTResource',
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

export class IOTExplorer {
	private iotModel: IOTModel;
	private treeDataProvider: IOTTreeDataProvider;

	constructor(context: vscode.ExtensionContext, device_client: client.Client) {
		this.iotModel = new IOTModel(device_client);
		this.treeDataProvider = new IOTTreeDataProvider(this.iotModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('iot', this.treeDataProvider));
		context.subscriptions.push(vscode.window.registerTreeDataProvider('IOTExplorer', this.treeDataProvider));

		vscode.commands.registerCommand('IOTExplorer.refresh', () => this.treeDataProvider.refresh());
		vscode.commands.registerCommand('IOTExplorer.openIOTResource', resource => this.openResource(resource));
		//vscode.commands.registerCommand('IOTExplorer.revealResource', () => this.reveal());
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource);
	}

	// private reveal(): Thenable<void> {
	// 	const node = this.getNode();
	// 	if (node) {
	// 		return this.IOTViewer.reveal(node);
	// 	}
	// 	return null;
	// }

	// private getNode(): IOTNode {
	// 	if (vscode.window.activeTextEditor) {
	// 		if (vscode.window.activeTextEditor.document.uri.scheme === 'freeioe') {
	// 			return { resource: vscode.window.activeTextEditor.document.uri, isDirectory: false };
	// 		}
	// 	}
	// 	return null;
	// }
}