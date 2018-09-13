'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as configs from "./configurations";
import * as freeioe_client  from './freeioe_client';
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
    activeConfigName: DataBinding<string>;
}

export class Client {
    private disposables: vscode.Disposable[] = [];
    private configuration: configs.EditorProperties;
    private rootPathFileWatcher: vscode.FileSystemWatcher | undefined;
    private rootFolder: string;
    private outputChannel: vscode.OutputChannel | undefined;
    private logChannel: vscode.OutputChannel | undefined;
    private commChannel: vscode.OutputChannel | undefined;

    private device_host: string = "";
    private device_port: number = 8818;
    private device_sn: string | undefined;
    private ws_client: freeioe_client.WSClient | undefined;
    private beta_value = false;

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = {
        activeConfigName: new DataBinding<string>("")
    };

    public get ActiveConfigChanged(): vscode.Event<string> { return this.model.activeConfigName.ValueChanged; }
    
    /**
     * don't use this.rootFolder directly since it can be undefined
     */
    public get RootPath(): string {
        return this.rootFolder;
    }
    public get Beta() : boolean {
        return this.beta_value;
    }
    public get ActiveDevice() : string {
        return this.model.activeConfigName.Value;
    }
    public get ActiveDeviceConfig() : configs.DeviceConfig {
        return this.configuration.Devices[this.configuration.CurrentDevice];
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
            let conf = vscode.workspace.getConfiguration('iot_editor').get<number>('config');
            if (conf === undefined) { conf = -1;}

            this.setupOutputHandlers();
            
            this.configuration = new configs.EditorProperties(this.RootPath, conf);
            this.configuration.DevicesChanged((e) => this.onDevicesChanged(e));
            this.configuration.SelectionChanged((e) => this.onSelectedDeviceChanged(e));
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
    
    private activeFsExplorer(): void {
        vscode.commands.executeCommand('iot_editor.active_fs', this.ActiveDevice, `${this.device_host}:${this.device_port}`);
    }

    public appendOutput(log: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(log);
        }
    }
    private appendConsole(log: string) {
        if (vscode.workspace.getConfiguration('iot_editor').get('debug') === true) {
            this.appendOutput(log);
        } else {
            console.log(log);
        }
    }
    private appendLog(log: string) {
        if (this.logChannel) {
            this.logChannel.appendLine(log);
        }
    }
    private appendCom(log: string) {
        if (this.commChannel) {
            this.commChannel.appendLine(log);
        }
    }
    public get_client() : Thenable<freeioe_client.WSClient> {
        return new Promise((c, e) => {
            let client = this.ws_client;
            if (!client) {
                return e(`Client is not exists!`);
            }
            if (!client.Connected) {
                // client.once('ready', () => {
                //     return c(client);
                // });
                
                // client.on('error', (message : string) => {
                //     return e('Error while connecting: ' + message);
                // });
                return e('Connecting');
            }

			return c(client);
		});
    }
    public get_configs() : Thenable<configs.EditorProperties> {
        return new Promise((c, e) => {
            return c(this.configuration);
        });
    } 

    private connectDevice() {
        let conf = this.configuration.Devices[this.configuration.CurrentDevice];

        if (conf) {
            if (this.device_host === conf.host && this.device_port === conf.port) {
                return;
            }
            this.disconnectDevice();
            this.device_host = conf.host;
            this.device_port = conf.port;
            this.device_sn = conf.sn;
            this.appendOutput(`Start to connect device: ${this.device_host}:${this.device_port}`);

            this.ws_client = new freeioe_client.WSClient(conf);
            this.ws_client.on("device_sn_diff", (remote_sn : string) => this.on_device_sn_diff(remote_sn));
            this.ws_client.on("console", (content: string) => this.appendConsole(content));
            this.ws_client.on("log", (content: string) => this.appendLog(content));
            this.ws_client.on("comm", (content: string) => this.appendCom(content));
            this.ws_client.on("message", (code: string, data: any) => this.on_ws_message(code, data));
            this.ws_client.on("device_info", (sn: string, beta: boolean) => this.on_device_info(sn, beta));
            this.ws_client.on("ready", () => {
                vscode.window.showInformationMessage(`Device ${this.device_host}:${this.device_port} connnected!`);
                this.refresh_views();
                this.activeFsExplorer();
            });
            this.ws_client.on("error", (message: string) => {
                vscode.window.showInformationMessage(`Device connnect failed! ${message}`);
                this.refresh_views();
            });
            this.ws_client.on("disconnect", (code: number, reason: string) => {
                vscode.window.showInformationMessage(`Device disconnected! code:${code} reason:${reason}`);
                this.refresh_views();
            });
            this.ws_client.on("app_event", (event: WSAppEvent) => { this.refresh_views(); });
            this.ws_client.on("event", (event: WSEvent) => { this.refresh_event_view(); });
            this.ws_client.connect();
        }
    }
    private refresh_views() : void {
        vscode.commands.executeCommand('IOTEventViewer.refresh');
        vscode.commands.executeCommand('IOTDeviceViewer.refresh');
    }
    private refresh_event_view() : void {
        vscode.commands.executeCommand('IOTEventViewer.refresh');
    }
    private on_device_sn_diff(remote_sn: string) {
        if (!this.device_sn) {
            return;
        }
        ui.showIncorrectSN(remote_sn, this.device_sn).then((sn: string) => {
            if (sn !== this.device_sn) {
                this.updateDeviceSN(sn);
            } else {
                setTimeout(async ()=>{
                    this.disconnectDevice();
                }, 1000);
            }
        });
    }
    private on_device_info(remote_sn: string, beta: boolean) {
        if (this.device_sn && this.device_sn !== remote_sn) {
            return;
        }
        if (!this.device_sn) {
            this.updateDeviceSN(remote_sn);
        } else {
            this.device_sn = remote_sn;
        }
        this.beta_value = beta;
    }
    
    private on_ws_message( code: string, data: any) {
        this.appendOutput(`WebSocket message: ${code} ${data}`);
    }
    private disconnectDevice() {
        this.device_host = "";
        this.device_port = 8818;
        this.device_sn = undefined;
        if (this.ws_client !== undefined) {
            this.appendOutput(`Disconnect from device: ${this.device_host}:${this.device_port}`);
            this.ws_client.disconnect();
            this.ws_client = undefined;
        }
    }
    
    private onDevicesChanged(devices: configs.DeviceConfig[]): void {
        console.log('[Client] onDevicesChanged');
        if (this.configuration.CurrentDevice === -1 || this.configuration.CurrentDevice >= devices.length) {
            return;
        }
        let params: FolderSettingsParams = {
            devices: devices,
            currentDevice: this.configuration.CurrentDevice
        };
        this.model.activeConfigName.Value = devices[params.currentDevice].name;
        
        this.connectDevice();
    }

    private onSelectedDeviceChanged(index: number): void {
        console.log('[Client] onSelectedDeviceChanged');
        if (index === -1) {
            return;
        }

        this.model.activeConfigName.Value = this.configuration.DeviceNames[index];
        vscode.workspace.getConfiguration('iot_editor').update('config', index);
        
        this.connectDevice();
    }

    /*********************************************
     * command handlers
     *********************************************/
    public handleDisconnectCommand(): void {
        this.disconnectDevice();
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
        ui.showApplicationCreate().then(( app: freeioe_client.Application|undefined) => {
            if (!app || !this.ws_client) {
                return;
            }
            this.ws_client.create_app(app);
        });
    }

    public startApplication(inst: string): Thenable<void> {
        console.log('Start Application', inst);
        return this.get_client().then( (client) => {
            client.start_app(inst).then( (result: boolean) => {
                vscode.window.showInformationMessage(`Application ${inst} started!`);
                this.refresh_views();
            }, (reason) => {
                vscode.window.showInformationMessage(`Application start failed! ${reason}`);
            });
        });
    }
    public stopApplication(inst: string, reason: string): Thenable<void> {
        console.log('Stop Application', inst);
        return this.get_client().then( (client) => {
            client.stop_app(inst, reason).then( (result: boolean) => {
                vscode.window.showInformationMessage(`Application ${inst} stoped!`);
                this.refresh_views();
            }, (reason) => {
                vscode.window.showInformationMessage(`Application start failed! ${reason}`);
            });
        });
    }
    public restartApplication(inst: string, reason: string): Thenable<void> {
        console.log('Restart Application', inst);
        return this.get_client().then( (client) => {
            client.restart_app(inst, reason).then( (result: boolean) => {

                vscode.window.showInformationMessage(`Application ${inst} started!`);
                this.refresh_views();
            }, (reason) => {
                vscode.window.showInformationMessage(`Application start failed! ${reason}`);
            });
        });
    }
    public configApplication(inst: string): Thenable<void> {
        console.log('Config Application', inst);
        return this.get_client().then( (client) => {
            // TODO:
        });
    }
    private updateDeviceSN(sn:string) {
        let conf = this.configuration.Devices[this.configuration.CurrentDevice];
        if (conf) {
            conf.sn = sn;
        }
        this.configuration.saveToFile();
        this.device_sn = sn;
    }

    public onInterval(): void {
        if (this.configuration !== undefined) {
            this.configuration.checkEditorProperties();
        }
    }

    public dispose(): Thenable<void> {
        this.disconnectDevice();

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