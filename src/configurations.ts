/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as fs from "fs";
import * as vscode from 'vscode';
const configVersion: number = 2;

let defaultSettings: string = `{
    "version": ${configVersion},
    "auth_code": "123456789",
    "devices": [
        {
            "name": "Device1",
            "desc": "Device authed by private auth code",
            "host": "192.168.0.245",
            "port": 8818,
            "sn": ""
        },
        {
            "name": "Device2",
            "desc": "Device authed by username and password",
            "host": "192.168.0.245",
            "port": 8818,
            "sn": "",
            "user": "admin",
            "password": "admin1"
        }
    ]
}
`;

export interface DeviceConfig {
    name: string;
    desc: string;
    host: string;
    port: number;
    sn?: string;
    user?: string;
    password?: string;
}

interface ConfigurationJson {
    version: number;
    auth_code: string;
    devices: DeviceConfig[];
}

export class EditorProperties {
    private propertiesFile: vscode.Uri|undefined = undefined;
    private readonly configFolder: string;
    private configurationJson: ConfigurationJson|undefined = undefined;
    private currentDeviceIndex: number = -1;
    private configFileWatcher: vscode.FileSystemWatcher|undefined = undefined;
    private configFileWatcherFallbackTime: Date = new Date(); // Used when file watching fails.
    private disposables: vscode.Disposable[] = [];
    private devicesChanged = new vscode.EventEmitter<DeviceConfig[]>();
    private defaultDeviceChanged = new vscode.EventEmitter<number>();

    // Any time the `defaultSettings` are parsed and assigned to `this.configurationJson`,
    // we want to track when the default includes have been added to it.
    private configurationIncomplete: boolean = true;

    constructor(rootPath: string, config: number) {
        console.assert(rootPath !== undefined);
        this.configFolder = path.join(rootPath, ".vscode");
        this.currentDeviceIndex = config;

        let configFilePath: string = path.join(this.configFolder, "freeioe_devices.json");
        if (fs.existsSync(configFilePath)) {
            this.propertiesFile = vscode.Uri.file(configFilePath);
            setTimeout(async ()=>{
                this.parsePropertiesFile();
                this.onDefaultDeviceChanged();
            }, 100);
        }

        this.configFileWatcher = vscode.workspace.createFileSystemWatcher(configFilePath);
        this.disposables.push(this.configFileWatcher);
        this.configFileWatcher.onDidCreate((uri) => {
            this.propertiesFile = uri;
            this.handleConfigurationChange();
        });

        this.configFileWatcher.onDidDelete(() => {
            this.propertiesFile = undefined;
            this.resetToDefaultSettings(true);
            this.handleConfigurationChange();
        });

        this.configFileWatcher.onDidChange(() => {
            this.handleConfigurationChange();
        });

        this.disposables.push(vscode.Disposable.from(this.devicesChanged, this.defaultDeviceChanged));
    }

    public get DevicesChanged(): vscode.Event<DeviceConfig[]> { return this.devicesChanged.event; }
    public get DefaultDeviceChanged(): vscode.Event<number> { return this.defaultDeviceChanged.event; }
    public get AuthCode() : string { return (this.configurationJson) ? this.configurationJson.auth_code : ""; }
    public get Devices(): DeviceConfig[] { return (this.configurationJson) ? this.configurationJson.devices : []; }
    public get DefaultDevice(): number { return this.currentDeviceIndex; }

    public get DeviceNames(): string[] {
        let result: string[] = [];
        if (this.configurationJson) {
            this.configurationJson.devices.forEach((config: DeviceConfig) => result.push(config.name));
        }
        return result;
    }

    private onDevicesChanged(): void {
        console.log('[EditorProperties] onDevicesChanged');
        this.devicesChanged.fire(this.Devices);
    }

    private onDefaultDeviceChanged(): void {
        console.log('[EditorProperties] onDefaultDeviceChanged');
        this.defaultDeviceChanged.fire(this.DefaultDevice);
    }

    private resetToDefaultSettings(resetIndex: boolean): void {
        this.configurationJson = JSON.parse(defaultSettings);
        if (!this.configurationJson) {
            return;
        }
        if (resetIndex || this.DefaultDevice < 0 ||
            this.DefaultDevice >= this.configurationJson.devices.length) {
            this.currentDeviceIndex = 0;
        }
        this.configurationIncomplete = true;
    }

    public select(index: number): void {
        if (!this.configurationJson) {
            return;
        }
        if (index === this.configurationJson.devices.length) {
            this.handleConfigurationEditCommand(vscode.window.showTextDocument);
        }
        else {
            this.currentDeviceIndex = index;
            this.onDefaultDeviceChanged();
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
            this.onDevicesChanged();
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
                    let fullPathToFile: string = path.join(dirPathEscaped, "freeioe_devices.json");
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
                                this.propertiesFile = vscode.Uri.file(path.join(this.configFolder, "freeioe_devices.json"));
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
                if (this.DefaultDevice < 0 ||
                    this.DefaultDevice >= this.configurationJson.devices.length) {
                    // If the index is out of bounds (during initialization or due to removal of configs), fix it.
                    this.currentDeviceIndex = 0;
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
            if (!newJson || !newJson.devices || newJson.devices.length === 0) {
                throw { message: "Invalid configuration file. There must be at least one configuration present in the array." };
            }
            let tempSet : Set<string> = new Set();
            newJson.devices.forEach((config: DeviceConfig) => tempSet.add(config.name));
            if (tempSet.size !== newJson.devices.length) {
                throw { message: "Invalid configuration file. Duplicated device name found!" };
            }

            if (!this.configurationIncomplete && this.configurationJson && this.configurationJson.devices &&
                this.DefaultDevice < this.configurationJson.devices.length && this.DefaultDevice !== -1) {
                for (let i: number = 0; i < newJson.devices.length; i++) {
                    if (newJson.devices[i].name === this.configurationJson.devices[this.DefaultDevice].name) {
                        this.currentDeviceIndex = i;
                        break;
                    }
                }
            }
            this.configurationJson = newJson;
            if (this.DefaultDevice >= newJson.devices.length) {
                this.currentDeviceIndex = 0;
            }

            // Warning: There is a chance that this is incorrect in the event that the freeioe_devices.json file was created before
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
            // let config: Configuration = this.configurationJson.configurations[this.CurrentDevice];
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
        if (!this.propertiesFile) {
            return;
        }
        // Check for change properties in case of file watcher failure.
        let propertiesFile: string = path.join(this.configFolder, "freeioe_devices.json");
        fs.stat(propertiesFile, (err, stats) => {
            if (err) {
                console.log(err);
                if (this.propertiesFile !== undefined) {
                    this.propertiesFile = undefined; // File deleted.
                    this.resetToDefaultSettings(true);
                    this.handleConfigurationChange();
                }
            } else if (stats.mtime > this.configFileWatcherFallbackTime) {
                if (this.propertiesFile === undefined) {
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
