'use strict';

import * as path from 'path';
import * as fs from "fs";
import * as vscode from 'vscode';
import * as util from "./util";
import * as configs from "./configurations";
import * as freeioe_client  from './freeioe_client';
import { UI, getUI } from './ui';
import { DataBinding } from './dataBinding';

let ui: UI;

let previousEditorSettings: { [key: string]: any } = {};

interface FolderSettingsParams {
    currentConfiguration: number;
    configurations: any[];
}

interface ClientModel {
    activeConfigName: DataBinding<string>;
}

export class Client {
    private disposables: vscode.Disposable[] = [];
    private configuration: configs.EditorProperties;
    private rootPathFileWatcher: vscode.FileSystemWatcher | undefined;
    private rootFolder: vscode.WorkspaceFolder | undefined;
    private trackedDocuments = new Set<vscode.TextDocument>();
    private outputChannel: vscode.OutputChannel | undefined;
    private logChannel: vscode.OutputChannel | undefined;
    private commChannel: vscode.OutputChannel | undefined;

    private device_host: string = "";
    private device_port: number = 8818;
    private device_sn: string | undefined;
    private device_user: string | undefined;
    private device_password: string | undefined;
    private ws_client: freeioe_client.WSClient | undefined;

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = {
        activeConfigName: new DataBinding<string>("")
    };

    public get ActiveConfigChanged(): vscode.Event<string> { return this.model.activeConfigName.ValueChanged; }

    
    /**
     * don't use this.rootFolder directly since it can be undefined
     */
    public get RootPath(): string {
        return (this.rootFolder) ? this.rootFolder.uri.fsPath : "";
    }
    public get RootUri(): vscode.Uri | null {
        return (this.rootFolder) ? this.rootFolder.uri : null;
    }
    public get Name(): string {
        return this.getName(this.rootFolder);
    }
    public get TrackedDocuments(): Set<vscode.TextDocument> {
        return this.trackedDocuments;
    }
    public get OutputChannel() : vscode.OutputChannel | undefined {
        return this.outputChannel;
    }
    public get LogChannel() : vscode.OutputChannel | undefined {
        return this.logChannel;
    }
    public get CommChannel() : vscode.OutputChannel | undefined {
        return this.commChannel;
    }
    public getWSHost() : string {
        return `${this.device_host}:${this.device_port}`;
    }

    private getName(workspaceFolder?: vscode.WorkspaceFolder): string {
        return workspaceFolder ? workspaceFolder.name : "untitled";
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

    constructor( workspaceFolder?: vscode.WorkspaceFolder) {
        this.rootFolder = workspaceFolder;
        ui = getUI();
        ui.bind(this);
        
        try {
            let conf = vscode.workspace.getConfiguration('iot_editor').get<number>('config');
            if (!conf) { conf = -1;}

            this.setupOutputHandlers();
            
            this.configuration = new configs.EditorProperties(this.RootPath, conf);
            this.configuration.ConfigurationsChanged((e) => this.onConfigurationsChanged(e));
            this.configuration.SelectionChanged((e) => this.onSelectedConfigurationChanged(e));
            this.disposables.push(this.configuration);
            
            let defaults = {applicationPath: ""};
            this.configuration.ApplicationDefaults = defaults;

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
    public appendOutput(log: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(log);
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
                e(`Client is not exists!`);
                return;
            }
            if (!client.is_connected()) {
                client.once('ready', () => {
                    c(client);
                });
                
                client.on('error', (message : string) => {
                    e('Error while connecting: ' + message);
                });
            }

			c(client);
		});
    }

    private connectDevice() {
        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];

        let dev: configs.Device | undefined = conf.device;
        if (dev) {
            if (this.device_host === dev.host && this.device_port === dev.port && this.device_user === dev.user && this.device_password === dev.password) {
                return;
            }
            this.disconnectDevice();
            this.appendOutput('Connect device....');    
            this.device_host = dev.host ? dev.host : "127.0.0.1";
            this.device_port = dev.port ? dev.port : 8818;
            this.device_sn = dev.sn;
            this.device_user = dev.user;
            this.device_password = dev.password;

            this.ws_client = new freeioe_client.WSClient(dev);
            this.ws_client.on("device_sn_diff", (remote_sn : string) => this.on_device_sn_diff(remote_sn));
            this.ws_client.on("console", (content: string) => this.appendOutput(content));
            this.ws_client.on("log", (content: string) => this.appendLog(content));
            this.ws_client.on("comm", (content: string) => this.appendCom(content));
            this.ws_client.on("ready", () => {
                vscode.window.showInformationMessage(`Device ${this.device_host} connnected!`);
            });
            this.ws_client.on("error", (message: string) => {
                vscode.window.showInformationMessage(`Device connnect failed! ${message}`);
            });
            this.ws_client.connect();
        }
    }
    public on_device_sn_diff(remote_sn: string) {
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
    public on_ws_message( code: string, data: any) {
        this.appendOutput(`WebSocket message: ${code} ${data}`);
    }
    private disconnectDevice() {
        vscode.workspace.getConfiguration('iot_editor').update('online', false);
        this.device_host = "";
        this.device_port = 8818;
        this.device_sn = undefined;
        this.device_user = "";
        this.device_password = "";
        if (this.ws_client !== undefined) {
            this.appendOutput('Disconnect device....');
            this.ws_client.disconnect();
            this.ws_client = undefined;
        }
    }
    
    private onConfigurationsChanged(configurations: configs.Configuration[]): void {
        console.log('[Client] onConfigurationsChanged');
        let params: FolderSettingsParams = {
            configurations: configurations,
            currentConfiguration: this.configuration.CurrentConfiguration
        };
        this.model.activeConfigName.Value = configurations[params.currentConfiguration].name;
        
        this.connectDevice();
    }

    private onSelectedConfigurationChanged(index: number): void {
        console.log('[Client] onSelectedConfigurationChanged');
        this.model.activeConfigName.Value = this.configuration.ConfigurationNames[index];
        
        this.connectDevice();
    }

    /*********************************************
     * command handlers
     *********************************************/
    public handleDisconnectCommand(): void {
        this.disconnectDevice();
    }

    public handleConfigurationSelectCommand(): void {
        ui.showConfigurations(this.configuration.ConfigurationNames)
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

    public handleApplicationDownloadCommand(): void {
        if (!this.ws_client) {
            return;
        }
        let apps : freeioe_client.Application[] = this.ws_client.apps();
        ui.showApplications(apps)
            .then((index: number) => {
                if (index < 0) {
                    return;
                }
                if (index >= apps.length) {
                    this.handleApplicationCreateCommand();
                } else {
                    this.downloadApplication(apps[index]);
                }
            });

    }
    public handleApplicationUploadCommand(): void {
        vscode.window.showWarningMessage("Application upload not implemented!");
    }
    public handleApplicationRestartCommand(doc: vscode.TextDocument): void {
        let abpath = path.relative(this.RootPath, doc.uri.fsPath);
        let app = this.getApplicationFromFilePath(abpath);
        if (app) {
            this.stopApplication(app.inst).then(()=> {
                    setTimeout(async ()=>{
                        if (app) {
                            this.startApplication(app.inst);
                        }
                    }, 1000);
            });
        } else {
            vscode.window.showWarningMessage("Application instance is not found!");
        }
    }
    public handleApplicationStartCommand(doc: vscode.TextDocument): void {
        let abpath = path.relative(this.RootPath, doc.uri.fsPath);
        let app = this.getApplicationFromFilePath(abpath);
        if (app) {
            this.startApplication(app.inst);
        } else {
            vscode.window.showWarningMessage("Application instance is not found!");
        }
    }
    public handleApplicationStopCommand(doc: vscode.TextDocument): void {
        let abpath = path.relative(this.RootPath, doc.uri.fsPath);
        let app = this.getApplicationFromFilePath(abpath);
        if (app) {
            this.stopApplication(app.inst);
        } else {
            vscode.window.showWarningMessage("Application instance is not found!");
        }
    }
    private startApplication(inst: string): Thenable<void> {
        console.log('Start Application', inst);
        let promises: Thenable<void>[] = [];

        if (this.ws_client !== undefined) {
            this.ws_client.start_app(inst).then( (result: boolean) => {
                vscode.window.showInformationMessage(`Application ${inst} started!`);
            }, (reason) => {
                vscode.window.showInformationMessage(`Application start failed! ${reason}`);
            });
        }

        return Promise.all(promises).then(() => undefined);
    }
    private stopApplication(inst: string): Thenable<void> {
        console.log('Stop Application', inst);
        let promises: Thenable<void>[] = [];

        if (this.ws_client !== undefined) {
            this.ws_client.stop_app(inst, "stop from vscode").then( (result: boolean) => {
                vscode.window.showInformationMessage(`Application ${inst} stoped!`);
            }, (reason) => {
                vscode.window.showInformationMessage(`Application stop failed! ${reason}`);
            });
        }

        return Promise.all(promises).then(() => undefined);
    }
    private updateDeviceSN(sn:string) {
        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];
        let device = conf.device;
        if (device) {
            device.sn = sn;
        }
        this.configuration.saveToFile();
        this.device_sn = sn;
    }
    private downloadApplication(app: freeioe_client.Application) {
        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];
        let apps = conf.apps;
        if (!apps) {
            apps = [];
        }
        let local_dir:string|null = null;
        for (let iter of apps) {
            if (iter.inst === app.inst && iter.version === app.version) {
                //vscode.window.showInformationMessage("Already Downloaded");
                local_dir = iter.local_dir;
                iter.version = app.version;
            }
        }
        if (!local_dir) {
            local_dir = this.configuration.ConfigurationNames[this.configuration.CurrentConfiguration] + "." + app.inst;
            apps.push({inst: app.inst, version: app.version, local_dir: local_dir});
            conf.apps = apps;
        } else {
            // fs.unlinkSync(this.RootPath + "\\" + local_dir);
            // vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        }

        fs.mkdir(this.RootPath + "\\" + local_dir);
        //vscode.commands.executeCommand('explorer.newFolder', local_dir);

        this.realDownloadApplication(local_dir, app.inst, "#")
            .then(() => {
                vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
                this.configuration.saveToFile();
                let main_file: string = this.RootPath + "\\" + local_dir + "\\app.lua";
                setTimeout(async ()=>{
                    vscode.workspace.openTextDocument(main_file).then(vscode.window.showTextDocument);
                }, 3000);
            });
    }
    private realDownloadApplication(local_dir: string, inst: string, id: string): Thenable<void>  {
        console.log('realDownloadApplication', id);
        let promises: Thenable<void>[] = [];

        let options = {
            qs: {
                app: inst,
                operation: 'get_node',
                id: id
            }
        };

        if (this.ws_client){
            let ws_con = this.ws_client.get_ws_con();
            ws_con.editor_get(options.qs).then((msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Download application failed! ${data.message}`);
                    return true;
                }
                interface FileNode {
                    type: string;
                    id: string;
                    text: string;
                    children: FileNode[] | boolean;
                }
                let nodes: FileNode[] = Object.assign([], data.content);
                let file_nodes: FileNode[] = [];
                for (let node of nodes) {
                    if (typeof(node.children) !== 'boolean') {
                        for (let child of node.children) {
                            console.log(child);
                            if (child.type === 'folder') {
                                    this.realDownloadApplication(local_dir, inst, child.id)
                                        .then(() => {
                                            console.log('download ' + child.id + ' finished');
                                            fs.mkdir(this.RootPath + "\\" + local_dir + child.id);
                                        });
                            }
                            if (child.type === 'file') {
                                console.log('file:', child.id);
                                file_nodes.push(child);
                            }
                        }
                    } else {
                        console.log('file:', node.id);
                        file_nodes.push(node);
                    }
                }
                
                promises.push(util.make_promise().then(() => {
                    setTimeout(async ()=>{
                        for (let node of file_nodes) {
                            this.downloadFile(local_dir, inst, node.id);
                            await util.sleep(200);
                        }
                    }, 200);
                }));
                return true;
            });
        }

        return Promise.all(promises).then(() => undefined);
    }
    private downloadFile(local_dir: string, inst: string, filepath: string): Thenable<void>  {
        console.log('downloadFile', inst, filepath);
        let promises: Thenable<void>[] = [];

        let options = {
            qs: {
                app: inst,
                operation: 'get_content',
                id: filepath
            }
        };

        if (this.ws_client){
            let ws_con = this.ws_client.get_ws_con();
            ws_con.editor_get(options.qs).then( (msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Download file failed! ${data.message}`);
                    return true;
                }
                interface FileContent {
                    content: string;
                }

                let fc: FileContent = Object.assign({}, data.content);
                if (fc.content) {
                    console.log("write file", this.RootPath + "\\" + local_dir + filepath);
                    fs.writeFileSync(this.RootPath + "\\" + local_dir + filepath, fc.content);
                } else {
                    console.log("No file content found!");
                }
                return true;
            });
        }

        return Promise.all(promises).then(() => undefined);
    }
    private uploadFile(local_dir: string, inst: string, filepath: string) : Thenable<void> {
        console.log('uploadFile', inst, filepath);
        let promises: Thenable<void>[] = [];

        let content: string = fs.readFileSync(this.RootPath + "\\" + local_dir + filepath, "UTF-8");

        if (this.ws_client){
            this.ws_client.upload_file(inst, filepath, content);
        }

        return Promise.all(promises).then(() => undefined);
    }
    private getApplicationFromFilePath(filepath: string): configs.Application | undefined {
        if (! this.ws_client) {
            return undefined;
        }

        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];
        let apps = conf.apps;
        if (!apps) {
            apps = [];
        }
        let app: configs.Application | undefined = undefined;
        for (let iter of apps) {
            if (filepath.substr(0, iter.local_dir.length) === iter.local_dir) {
                app = iter;
            }
        }
        let device_apps = this.ws_client.apps();
        if (app && this.ws_client.apps()) {
            for (let iter of device_apps) {
                if (iter.inst === app.inst) {
                    return app;
                }
            }
        }
    }
    public handleFileDownloadCommand(doc: vscode.TextDocument): void {
        let abpath = path.relative(this.RootPath, doc.uri.fsPath);
        if (path.dirname(abpath) === '.vscode') {
            return;
        }
        let app = this.getApplicationFromFilePath(abpath);
        if (app) {
            // vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            let fpath = "/" + path.relative(app.local_dir, abpath);
            console.log(fpath.replace("\\", "/"));
            this.downloadFile(app.local_dir, app.inst, fpath.replace("\\", "/"));
        } else {
            vscode.window.showWarningMessage("Application instance is not found!");
        }
    }
    public handleFileUploadCommand(doc: vscode.TextDocument): void {
        let abpath = path.relative(this.RootPath, doc.uri.fsPath);
        if (path.dirname(abpath) === '.vscode') {
            return;
        }
        let app = this.getApplicationFromFilePath(abpath);
        if (app) {
            let fpath = "/" + path.relative(app.local_dir, abpath);
            console.log(fpath.replace("\\", "/"));
            doc.save().then((value: boolean) => {
                if (app) {
                    this.uploadFile(app.local_dir, app.inst, fpath.replace("\\", "/"));
                }
            });
        } else {
            vscode.window.showWarningMessage("Application instance is not found!");
        }
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