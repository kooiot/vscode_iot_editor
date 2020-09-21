'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from "fs";
import * as client from './client_mgr';
import * as configs from './configurations';
import * as freeioe_client from './freeioe_client';


export interface DeviceNode {
	resource: vscode.Uri;
	device: boolean;
	enabled?: boolean; // device selection
	status?: boolean;
	config?: configs.DeviceConfig;
	app?: freeioe_client.Application;
}

export class DeviceTreeModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly mgr: client.ClientMgr) { }

	private getDeviceInfo(uri: vscode.Uri) : Thenable<any> {
		return this.mgr.getClient(uri).then( client => {
			return client.device_info();
		},
		(reason) => {
			const device = this.get_device(uri);
			return this.mgr.getDeviceConfig(device);
		});
	}

	private getApplicationInfo(uri: vscode.Uri): Thenable<freeioe_client.Application> {
		const inst = this.get_app(uri);
		if (!inst) {
			return Promise.reject(`Not an application node ${uri}`);
		}
		return this.mgr.getClient(uri).then( client => {
			return client.list_apps().then((list) => {
				return new Promise((c, e) => {
					for (const app of list) {
						if (app.inst === inst) {
							return c(app);
						}
					}
					return e(`Application ${inst} not found in device ${uri}`);
				});
			});
		});
	}

	public getInfo(uri: vscode.Uri) {
		if (uri.scheme === 'freeioe') {
			return this.getDeviceInfo(uri);
		} else {
			return this.getApplicationInfo(uri);
		}
	}

	public get roots(): Thenable<DeviceNode[]> {
		return new Promise((c, e) => {
			const list: DeviceNode[] = [];
			for (const dev of this.mgr.Devices) {
				const device_uri = this.mgr.getDeviceUri(dev.name, 'freeioe');
				list.push({
					resource: vscode.Uri.parse(`${device_uri}${dev.name}.json`),
					device: true,
					enabled: this.mgr.isConnect(dev.name),
					status: true,
					config: dev,
				});
			}
			return c(list);
		});
	}

	public getChildren(node: DeviceNode): DeviceNode[] |  Thenable<DeviceNode[]> {
		if (!node.device) {
			return [];
		}

		return this.mgr.getClient(node.resource).then(client => {
			return client.list_apps().then((list) => {
				return new Promise((c, e) => {
					return c(list.map(entry => ({
						resource: vscode.Uri.parse(`freeioe_app://${node.resource.authority}${this.remove_ext(node.resource.path)}/${entry.inst}.json`),
						device: false,
						status: entry.running,
						app: entry,
					})));
				});
			});
		}, (reason) => {
			return Promise.resolve([]);
		});
	}

	public connect(device_node: DeviceNode): Thenable<freeioe_client.WSClient> {
		const name = device_node.resource.path.substr(1);
		const device_name = this.remove_ext(name);
		return this.mgr.connect(device_name).then( client => client);
	}
	public disconnect(device_node: DeviceNode) : void {
		const name = device_node.resource.path.substr(1);
		const device_name = this.remove_ext(name);
		this.mgr.disconnect(device_name);
	}
	public setDefault(device_node: DeviceNode) : void {
		const name = device_node.resource.path.substr(1);
		const device_name = this.remove_ext(name);
		this.mgr.setDefaultDevice(device_name);
	}

	private remove_ext(filename : string) {
		const ext = path.extname(filename);
		return filename.substr(0, filename.length - ext.length);
	}

	public get_app(resource: vscode.Uri) : string | undefined {
		const uri_path = resource.path.substr(1);
		const uri_path_array = uri_path.split('/');
		//let device = uri_path.split('/')[0];
		const app = uri_path_array[1];
		if (app) {
			return this.remove_ext(app);
		}
		return undefined;
	}
	public get_device(resource: vscode.Uri) : string {
		const uri_path = resource.path.substr(1);
		const uri_path_array = uri_path.split('/');
		let device = uri_path_array[0];
		const app = uri_path_array[1];
		if (!app) {
			device = this.remove_ext(device);
		}
		return device;
	}

	public applicationStart(node: DeviceNode): Thenable<void> {
		return this.mgr.getClient(node.resource).then(() => {
			const app = this.get_app(node.resource);
			if (!app) {
				return Promise.reject(`Node is not inside an application ${node.resource}`);
			}
			return this.mgr.startApplication(node.resource, app);
		});
	}

	public applicationStop(node: DeviceNode): Thenable<void> {
		return this.mgr.getClient(node.resource).then(() => {
			const app = this.get_app(node.resource);
			if (!app) {
				return Promise.reject(`Node is not inside an application ${node.resource}`);
			}
			return this.mgr.stopApplication(node.resource, app, 'Stop from IOTExplorer');
		});
	}

	public applicationRestart(node: DeviceNode): Thenable<void> {
		return this.mgr.getClient(node.resource).then(() => {
			const app = this.get_app(node.resource);
			if (!app) {
				return Promise.reject(`Node is not inside an application ${node.resource}`);
			}
			return this.mgr.restartApplication(node.resource, app, 'Restart from IOTExplorer');
		});
	}

	public applicationConfig(node: DeviceNode): Thenable<void> {
		return this.mgr.getClient(node.resource).then(() => {
			const app = this.get_app(node.resource);
			if (!app) {
				return Promise.reject(`Node is not inside an application ${node.resource}`);
			}
			return this.mgr.configApplication(node.resource, app);
		});
	}

	public applicationDownload(node: DeviceNode) : Thenable<void> {
		return this.mgr.getClient(node.resource).then(() => {
			const app = this.get_app(node.resource);
			if (!app) {
				return Promise.reject(`Node is not inside an application ${node.resource}`);
			}
			return this.mgr.downloadApplication(node.resource, app, undefined).then( (content) => {
				vscode.window.showSaveDialog({saveLabel: 'Application Package File Save To..', filters : {
					'FreeIOE Application Package': ['zip', 'ZIP']}}).then( (file_uri) => {
						if (file_uri) {
							fs.writeFileSync(file_uri.fsPath, new Buffer(content, 'base64'));
						}
					});
			});
		});
	}
}


export class DeviceTreeDataProvider implements vscode.TreeDataProvider<DeviceNode>, vscode.TextDocumentContentProvider  {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

	constructor(private context: vscode.ExtensionContext, private readonly model: DeviceTreeModel) { }

	public onInterval() {
        if (vscode.workspace.getConfiguration('iot_editor').get('refresh_device_info') === true) {
			this.model.roots.then( (devices : DeviceNode[]) => {
				for (const dev of devices) {
					this._onDidChange.fire(dev.resource);
				}
			});
		}
	}

	public refresh(resource?: any): any {
		if (!resource || resource.scheme === 'freeioe') {
			this._onDidChangeTreeData.fire(null);
		} else {
			this._onDidChangeTreeData.fire(resource);
		}
	}
	public reload(device_node: DeviceNode): any {
		this._onDidChange.fire(device_node.resource);
	}

	public getTreeItem(element: DeviceNode): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			label: element.device ? (element.config ? element.config.name : "Device") : (element.app ? element.app.inst : "Application"),
            collapsibleState: (element.device && element.enabled) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            iconPath:this.getTreeItemIcon(element),
			tooltip: this.getTreeItemTooltip(element),
			contextValue: element.device ? 'FreeIOE.Device' : 'FreeIOE.Application',
			command: {
				command: 'IOTDeviceViewer.openFile',
				arguments: [element.resource],
				title: 'Open Device Configuration'
			}
		};
	}

	private getTreeItemTooltip(element: DeviceNode): string | undefined {
		if (element.device) {
			const config = element.config;
			if (config) {
				return `Device SN: ${config.sn}\nHost: ${config.host}\nPort: ${config.port}`;
			}
		} else {
			const app = element.app;
			if (app) {
				return `Application: ${app.name}\nVersion: ${app.version}\nRunning: ${app.running}`;
			}
		}
	}

	private getTreeItemIcon(element: DeviceNode) {
		if (element.device) {
			if (element.enabled) {
				return {
					light: this.context.asAbsolutePath(path.join('media', 'light', element.status ? 'device_link.svg' : 'disconnect.svg')),
					dark: this.context.asAbsolutePath(path.join('media', 'dark', element.status ? 'device_link.svg' : 'disconnect.svg'))
				};
			} else {
				return {
					light: this.context.asAbsolutePath(path.join('media', 'light', 'device.svg')),
					dark: this.context.asAbsolutePath(path.join('media', 'dark', 'device.svg'))
				};
			}
		} else {
			if (element.status) {
				return {
					light: this.context.asAbsolutePath(path.join('media', 'light', 'checked.svg')),
					dark: this.context.asAbsolutePath(path.join('media', 'dark', 'checked.svg'))
				};
			} else {
				return {
					light: this.context.asAbsolutePath(path.join('media', 'light', 'closed.svg')),
					dark: this.context.asAbsolutePath(path.join('media', 'dark', 'closed.svg'))
				};
			}
		}
	}

	public getChildren(element?: DeviceNode): DeviceNode[] | Thenable<DeviceNode[]> {
		return element ? this.model.getChildren(element) : this.model.roots;
	}

	public getParent(element: DeviceNode): DeviceNode | undefined {
		return undefined;
    }

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		return this.model.getInfo(uri).then(obj => JSON.stringify(obj, null, 4));
    }
}


export class IOTDeviceViewer {
	private treeModel: DeviceTreeModel;
	private treeDataProvider: DeviceTreeDataProvider;
	private iotViewer: vscode.TreeView<DeviceNode>;

	constructor(context: vscode.ExtensionContext, client_mgr: client.ClientMgr) {

		this.treeModel = new DeviceTreeModel(client_mgr);
		this.treeDataProvider = new DeviceTreeDataProvider(context, this.treeModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('freeioe', this.treeDataProvider));
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('freeioe_app', this.treeDataProvider));
		this.iotViewer = vscode.window.createTreeView('IOTDeviceViewer', { treeDataProvider: this.treeDataProvider });

		client_mgr.DeviceStatusChanged( client => this.treeDataProvider.refresh(client.DeviceUri));

		vscode.commands.registerCommand('IOTDeviceViewer.refresh', (resource?: any) => this.treeDataProvider.refresh(resource));
		vscode.commands.registerCommand('IOTDeviceViewer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTDeviceViewer.revealResource', () => this.reveal());
		vscode.commands.registerCommand('IOTDeviceViewer.settings', () => this.settings());

		vscode.commands.registerCommand('IOTDeviceViewer.reload', (device_node) => this.treeDataProvider.reload(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.connect', (device_node) => this.treeModel.connect(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.disconnect', (device_node) => this.treeModel.disconnect(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.setDefault', (device_node) => this.treeModel.setDefault(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationStart', (device_node) => this.treeModel.applicationStart(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationStop', (device_node) => this.treeModel.applicationStop(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationRestart', (device_node) => this.treeModel.applicationRestart(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationConfig', (device_node) => this.treeModel.applicationConfig(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationDownload', (device_node) => this.treeModel.applicationDownload(device_node));
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

	private settings(): void {
		vscode.commands.executeCommand('iot_editor.configurationEdit');
	}

	private getNode(): DeviceNode | undefined {
		if (vscode.window.activeTextEditor) {
			const uri = vscode.window.activeTextEditor.document.uri;
			if (uri.scheme === 'freeioe') {
				return { resource: uri, device: true };
			}
			if (uri.scheme === 'freeioe_app') {
				return { resource: uri, device: false };
			}
		}
		return undefined;
	}

	public onInterval() {
		this.treeDataProvider.onInterval();
	}
}