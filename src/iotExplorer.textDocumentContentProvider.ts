import * as vscode from 'vscode';
import { Client, Application, ApplicationFileNode }  from './freeioe_client';
import { basename, dirname } from 'path';


export interface IOTNode {
	resource: vscode.Uri;
	app: string;
	isDirectory: boolean;
}

export class IOTModel {

	private nodes: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly host: string, readonly port: number, private user: string, private password: string) {
	}

	public connect(): Thenable<Client> {
		return new Promise((c, e) => {
			const client = new Client({
				host: this.host,
				port: this.port,
				username: this.user,
				password: this.password
			});
			client.on('ready', () => {
				c(client);
			});

			client.on('error', (message : string) => {
				e('Error while connecting: ' + message);
			});

			client.connect();
		});
	}

	public get roots(): Thenable<IOTNode[]> {
		return this.connect().then(client => {
			return new Promise((c, e) => {
				client.list_apps().then( (list: Application[]) => {
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`iot://${this.host}///${entry.inst}`), app:entry.inst, isDirectory: true }))));
				});
			});
		});
	}

	public getChildren(node: IOTNode): Thenable<IOTNode[]> {
		return this.connect().then(client => {
			return new Promise((c, e) => {
				let fsPath = node.resource.fsPath;
				fsPath = fsPath.substr(node.app.length);
				client.dir_app(node.app, fsPath.substr(2), false).then( (list: ApplicationFileNode[]) => {
					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${node.resource.fsPath}/${entry.id}`), app: node.app, isDirectory: entry.children !== false }))));
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
		return this.connect().then(client => {
			return new Promise((c, e) => {
				let fsPath = resource.fsPath;
				let app = fsPath.split('/')[0];
				fsPath = fsPath.substr(app.length);
				client.download_file(app, fsPath.substr(2)).then( (content) => {
					c(content);
				});
			});
		});
	}
}

export class IOTTreeDataProvider implements vscode.TreeDataProvider<IOTNode>, vscode.TextDocumentContentProvider {

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

	constructor(context: vscode.ExtensionContext) {
		const iotModel = new IOTModel('192.168.0.245', 8881, 'admin', 'admin1');
		const treeDataProvider = new IOTTreeDataProvider(iotModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('iot', treeDataProvider));
		context.subscriptions.push(vscode.window.registerTreeDataProvider('IOTExplorer', treeDataProvider));

		//this.ftpViewer = vscode.window.createTreeView('ftpExplorer', { treeDataProvider });

		vscode.commands.registerCommand('IOTExplorer.refresh', () => treeDataProvider.refresh());
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