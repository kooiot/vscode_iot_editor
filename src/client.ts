'use strict';

import * as path from 'path';
import * as fs from "fs";
import * as vscode from 'vscode';
import * as request from 'request';
import * as util from "./util"
import * as configs from "./configurations";
import { UI, getUI } from './ui';
import { DataBinding } from './dataBinding';
import { disconnect } from 'cluster';
import { UdpConn } from './udp_con';
import { URL } from 'url';

let ui: UI;

let previousEditorSettings: { [key: string]: any } = {};

interface FolderSettingsParams {
    currentConfiguration: number;
    configurations: any[];
}

interface ClientModel {
    activeConfigName: DataBinding<string>;
}


export interface Application {
    inst: string;
    name: string;
    version: number;
    conf?: string;
    auto?: number;
    islocal?: number;
    sn: string;
    running: boolean;
}

export class Client {
    private disposables: vscode.Disposable[] = [];
    private configuration: configs.EditorProperties;
    private rootPathFileWatcher: vscode.FileSystemWatcher | undefined;
    private rootFolder: vscode.WorkspaceFolder | undefined;
    private trackedDocuments = new Set<vscode.TextDocument>();
    private outputChannel: vscode.OutputChannel | undefined;
    private debugChannel: vscode.OutputChannel | undefined;
    private http_requst = request.defaults({jar: true});
    private connected: boolean = false;
    private device_ip: string = "";
    private http_url_base: string = "";
    private device_sn:string = "";
    private device_apps:Application[] = [];
    private udpServer: UdpConn;

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
    public get DebugChannel() : vscode.OutputChannel | undefined {
        return this.debugChannel;
    }

    private getName(workspaceFolder?: vscode.WorkspaceFolder): string {
        return workspaceFolder ? workspaceFolder.name : "untitled";
    }
    
    public onDidChangeSettings(): void {
        // This relies on getNonDefaultSettings being called first.
        console.assert(Object.keys(previousEditorSettings).length > 0);

        let filter: (key: string, val: string) => boolean = (key: string, val: string) => {
            return !(key in previousEditorSettings) || val !== previousEditorSettings[key];
        };
    }

    public onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
    }
    
    
    private get CurrentApplications(): string[] { 
        let result: string[] = [];
        this.device_apps.forEach((app: Application) => result.push(app.inst));
        return result;
    }

    constructor( workspaceFolder?: vscode.WorkspaceFolder) {
        this.rootFolder = workspaceFolder;
        ui = getUI();
        ui.bind(this);
        
        try {
            let conf = vscode.workspace.getConfiguration('iot_editor').get<number>('config');
            if (!conf) { conf = -1;}
            
            this.configuration = new configs.EditorProperties(this.RootPath, conf);
            this.configuration.ConfigurationsChanged((e) => this.onConfigurationsChanged(e));
            this.configuration.SelectionChanged((e) => this.onSelectedConfigurationChanged(e));
            this.disposables.push(this.configuration);
            
            let defaults = {applicationPath: ""};
            this.configuration.ApplicationDefaults = defaults;

            this.setupOutputHandlers();
            this.registerFileWatcher();

            this.udpServer = new UdpConn(this, 7000);
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
        if (this.debugChannel === undefined) {
            this.debugChannel = vscode.window.createOutputChannel(`IOT Editor Debug: ${this.Name}`);
            this.disposables.push(this.debugChannel);
        }
        if (this.outputChannel === undefined) {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
                this.outputChannel = vscode.window.createOutputChannel(`IOT Editor: ${this.Name}`);
            } else {
                this.outputChannel = vscode.window.createOutputChannel(`IOT Editor: ${this.Name}`); //logger.getOutputChannel();
            }
            this.disposables.push(this.outputChannel);
        }
    }

    private httpPostRequest(url: string, options: request.CoreOptions, onSuccess: (body: any) => void) {
        this.http_requst.post(this.http_url_base + url, options, function(e, r, body) {
            if (r && r.statusCode === 200) {
                onSuccess(body);
            } else {
                if (body) {
                    vscode.window.showErrorMessage(body);
                } else {
                    vscode.window.showErrorMessage(e.message);
                }
            }
        });
    }
    private httpGetRequest(url: string, options: request.CoreOptions, onSuccess: (body: any) => void) {
        this.http_requst.get(this.http_url_base + url, options, function(e, r, body) {
            if (r && r.statusCode === 200) {
                onSuccess(body);
            } else {
                console.log(e, r, body);
                if (body) {
                    vscode.window.showErrorMessage(body);
                } else {
                    vscode.window.showErrorMessage(e.message);
                }
            }
        });
    }

    private connectDevice() {
        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];

        let dev: configs.Device | undefined = conf.device;
        if (dev) {
            let ip: string = dev.ip ? dev.ip : "127.0.0.1";
            let sn: string = dev.sn ? dev.sn : "IDIDIDIDID";
            let user: string = dev.user ? dev.user : "admin";
            let password: string = dev.password ? dev.password : "admin1";
            let url_base = "http://" + ip + ":8808";
            if (this.http_url_base === url_base && this.device_sn === sn) {
                //vscode.window.showWarningMessage("Device SN/IP are same!");
                return;
            }
                
            if (this.connected) {
                this.disconnectDevice();
            }
            
            this.device_ip = ip;
            this.http_url_base = "http://" + ip + ":8808";
            this.device_sn = sn;

            let cli = this;
            this.fetchSysInfo(function() {
                cli.realConnectDevice(user, password);
            });
        }
    }
    private fetchSysInfo(on_ready: () => void) {
        let cli = this;
        this.httpGetRequest("/sys/info", {}, function(body) {
            interface SysInfo {
                iot_sn: string;
                using_beta: boolean;
            }
            let info: SysInfo = Object.assign({}, JSON.parse(body));
            if (!info.using_beta) {
                vscode.window.showErrorMessage("Device is not in beta mode!!!");
                cli.disconnectDevice();
                return;
            }
            if (info.iot_sn === cli.device_sn) {
                on_ready();
            } else {
                ///vscode.window.showErrorMessage("Device SN is not expected!!!");
                ui.showIncorrectSN(info.iot_sn, cli.device_sn).then((sn: string) => {
                    if (sn !== cli.device_sn) {
                        cli.updateDeviceSN(sn);
                    }
                    cli.disconnectDevice();
                });
            }
        });
    }
    private realConnectDevice(user:string, password:string) {
        console.log('[Client] HTTP\t', this.http_url_base);
        let cli = this;
        this.httpPostRequest("/user/login", {form: {username:user, password:password}}, function(body) {
            vscode.window.showInformationMessage('Login to device completed');
            vscode.workspace.getConfiguration('iot_editor').update('online', true);
            vscode.workspace.getConfiguration('iot_editor').update('config', cli.configuration.CurrentConfiguration);
            cli.connected = true;
            cli.startUDPForward();
            cli.handleApplicationFetch();
        });
    }
    public startUDPForward(): void {
        this.httpPostRequest("/settings", {form: {action: "debugger", option: "forward", value: "true"}}, (body) => {
            this.udpServer.startForward(this.device_ip);
        });
    }

    private disconnectDevice() {
        vscode.workspace.getConfiguration('iot_editor').update('online', false);
        this.connected = false;
        this.device_apps = [];
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

    private onApplicationSelectionChanged(filepath: string): void {
        console.log('[Client] onApplicationSelectionChanged');
    }

    /*********************************************
     * command handlers
     *********************************************/
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
    public handleApplicationDownloadCommand(): void {
        let apps = this.CurrentApplications;
        ui.showApplications(this.device_apps)
            .then((index: number) => {
                if (index < 0) {
                    return;
                }
                this.downloadApplication(this.device_apps[index]);
            });

    }
    public handleApplicationUploadCommand(): void {
        
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

        this.httpPostRequest('/app/start', {form: {inst:inst, from_web:"true"}}, function(body) {
            vscode.window.showInformationMessage(body);
        });

        return Promise.all(promises).then(() => undefined);
    }
    private stopApplication(inst: string): Thenable<void> {
        console.log('Stop Application', inst);
        let promises: Thenable<void>[] = [];

        this.httpPostRequest('/app/stop', {form: {inst:inst, from_web:"true"}}, function(body) {
            vscode.window.showInformationMessage(body);
        });

        return Promise.all(promises).then(() => undefined);
    }
    private updateDeviceSN(sn:string) {
        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];
        let device = conf.device;
        if (device) {
            device.sn = sn;
        }
        this.configuration.saveToFile();
    }
    private handleApplicationFetch(): void {
        console.log('[Client] handleApplicationFetch');
        let cli = this;
        this.httpGetRequest("/app/list", {}, function(body) {
            interface AppList {
                apps:{ [key: string]: Application; };
                using_beta: boolean;
            }

            let list: AppList = Object.assign({}, JSON.parse(body));
            if (list.using_beta === true) {
                for(let k in list.apps) {
                    if (!list.apps[k].inst) {
                        list.apps[k].inst = k;
                    }
                    cli.device_apps.push(list.apps[k]);
                }
            }
        });
    }
    private downloadApplication(app: Application) {
        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];
        let apps = conf.apps;
        if (!apps) {
            apps = [];
        }
        let local_dir:string|null = null;
        for (let iter of apps) {
            if (iter.inst === app.inst && iter.version === app.version) {
                vscode.window.showInformationMessage("Already Downloaded");
                local_dir = iter.local_dir;
                iter.version = app.version;
            }
        }
        if (!local_dir) {
            local_dir = this.configuration.ConfigurationNames[this.configuration.CurrentConfiguration] + "." + app.inst;
            apps.push({inst: app.inst, version: app.version, local_dir: local_dir});
            conf.apps = apps;
        }

        fs.mkdir(this.RootPath + "\\" + local_dir);
        //vscode.commands.executeCommand('explorer.newFolder', local_dir);

        this.realDownloadApplication(local_dir, app.inst, "#")
            .then(() => {
                vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
                this.configuration.saveToFile();
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

        let cli = this;
        this.httpGetRequest('/app/editor', options, function(body) {
            interface FileNode {
                type: string;
                id: string;
                text: string;
                children: FileNode[] | boolean;
            }
            let nodes: FileNode[] = Object.assign([], JSON.parse(body));
            let file_nodes: FileNode[] = [];
            for (let node of nodes) {
                if (typeof(node.children) !== 'boolean') {
                    for (let child of node.children) {
                        console.log(child);
                        if (child.type === 'folder') {
                                cli.realDownloadApplication(local_dir, inst, child.id)
                                    .then(() => {
                                        console.log('download ' + child.id + ' finished');
                                        fs.mkdir(cli.RootPath + "\\" + local_dir + child.id);
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
                        cli.downloadFile(local_dir, inst, node.id);
                        await util.sleep(200);
                    }
                }, 200);
            }));
        });

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

        let cli = this;
        this.httpGetRequest('/app/editor', options, function(body) {
            interface FileContent {
                content: string;
            }

            let fc: FileContent = Object.assign({}, JSON.parse(body));
            if (fc.content) {
                console.log("write file", cli.RootPath + "\\" + local_dir + filepath);
                fs.writeFileSync(cli.RootPath + "\\" + local_dir + filepath, fc.content);
            } else {
                console.log("No file content found!");
            }
        });

        return Promise.all(promises).then(() => undefined);
    }
    private uploadFile(local_dir: string, inst: string, filepath: string) : Thenable<void> {
        console.log('uploadFile', inst, filepath);
        let promises: Thenable<void>[] = [];

        let content: string = fs.readFileSync(this.RootPath + "\\" + local_dir + filepath, "UTF-8");
        let options = {
            form: {
                app: inst,
                operation: 'set_content',
                id: filepath,
                text: content,
            }
        };

        this.httpPostRequest('/app/editor', options, function(body) {
            vscode.window.showInformationMessage("File upload ok");
        });

        return Promise.all(promises).then(() => undefined);
    }
    private getApplicationFromFilePath(filepath: string): configs.Application | undefined {
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
        if (app) {
            for (let iter of this.device_apps) {
                if (iter.inst === app.inst) {
                    return app;
                }
            }
        }
    }
    public handleFileDownloadCommand(doc: vscode.TextDocument): void {
        let abpath = path.relative(this.RootPath, doc.uri.fsPath);
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

    public handleUDPPing(): void {
        this.udpServer.ping(this.device_ip);
    }

    public onInterval(): void {
        if (this.configuration !== undefined) {
            this.configuration.checkEditorProperties();
        }
    }

    public dispose(): Thenable<void> {
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