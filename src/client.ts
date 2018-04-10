'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as request from 'request';
import * as configs from "./configurations";
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
    private debugChannel: vscode.OutputChannel | undefined;
    private http_requst = request.defaults({jar: true});

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
    
    constructor( workspaceFolder?: vscode.WorkspaceFolder) {
        this.rootFolder = workspaceFolder;
        ui = getUI();
        ui.bind(this);
        
        try {
            this.configuration = new configs.EditorProperties(this.RootPath);
            this.configuration.ConfigurationsChanged((e) => this.onConfigurationsChanged(e));
            this.configuration.SelectionChanged((e) => this.onSelectedConfigurationChanged(e));
            this.configuration.ApplicationSelectionChanged((e) => this.onApplicationSelectionChanged(e));
            this.disposables.push(this.configuration);

            this.setupOutputHandlers();
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
        if (this.debugChannel !== undefined) {
            this.debugChannel = vscode.window.createOutputChannel(`IOT Editor Debug: ${this.Name}`);
            this.disposables.push(this.debugChannel);
        }
        if (this.outputChannel !== undefined) {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
                this.outputChannel = vscode.window.createOutputChannel(`IOT Editor: ${this.Name}`);
            } else {
                this.outputChannel = vscode.window.createOutputChannel(`IOT Editor: ${this.Name}`); //logger.getOutputChannel();
            }
            this.disposables.push(this.outputChannel);
        }
    }
    
    private onConfigurationsChanged(configurations: configs.Configuration[]): void {
        console.log('onConfigurationsChanged');
        let params: FolderSettingsParams = {
            configurations: configurations,
            currentConfiguration: this.configuration.CurrentConfiguration
        };
        this.model.activeConfigName.Value = configurations[params.currentConfiguration].name;
        
        let conf = this.configuration.Configurations[this.configuration.CurrentConfiguration];
        let dev: configs.Device | undefined = conf.device;
        if (dev) {
            let ip: string = dev.ip ? dev.ip : "127.0.0.1";
            let sn: string = dev.sn ? dev.sn : "127.0.0.1";
            let user: string = dev.user ? dev.user : "127.0.0.1";
            let password: string = dev.password ? dev.password : "127.0.0.1";
            let url = "http://" + ip + ":8808/user/login";

            this.http_requst.post(url, {form: {username:user, password:password}}, function(e, r, body) {
                if (r && r.statusCode === 200) {
                    vscode.window.showInformationMessage('Login to device completed');
                    vscode.workspace.getConfiguration('iot_editor').update('online', true);
                } else {
                    if (body) {
                        vscode.window.showErrorMessage(body);
                    } else {
                        vscode.window.showErrorMessage(e);
                    }
                }
            });
        }
    }

    private onSelectedConfigurationChanged(index: number): void {
        console.log('onSelectedConfigurationChanged');
        this.model.activeConfigName.Value = this.configuration.ConfigurationNames[index];
    }

    private onApplicationSelectionChanged(path: string): void {
        console.log('onApplicationSelectionChanged');
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

    }
    public handleApplicationUploadCommand(): void {
        
    }
    public handleApplicationStartCommand(): void {
        
    }
    public handleApplicationStopCommand(): void {
        
    }
    public handleFileDownloadCommand(): void {
        
    }
    public handleFileUploadCommand(): void {
        
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