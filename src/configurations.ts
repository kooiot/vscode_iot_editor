/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as fs from "fs";
import * as vscode from 'vscode';
const configVersion: number = 1;

let defaultSettings: string = `{
    "configurations": [
        {
            "name": "Device",
            "device": {
                "ip": "192.168.1.1",
                "sn": "",
                "user": "admin",
                "password": "admin1"
            },
            "apps": []
        }
    ],
    "version": ${configVersion}
}
`;

export interface Device {
    ip?: string;
    sn?: string;
    user?: string;
    password?: string;
}

export interface Application {
    inst: string;
    local_dir: string;
}

export interface Configuration {
    name: string;
    device: Device;
    apps?: Application[];
}

export interface ApplicationDefaults {
    applicationPath: string;
}

interface ConfigurationJson {
    configurations: Configuration[];
    version: number;
}

export class EditorProperties {
    private propertiesFile: vscode.Uri|null = null;
    private readonly configFolder: string;
    private configurationJson: ConfigurationJson|null = null;
    private currentConfigurationIndex: number = -1;
    private configFileWatcher: vscode.FileSystemWatcher|null = null;
    private configFileWatcherFallbackTime: Date = new Date(); // Used when file watching fails.
    private disposables: vscode.Disposable[] = [];
    private configurationsChanged = new vscode.EventEmitter<Configuration[]>();
    private selectionChanged = new vscode.EventEmitter<number>();
    private applicationSelectionChanged = new vscode.EventEmitter<string>();

    // Any time the `defaultSettings` are parsed and assigned to `this.configurationJson`,
    // we want to track when the default includes have been added to it.
    private configurationIncomplete: boolean = true;

    constructor(rootPath: string, config: number) {
        console.assert(rootPath !== undefined);
        this.configFolder = path.join(rootPath, ".vscode");
        this.currentConfigurationIndex = config;
        //this.resetToDefaultSettings(this.currentConfigurationIndex === -1);

        let configFilePath: string = path.join(this.configFolder, "iot_editor_properties.json");
        if (fs.existsSync(configFilePath)) {
            this.propertiesFile = vscode.Uri.file(configFilePath);
        }

        this.configFileWatcher = vscode.workspace.createFileSystemWatcher(configFilePath);
        this.disposables.push(this.configFileWatcher);
        this.configFileWatcher.onDidCreate((uri) => {
            this.propertiesFile = uri;
            this.handleConfigurationChange();
        });

        this.configFileWatcher.onDidDelete(() => {
            this.propertiesFile = null;
            this.resetToDefaultSettings(true);
            this.handleConfigurationChange();
        });

        this.configFileWatcher.onDidChange(() => {
            this.handleConfigurationChange();
        });

        this.disposables.push(vscode.Disposable.from(this.configurationsChanged, this.selectionChanged, this.applicationSelectionChanged));
    }

    public get ConfigurationsChanged(): vscode.Event<Configuration[]> { return this.configurationsChanged.event; }
    public get SelectionChanged(): vscode.Event<number> { return this.selectionChanged.event; }
    public get ApplicationSelectionChanged(): vscode.Event<string> { return this.applicationSelectionChanged.event; }
    public get Configurations(): Configuration[] { return (this.configurationJson) ? this.configurationJson.configurations : []; }
    public get CurrentConfiguration(): number { return this.currentConfigurationIndex; }

    public get ConfigurationNames(): string[] {
        let result: string[] = [];
        if (this.configurationJson) {
            this.configurationJson.configurations.forEach((config: Configuration) => result.push(config.name));
        }
        return result;
    }
    
    public set ApplicationDefaults(applicationDefaults: ApplicationDefaults) {
        this.handleConfigurationChange();
    }

    private onConfigurationsChanged(): void {
        console.log('[EditorProperties] onConfigurationsChanged');
        this.configurationsChanged.fire(this.Configurations);
    }

    private onSelectionChanged(): void {
        console.log('[EditorProperties] onSelectionChanged');
        this.selectionChanged.fire(this.CurrentConfiguration);
    }

    private onApplicationSelectionChanged(inst: string): void {
        console.log('[EditorProperties] onApplicationSelectionChanged');
        this.applicationSelectionChanged.fire(inst);
    }

    private resetToDefaultSettings(resetIndex: boolean): void {
        this.configurationJson = JSON.parse(defaultSettings);
        if (!this.configurationJson) {
            return;
        }
        if (resetIndex || this.CurrentConfiguration < 0 ||
            this.CurrentConfiguration >= this.configurationJson.configurations.length) {
            this.currentConfigurationIndex = 0;
        }
        this.configurationIncomplete = true;
    }

    public select(index: number): void {
        if (!this.configurationJson) {
            return;
        }
        if (index === this.configurationJson.configurations.length) {
            this.handleConfigurationEditCommand(vscode.window.showTextDocument);
        }
        else {
            this.currentConfigurationIndex = index;
            this.onSelectionChanged();
        }
    }

    private updateServerOnFolderSettingsChange(): void {
        if (!this.configurationJson) {
            return;
        }
        // for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
        //     let configuration: Configuration = this.configurationJson.configurations[i];
        //     if (configuration.includePath) {
        //         configuration.includePath = this.resolveAndSplit(configuration.includePath);
        //     }
        // }

        if (!this.configurationIncomplete) {
            this.onConfigurationsChanged();
        } else {
            console.log('!this.configurationIncomplete');
        }
    }

    public handleConfigurationEditCommand(onSuccess: (document: vscode.TextDocument) => void): void {
        if (this.propertiesFile && fs.existsSync(this.propertiesFile.fsPath)) {
            try {
                vscode.workspace.openTextDocument(this.propertiesFile).then((document: vscode.TextDocument) => {
                    onSuccess(document);
                });
            }
            catch(err) {
                vscode.window.showErrorMessage('Failed to open "' + this.propertiesFile.fsPath + '": ' + err.message);
                throw err;
            }
        } else {
            fs.mkdir(this.configFolder, (e: NodeJS.ErrnoException | undefined) => {
                if (!e || e.code === 'EEXIST') {
                    let dirPathEscaped: string = this.configFolder.replace("#", "%23");
                    let fullPathToFile: string = path.join(dirPathEscaped, "iot_editor_properties.json");
                    let filePath: vscode.Uri = vscode.Uri.parse("untitled:" + fullPathToFile);
                    vscode.workspace.openTextDocument(filePath).then((document: vscode.TextDocument) => {
                        let edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                        if (this.configurationJson === undefined) {
                            this.resetToDefaultSettings(true);
                        }
                        edit.insert(document.uri, new vscode.Position(0, 0), JSON.stringify(this.configurationJson, null, 4));
                        vscode.workspace.applyEdit(edit).then((status) => {
                            // Fix for issue 163
                            // https://github.com/Microsoft/vscppsamples/issues/163
                            // Save the file to disk so that when the user tries to re-open the file it exists.
                            // Before this fix the file existed but was unsaved, so we went through the same
                            // code path and reapplied the edit.
                            document.save().then(() => {
                                this.propertiesFile = vscode.Uri.file(path.join(this.configFolder, "iot_editor_properties.json"));
                                vscode.workspace.openTextDocument(this.propertiesFile).then((document: vscode.TextDocument) => {
                                    onSuccess(document);
                                });
                            });
                        });
                    });
                }
            });
        }
    }

    private handleConfigurationChange(): void {
        this.configFileWatcherFallbackTime = new Date();
        if (this.propertiesFile) {
            this.parsePropertiesFile();
            // parsePropertiesFile can fail, but it won't overwrite an existing configurationJson in the event of failure.
            // this.configurationJson should only be undefined here if we have never successfully parsed the propertiesFile.
            if (this.configurationJson) {
                if (this.CurrentConfiguration < 0 ||
                    this.CurrentConfiguration >= this.configurationJson.configurations.length) {
                    // If the index is out of bounds (during initialization or due to removal of configs), fix it.
                    this.currentConfigurationIndex = 0;
                }
            }
        }

        if (this.configurationJson === undefined) {
            this.resetToDefaultSettings(true);  // I don't think there's a case where this will be hit anymore.
        }

        this.updateServerOnFolderSettingsChange();
    }

    private parsePropertiesFile(): void {
        if (!this.propertiesFile) {
            return;
        }
        try {
            let readResults: string = fs.readFileSync(this.propertiesFile.fsPath, 'utf8');
            if (readResults === "") {
                return; // Repros randomly when the file is initially created. The parse will get called again after the file is written.
            }

            // Try to use the same configuration as before the change.
            let newJson: ConfigurationJson = JSON.parse(readResults);
            if (!newJson || !newJson.configurations || newJson.configurations.length === 0) {
                throw { message: "Invalid configuration file. There must be at least one configuration present in the array." };
            }
            if (!this.configurationIncomplete && this.configurationJson && this.configurationJson.configurations &&
                this.CurrentConfiguration < this.configurationJson.configurations.length) {
                for (let i: number = 0; i < newJson.configurations.length; i++) {
                    if (newJson.configurations[i].name === this.configurationJson.configurations[this.CurrentConfiguration].name) {
                        this.currentConfigurationIndex = i;
                        break;
                    }
                }
            }
            this.configurationJson = newJson;
            if (this.CurrentConfiguration >= newJson.configurations.length) {
                this.currentConfigurationIndex = 0;
            }

            // Warning: There is a chance that this is incorrect in the event that the iot_editor_properties.json file was created before
            // the system includes were available.
            this.configurationIncomplete = false;

            let dirty: boolean = false;
            if (this.configurationJson.version !== configVersion) {
                dirty = true;
                // if (this.configurationJson.version === undefined) {
                //     this.updateToVersion2();
                // }
            }

            // Update the compilerPath, cStandard, and cppStandard with the default if they're missing.
            // let config: Configuration = this.configurationJson.configurations[this.CurrentConfiguration];
            // Don't set the default if compileCommands exist, until it is fixed to have the correct value.
            // if (config.compilerPath === undefined && this.defaultCompilerPath && !config.compileCommands) {
            //     config.compilerPath = this.defaultCompilerPath;
            //     dirty = true;
            // }

            if (dirty) {
                fs.writeFileSync(this.propertiesFile.fsPath, JSON.stringify(this.configurationJson, null, 4));
            }
        } catch (err) {
            vscode.window.showErrorMessage('Failed to parse "' + this.propertiesFile.fsPath + '": ' + err.message);
            throw err;
        }
    }

    // private updateToVersion2(): void {
    //     this.configurationJson.version = 2;
    //     if (!this.includePathConverted()) {
    //         for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
    //             let config: Configuration = this.configurationJson.configurations[i];
    //             if (config.browse === undefined) {
    //                 config.browse = {};
    //             }
    //             if (config.browse.path === undefined && (this.defaultIncludes !== undefined || config.includePath !== undefined)) {
    //                 config.browse.path = (config.includePath === undefined) ? this.defaultIncludes.slice(0) : config.includePath.slice(0);
    //             }
    //         }
    //     }
    // }

    public checkEditorProperties(): void {
        // Check for change properties in case of file watcher failure.
        let propertiesFile: string = path.join(this.configFolder, "iot_editor_properties.json");
        fs.stat(propertiesFile, (err, stats) => {
            if (err) {
                console.log(err);
                if (this.propertiesFile !== null) {
                    this.propertiesFile = null; // File deleted.
                    this.resetToDefaultSettings(true);
                    this.handleConfigurationChange();
                }
            } else if (stats.mtime > this.configFileWatcherFallbackTime) {
                if (this.propertiesFile === null) {
                    this.propertiesFile = vscode.Uri.file(propertiesFile); // File created.
                }
                this.handleConfigurationChange();
            }
        });
    }

    public saveToFile(): void{
        if (this.propertiesFile) {
            fs.writeFileSync(this.propertiesFile.fsPath, JSON.stringify(this.configurationJson, null, 4));
        }
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }
}
