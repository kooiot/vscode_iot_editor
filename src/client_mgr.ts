'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as configs from "./configurations";
import { WSClient, Application }  from './freeioe_client';
import { UI, getUI } from './ui';
import { DataBinding } from './dataBinding';
import { WSAppEvent, WSEvent } from './freeioe_ws';

let ui: UI;

let previousEditorSettings: { [key: string]: any } = {};

interface FolderSettingsParams {
    currentDevice: number;
    devices: any[];
}

interface ClientModel {
    defaultDeviceName: DataBinding<string>;
}

export class ClientMgr {
    private disposables: vscode.Disposable[] = [];
    private configuration: configs.EditorProperties;
    private rootPathFileWatcher: vscode.FileSystemWatcher | undefined;
    private rootFolder: string;
    private outputChannel: vscode.OutputChannel | undefined;
    private logChannel: vscode.OutputChannel | undefined;
    private commChannel: vscode.OutputChannel | undefined;

    private _clients: Map<number, WSClient> = new Map();

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = {
        defaultDeviceName: new DataBinding<string>("")
    };

    public get DefaultDeviceChanged(): vscode.Event<string> { return this.model.defaultDeviceName.ValueChanged; }
    public get DevicesChanged(): vscode.Event<configs.DeviceConfig[]> { return this.configuration.DevicesChanged; }

    private _deviceStatus: vscode.EventEmitter<WSClient> = new vscode.EventEmitter<WSClient>();
	readonly DeviceStatusChanged: vscode.Event<WSClient> = this._deviceStatus.event;

    public get Devices() {
        return this.configuration.Devices;
    }
    public getDeviceUri(device: string, schema: string) : vscode.Uri {
        for (let c of this.configuration.Devices) {
            if (c.name === device) {
                return vscode.Uri.parse(`${schema}://${c.host}:${c.port}/`);
            }
        }
        return vscode.Uri.parse(`${schema}://localhost/`);
    }
    
    /**
     * don't use this.rootFolder directly since it can be undefined
     */
    public get RootPath(): string {
        return this.rootFolder;
    }
    public get Clients() : WSClient[] {
        return Array.from(this._clients.values());
    }
    public getClient(device_uri: vscode.Uri) : Thenable<WSClient> {
        return new Promise((c, e) => {
            for (let client of this.Clients) {
                if (client.FsUri.authority === device_uri.authority) {
                    return c(client);
                }
            }
            return e(`Device is not found for ${device_uri}`);
        });
    }
    public getClientByName(device: string): Thenable<WSClient> {
        return new Promise((c, e) => {
            for (let client of this.Clients) {
                if (client.Config.name === device) {
                    return c(client);
                }
            }
            return e(`Device ${device} not connected!`);
        });
    }
    public getDeviceConfig(device: string) : Thenable<configs.DeviceConfig> {
        for (let c of this.configuration.Devices) {
            if (c.name === device) {
                return Promise.resolve(c);
            }
        }
        return Promise.reject(`Device ${device} not found!`);
    }
    public connect(device: string): Thenable<WSClient> {
        for (let client of this.Clients) {
            if (client.Config.name === device) {
                return client.connect();
            }
        }
        let devices = this.configuration.DeviceNames;
        for (let i = 0; i < devices.length; i++) {
            if (devices[i] === device) {
                return this.connectDevice(i);
            }
        }
        return Promise.reject(`Device ${device} not found!`);
    }
    public disconnect(device: string) {
        let devices = this.configuration.DeviceNames;
        for (let i = 0; i < devices.length; i++) {
            if (devices[i] === device) {
                return this.disconnectDevice(i);
            }
        }
    }
    public isConnect(device : number | string | vscode.Uri) {
        if (typeof device === 'number') {
            return this._clients.get(device) !== undefined;
        }
        if (typeof device === 'string') {
            for (let client of this.Clients) {
                if (client.Config.name === device) {
                    return true;
                }
            }
        }
        if (device instanceof vscode.Uri) {
            for (let client of this.Clients) {
                if (client.FsUri.authority === device.authority) {
                    return true;
                }
            }
        }
        return false;
    }
    public isConnected(device : number | string | vscode.Uri) : boolean {
        if (typeof device === 'string') {
            for (let c of this._clients) {
                if (c[1].Config.name === device) {
                    device = c[0];
                    break;
                }
            }
        }
        if (device instanceof vscode.Uri) {
            for (let c of this._clients) {
                if (c[1].FsUri.authority === device.authority) {
                    device = c[0];
                    break;
                }
            }
        }
        if (typeof device === 'number') {
            let client = this._clients.get(device);
            return client ? client.Connected : false;
        }
        return false;
    }
    public setDefaultDevice(device: string) {
        let deviceNames = this.configuration.DeviceNames;
        for (let i = 0; i < deviceNames.length; i++) {
            if (deviceNames[i] === device) {
                return this.configuration.select(i);
            }
        }
    }

    public onDidChangeSettings(): void {
        // This relies on getNonDefaultSettings being called first.
        console.assert(Object.keys(previousEditorSettings).length > 0);

        // let filter: (key: string, val: string) => boolean = (key: string, val: string) => {
        //     return !(key in previousEditorSettings) || val !== previousEditorSettings[key];
        // };
    }

    public onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
    }
    
    
    // private get CurrentApplications(): string[] { 
    //     let result: string[] = [];
    //     this.device_apps.forEach((app: Application) => result.push(app.inst));
    //     return result;
    // }

    constructor( rootFolder: string) {
        this.rootFolder = rootFolder;
        ui = getUI();
        ui.bind(this);
        
        try {
            let conf = vscode.workspace.getConfiguration('iot_editor').get<number>('default');
            if (conf === undefined) { conf = -1;}

            this.setupOutputHandlers();
            
            this.configuration = new configs.EditorProperties(this.RootPath, conf);
            this.configuration.DevicesChanged((e) => this.onDevicesChanged(e));
            this.configuration.DefaultDeviceChanged((e) => this.onDefaultDeviceChanged(e));
            this.disposables.push(this.configuration);
            
            this.registerFileWatcher();
        }
        catch(err) {
            vscode.window.showErrorMessage('Failed to open : ' + err.message);
            console.log(err.message);
            throw err;
        }
    }

    /**
     * listen for file created/deleted events under the ${workspaceFolder} folder
     */
    private registerFileWatcher(): void {
        if (this.rootFolder) {
            // WARNING: The default limit on Linux is 8k, so for big directories, this can cause file watching to fail.
            this.rootPathFileWatcher = vscode.workspace.createFileSystemWatcher(
                path.join(this.RootPath, "*"),
                false /*ignoreCreateEvents*/,
                true /*ignoreChangeEvents*/,
                false /*ignoreDeleteEvents*/);

            this.rootPathFileWatcher.onDidCreate((uri) => {
                //this.languageClient.sendNotification(FileCreatedNotification, { uri: uri.toString() });
            });

            this.rootPathFileWatcher.onDidDelete((uri) => {
                //this.languageClient.sendNotification(FileDeletedNotification, { uri: uri.toString() });
            });

            this.disposables.push(this.rootPathFileWatcher);
        } else {
            this.rootPathFileWatcher = undefined;
        }
    }

    /**
     * listen for logging messages from the language server and print them to the Output window
     */
    private setupOutputHandlers(): void {
        if (this.outputChannel === undefined) {
            this.outputChannel = vscode.window.createOutputChannel(`IOT EDITOR`);
            this.disposables.push(this.outputChannel);
        }
        if (this.commChannel === undefined) {
            //this.debugChannel = vscode.window.createOutputChannel(`IOT 报文: ${this.Name}`);
            this.commChannel = vscode.window.createOutputChannel(`IOT 设备报文`);
            this.disposables.push(this.commChannel);
        }
        if (this.logChannel === undefined) {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
                //this.logChannel = vscode.window.createOutputChannel(`IOT 日志: ${this.Name}`);
                this.logChannel = vscode.window.createOutputChannel(`IOT 设备日志`);
            } else {
                //this.logChannel = vscode.window.createOutputChannel(`IOT 日志: ${this.Name}`); //logger.getOutputChannel();
                this.logChannel = vscode.window.createOutputChannel(`IOT 设备日志`); //logger.getOutputChannel();
            }
            this.disposables.push(this.logChannel);
        }
    }
    
    public appendOutput(client: WSClient, log: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`${client.Config.name} [${client.Config.host}:${client.Config.port}]: ${log}`);
        }
    }
    private appendConsole(client: WSClient, log: string) {
        if (vscode.workspace.getConfiguration('iot_editor').get('debug') === true) {
            this.appendOutput(client, log);
        } else {
            console.log(client.FsUri.toString(), log);
        }
    }
    private appendLog(client: WSClient, log: string) {
        if (this.logChannel) {
            this.logChannel.appendLine(`${client.Config.name} [${client.Config.host}:${client.Config.port}]: ${log}`);
        }
    }
    private appendCom(client: WSClient, log: string) {
        if (this.commChannel) {
            this.commChannel.appendLine(`${client.Config.name} [${client.Config.host}:${client.Config.port}]: ${log}`);
        }
    }

    private activeFsExplorer(client: WSClient): void {
        vscode.commands.executeCommand('iot_editor.activeFS', client.Config.name, client.FsUri);
    }

    private ConfigEqual(l: configs.DeviceConfig, r: configs.DeviceConfig): boolean {
        if (l.host !== r.host) { return false; }
        if (l.port !== r.port) { return false; }
        if (l.sn !== r.sn) { return false; }
        if (l.user !== r.user) { return false; }
        if (l.password !== r.password) { return false; }
        return true;
    }

    private connectDevice(index: number) : Thenable<WSClient> {
        let conf = this.configuration.Devices[index];

        if (conf) {
            let client = this._clients.get(index);
            if (client) {
                let config = client.Config;
                if (this.ConfigEqual(config, conf)) {
                    return Promise.resolve(client);
                }
                this.disconnectDevice(index);
            }

            let ws_client = new WSClient(conf, this.configuration.AuthCode);
            this.appendOutput(ws_client, `Start to connect device: ${conf.host}:${conf.port}`);
            this._clients.set(index, ws_client);
            ws_client.on("device_sn_diff", (remote_sn : string) => this.on_device_sn_diff(ws_client, remote_sn));
            ws_client.on("console", (content: string) => this.appendConsole(ws_client, content));
            ws_client.on("log", (content: string) => this.appendLog(ws_client, content));
            ws_client.on("comm", (content: string) => this.appendCom(ws_client, content));
            ws_client.on("message", (code: string, data: any) => this.on_ws_message(ws_client, code, data));
            ws_client.on("device_info", (sn: string, beta: boolean) => this.on_device_info(ws_client, sn, beta));
            ws_client.on("ready", () => {
                vscode.window.showInformationMessage(`Device ${ws_client.Config.host}:${ws_client.Config.port} connnected!`);
                this.activeFsExplorer(ws_client);
                this._deviceStatus.fire(ws_client);
            });
            ws_client.on("error", (message: string) => {
                vscode.window.showErrorMessage(`Device connnect failed! ${message}`);
                this._deviceStatus.fire(ws_client);
            });
            ws_client.on("disconnect", (code: number, reason: string) => {
                vscode.window.showInformationMessage(`Device ${ws_client.Config.host}:${ws_client.Config.port} disconnected! code:${code} reason:${reason}`);
                this._deviceStatus.fire(ws_client);
            });
            ws_client.on("app_event", (event: WSAppEvent) => { this.refresh_device_view(ws_client); });
            ws_client.on("event", (event: WSEvent) => { this.refresh_event_view(ws_client); });
            ws_client.connect();
            this._deviceStatus.fire(ws_client);
            return Promise.resolve(ws_client);
        }
        return Promise.reject(`Device not found!`);
    }
    private refresh_views() : void {
        vscode.commands.executeCommand('IOTEventViewer.refresh');
        vscode.commands.executeCommand('IOTDeviceViewer.refresh');
    }
    private refresh_device_view(client: WSClient) : void {
        vscode.commands.executeCommand('IOTDeviceViewer.refresh', client.DeviceUri);
    }
    private refresh_event_view(client: WSClient) : void {
        vscode.commands.executeCommand('IOTEventViewer.refresh', client.EventUri);
    }
    private on_device_sn_diff(client: WSClient, remote_sn: string) {
        if (!client.Config.sn) {
            return;
        }
        ui.showIncorrectSN(remote_sn, client.Config.sn).then((sn: string) => {
            if (sn !== client.Config.sn) {
                this.updateDeviceSN(client, sn);
            } else {
                setTimeout(async ()=>{
                    this._disconnectDevice(client);
                }, 1000);
            }
        });
    }
    private on_device_info(client: WSClient, remote_sn: string, beta: boolean) {
        if (client.Config.sn && client.Config.sn !== remote_sn) {
            return;
        }
        if (!client.Config.sn) {
            this.updateDeviceSN(client, remote_sn);
        } else {
            client.Config.sn = remote_sn;
        }
    }
    
    private on_ws_message( client: WSClient, code: string, data: any) {
        this.appendOutput(client, `WebSocket message: ${code} ${data}`);
    }

    private _disconnectDevice( client: WSClient) : Thenable<void> {
        this.appendOutput(client, `Disconnect from device: ${client.Config.host}:${client.Config.port}`);
        client.disconnect();
        return Promise.resolve();
    }
    private disconnectDevice( index: number ) : Thenable<void> {
        let client = this._clients.get(index);
        if (client !== undefined) {
            return this._disconnectDevice(client).then( () => {
                this._deviceStatus.fire(client);
                this._clients.delete(index);
                return Promise.resolve();
            });
        }
        return Promise.reject(`Device not connected!`);
    }
    
    private onDevicesChanged(devices: configs.DeviceConfig[]): void {
        console.log('[Client] onDevicesChanged');
        if (this.configuration.DefaultDevice === -1 || this.configuration.DefaultDevice >= devices.length) {
            return;
        }
        let params: FolderSettingsParams = {
            devices: devices,
            currentDevice: this.configuration.DefaultDevice
        };

        this.model.defaultDeviceName.Value = devices[params.currentDevice].name;
        this.refresh_views();
        this.connectDevice(params.currentDevice);
    }

    private onDefaultDeviceChanged(index: number): void {
        console.log('[Client] onDefaultDeviceChanged');
        if (index === -1) {
            return;
        }

        this.model.defaultDeviceName.Value = this.configuration.DeviceNames[index];
        vscode.workspace.getConfiguration('iot_editor').update('default', index);

        console.log('[Client] onDefaultDeviceChanged connect to device');
        
        this.connectDevice(index);
    }

    /*********************************************
     * command handlers
     *********************************************/
    public handleDisconnectCommand(): void {
        ui.showConfigurations(this.configuration.DeviceNames)
        .then((index: number) => {
            if (index < 0) {
                return;
            }
            this.disconnectDevice(index);
        });
    }

    public handleConfigurationSelectCommand(): void {
        ui.showConfigurations(this.configuration.DeviceNames)
            .then((index: number) => {
                if (index < 0) {
                    return;
                }
                this.configuration.select(index);
            });
    }

    public handleConfigurationEditCommand(): void {
        this.configuration.handleConfigurationEditCommand(vscode.window.showTextDocument);
    }

    public handleApplicationCreateCommand(): void {
        ui.showConfigurations(this.configuration.DeviceNames).then((index: number) => {
            if (index < 0) {
                return;
            }
            let client = this._clients.get(index);
            if (!client) {
                vscode.window.showInformationMessage(`Device ${this.configuration.DeviceNames[index]} is not connected!`);
                return;
            }
            ui.showApplicationCreate().then((app: Application | undefined) => {
                if (!app || !client) {
                    return;
                }
                client.create_app(app);
            });
        });
    }

    public startApplication(resource: vscode.Uri, inst: string): Thenable<void> {
        console.log('Start Application', resource.toString(), resource);
        return this.getClient(resource).then( (client) => {
            return client.start_app(inst).then( () => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} started!`);
                Promise.resolve();
            }, (reason) => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} start failed! ${reason}`);
                Promise.reject(reason);
            });
        });
    }
    public stopApplication(resource: vscode.Uri, inst: string, reason: string): Thenable<void> {
        console.log('Stop Application', resource.toString(), inst);
        return this.getClient(resource).then( (client) => {
            client.stop_app(inst, reason).then( () => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} stoped!`);
                Promise.resolve();
            }, (reason) => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} stop failed! ${reason}`);
                Promise.reject(reason);
            });
        });
    }
    public restartApplication(resource: vscode.Uri, inst: string, reason: string): Thenable<void> {
        console.log('Restart Application', resource.toString(), inst);
        return this.getClient(resource).then( (client) => {
            return client.restart_app(inst, reason).then( () => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} restarted!`);
                Promise.resolve();
            }, (reason) => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} restart failed! ${reason}`);
                Promise.reject(reason);
            });
        });
    }
    public downloadApplication(resource: vscode.Uri, inst: string, version: string | undefined): Thenable<string> {
        console.log('Download Application', resource.toString(), inst);
        return this.getClient(resource).then( (client) => {
            return client.download_app(inst, version).then( (content) => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} downloaded!`);
                return content;
            }, (reason) => {
                vscode.window.showInformationMessage(`Application ${client.Name}.${inst} download failed! ${reason}`);
                Promise.reject(reason);
            });
        });
    }
    public configApplication(resource: vscode.Uri, inst: string): Thenable<void> {
        console.log('Config Application', resource.toString(), inst);
        return this.getClient(resource).then( (client) => {
            // TODO:
        });
    }
    private updateDeviceSN(client: WSClient, sn:string) {
        client.Config.sn = sn;
        for (let c of this._clients) {
            if (c[1] === client) {
                let conf = this.configuration.Devices[c[0]];
                if (conf) {
                    conf.sn = sn;
                }
                this.configuration.saveToFile();
                break;
            }
        }
    }

    public onInterval(): void {
        if (this.configuration !== undefined) {
            this.configuration.checkEditorProperties();
        }
    }

    public dispose(): Thenable<void> {
        for (let c of this._clients) {
            this.disconnectDevice(c[0]);
        }

        let promise: Thenable<void> = Promise.resolve();
        return promise.then(() => {
            this.disposables.forEach((d) => d.dispose());
            this.disposables = [];

            for (let key in this.model) {
                if (this.model.hasOwnProperty(key)) {
                    //this.model[key].dispose();
                }
            }
        });
    }
}