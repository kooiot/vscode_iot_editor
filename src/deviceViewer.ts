'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as client from './client';
import * as configs from './configurations';
import * as freeioe_client from './freeioe_client';


export interface DeviceNode {
	resource: vscode.Uri;
	device: boolean;
	connected?: boolean;
	config?: configs.DeviceConfig;
	app?: freeioe_client.Application;
}

interface IOTDeviceNode {
	device: string;
	app: string;
}
export class DeviceTreeModel {

	//private apps: Map<string, IOTNode> = new Map<string, IOTNode>();

	constructor(readonly client: client.Client) {
	}

	public get_wsclient(): Thenable<freeioe_client.WSClient> {
		return this.client.get_client().then( client => client);
	}
	
    public getDevice(name: string) : Thenable<[configs.DeviceConfig,boolean]> {
		return this.client.get_configs().then( (configs: configs.EditorProperties) => {
			return new Promise((c, e) => {
				let index = 0;
				for (let dev of configs.Devices) {
					if (dev.name === name) {
						return c([dev, index === configs.CurrentDevice]);
					}
					index++;
				}
				return e('Device Not Found');
			});
		});
	}

	public validDevice(dev: string): Thenable<void> {
		return new Promise((c, e) => {
			if (this.client.ActiveDevice === dev) {
				return c();
			} else {
				return e('Not Valid device');
			}
		});
	}

	public getDeviceInfo(device: string) : Thenable<Object> {
		return this.getDevice(device).then( info => info[1] ? this.get_wsclient().then(client => client.device_info()) : info[0]);
	}
	
	public getApplication(device: string, inst: string): Thenable<freeioe_client.Application> {
		return this.getDevice(device).then((dev: [configs.DeviceConfig, boolean]) => {
			return new Promise((c, e) => {
				if (!dev[1]) {
					return e(`Device ${device} is not connected!`);
				} else {
					return this.get_wsclient().then(client => {
						return client.list_apps().then((list) => {
							for (let app of list) {
								if (app.inst === inst) {
									return c(app);
								}
							}
							return e(`Application ${inst} not found in device ${device}`);
						}, (reason) => {
							return e(reason);
						});
					});
				}
			});
		});
	}
	

	public get ActiveDeviceNode(): DeviceNode {
		let dev = this.client.ActiveDeviceConfig;
		return {
			resource: vscode.Uri.parse(`freeioe://${dev.host}/${dev.name}.json`),
			device: true,
			connected: true,
			config: dev,
		};
	}

	public get roots(): Thenable<DeviceNode[]> {
		return this.client.get_configs().then((configs: configs.EditorProperties) => {
			return new Promise((c, e) => {
				let list: DeviceNode[] = [];
				for (let dev of configs.Devices) {
					list.push({
						resource: vscode.Uri.parse(`freeioe://${dev.host}/${dev.name}.json`),
						device: true,
						connected: false,
						config: dev,
					});
				}
				let cur_sel = configs.CurrentDevice;
				if (cur_sel >= 0 && cur_sel < list.length) {
					list[cur_sel].connected = true;
				}
				return c(list);
			});
		});
	}

	public getChildren(node: DeviceNode): DeviceNode[] |  Thenable<DeviceNode[]> {
		if (!node.device) {
			return [];
		}
		if (!node.connected) {
			return [];
		}

		return this.get_wsclient().then(client => {
			return client.list_apps().then((list) => {
				return new Promise((c, e) => {
					return c(list.map(entry => ({
						resource: vscode.Uri.parse(`freeioe_app://${node.resource.authority}${this.remove_ext(node.resource.path)}/${entry.inst}.json`),
						device: false,
						connected: entry.running,
						app: entry,
					})));
				});
			});
		});
	}

	public connect(device_node: DeviceNode): Thenable<void> {
		let name = device_node.resource.path.substr(1);
		name = this.remove_ext(name);
		return this.client.get_configs().then((configs: configs.EditorProperties) => {
			return new Promise((c, e) => {
				let index = 0;
				for (let dev of configs.Devices) {
					if (dev.name === name) {
						configs.select(index);
						return c();
					}
					index++;
				}
				return e(`Device ${name} not found`);
			});
		});
	}

	private remove_ext(filename : string) {
		let ext = path.extname(filename);
		return filename.substr(0, filename.length - ext.length);
	}

	public parse_uri(resource: vscode.Uri) : IOTDeviceNode {
		let uri_path = resource.path.substr(1);
		let device = uri_path.split('/')[0];
		let app = uri_path.split('/')[1];
		if (app) {
			app = this.remove_ext(app);
		} else {
			device = this.remove_ext(device);
		}
		return {
			device: device,
			app: app,
		};
	}

	public applicationStart(device_node: DeviceNode): Thenable<void> {
		let node = this.parse_uri(device_node.resource);
		return this.validDevice(node.device).then(() => {
			return this.client.startApplication(node.app);
		});
	}

	public applicationStop(device_node: DeviceNode): Thenable<void> {
		let node = this.parse_uri(device_node.resource);
		return this.validDevice(node.device).then(() => {
			return this.client.stopApplication(node.app, 'Stop from IOTExplorer');
		});
	}

	public applicationRestart(device_node: DeviceNode): Thenable<void> {
		let node = this.parse_uri(device_node.resource);
		return this.validDevice(node.device).then(() => {
			return this.client.restartApplication(node.app, 'Restart from IOTExplorer');
		});
	}

	public applicationConfig(device_node: DeviceNode): Thenable<void> {
		let node = this.parse_uri(device_node.resource);
		return this.validDevice(node.device).then(() => {
			return this.client.configApplication(node.app);
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
			this._onDidChange.fire(this.model.ActiveDeviceNode.resource);
		}
	}

	public refresh(): any {
		this._onDidChangeTreeData.fire();
	}
	public reload(device_node: DeviceNode): any {
		this._onDidChange.fire(device_node.resource);
	}

	public getTreeItem(element: DeviceNode): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			label: element.device ? (element.config ? element.config.name : "Device") : (element.app ? element.app.inst : "Application"),
            collapsibleState: (element.device && element.connected) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
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
			let config = element.config;
			if (config) {
				return `Device SN: ${config.sn}\nHost: ${config.host}\nPort: ${config.port}`;
			}
		} else {
			let app = element.app;
			if (app) {
				return `Application: ${app.name}\nVersion: ${app.version}\nRunning: ${app.running}`;
			}
		}
	}

	private getTreeItemIcon(element: DeviceNode) {
		if (element.device) {
			if (element.connected) {
				return {
					light: this.context.asAbsolutePath(path.join('media', 'light', 'device_link.svg')),
					dark: this.context.asAbsolutePath(path.join('media', 'dark', 'device_link.svg'))
				};
			} else {
				return {
					light: this.context.asAbsolutePath(path.join('media', 'light', 'device.svg')),
					dark: this.context.asAbsolutePath(path.join('media', 'dark', 'device.svg'))
				};
			}
		} else {
			if (element.connected) {
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
		let node = this.model.parse_uri(uri);
		if (!node.app) {
			// return this.model.getDevice(node.device).then( dev => {
			// 	return JSON.stringify(dev[0], null, 4);
			// });
			return this.model.getDeviceInfo(node.device).then( info => JSON.stringify(info, null, 4));
		} else {
			return this.model.getApplication(node.device, node.app).then( app => JSON.stringify(app, null, 4));
		}
    }
}


export class IOTDeviceViewer {
	private treeModel: DeviceTreeModel;
	private treeDataProvider: DeviceTreeDataProvider;
	private iotViewer: vscode.TreeView<DeviceNode>;

	constructor(context: vscode.ExtensionContext, device_client: client.Client) {

		this.treeModel = new DeviceTreeModel(device_client);
		this.treeDataProvider = new DeviceTreeDataProvider(context, this.treeModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('freeioe', this.treeDataProvider));
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('freeioe_app', this.treeDataProvider));
		this.iotViewer = vscode.window.createTreeView('IOTDeviceViewer', { treeDataProvider: this.treeDataProvider });

		vscode.commands.registerCommand('IOTDeviceViewer.refresh', () => this.treeDataProvider.refresh());
		vscode.commands.registerCommand('IOTDeviceViewer.openFile', resource => this.openResource(resource));
		vscode.commands.registerCommand('IOTDeviceViewer.revealResource', () => this.reveal());
		vscode.commands.registerCommand('IOTDeviceViewer.settings', () => this.settings());
		
		vscode.commands.registerCommand('IOTDeviceViewer.reload', (device_node) => this.treeDataProvider.reload(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.connect', (device_node) => this.treeModel.connect(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationStart', (device_node) => this.treeModel.applicationStart(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationStop', (device_node) => this.treeModel.applicationStop(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationRestart', (device_node) => this.treeModel.applicationRestart(device_node));
		vscode.commands.registerCommand('IOTDeviceViewer.applicationConfig', (device_node) => this.treeModel.applicationConfig(device_node));
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
			let uri = vscode.window.activeTextEditor.document.uri;
			if (uri.scheme === 'freeioe') {
				return { resource: uri, device: true, connected: false };
			}
			if (uri.scheme === 'freeioe_app') {
				return { resource: uri, device: false, connected: false };
			}
		}
		return undefined;
	}

	public onInterval() {
		this.treeDataProvider.onInterval();
	}
}