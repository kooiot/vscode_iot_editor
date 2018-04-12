/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { Client, Application } from './client';

let ui: UI;

interface IndexableQuickPickItem extends vscode.QuickPickItem {
    index: number;
}
interface KeyedQuickPickItem extends vscode.QuickPickItem {
    key: string;
}

export class UI {
    private configStatusBarItem: vscode.StatusBarItem;

    constructor() {
        this.configStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
        this.configStatusBarItem.command = "iot_editor.configurationSelect";
        this.configStatusBarItem.tooltip = "IOT Device Configuration";
        this.ShowConfiguration = true;
    }

    public bind(client: Client): void {
        client.ActiveConfigChanged(value => { this.ActiveConfig = value; });
    }
    public SetActiveConfig(config: string) {
        this.ActiveConfig = config;
    }

    private set ActiveConfig(label: string) {
        this.configStatusBarItem.text = label;
    }

    private set ShowConfiguration(show: boolean) {
        if (show) {
            this.configStatusBarItem.show();
        } else {
            this.configStatusBarItem.hide();
        }
    }

    public showConfigurations(configurationNames: string[]): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a Configuration...";

        let items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < configurationNames.length; i++) {
            items.push({ label: configurationNames[i], description: "", index: i });
        }
        items.push({ label: "Edit Configurations...", description: "", index: configurationNames.length });

        return vscode.window.showQuickPick(items, options)
            .then(selection => {
                if (!selection) {
                    return -1;
                }
                return selection.index;
            });
    }

    public showWorkspaces(workspaceNames: { name: string; key: string }[]): Thenable<string> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a Workspace...";

        let items: KeyedQuickPickItem[] = [];
        workspaceNames.forEach(name => items.push({ label: name.name, description: "", key: name.key }));

        return vscode.window.showQuickPick(items, options)
            .then(selection => {
                if (!selection) {
                    return "";
                }
                return selection.key;
            });
    }

    public showIncorrectSN(sn: string, conf_sn: string) : Thenable<string> {
        let options: vscode.MessageOptions =  {modal: false};
        let msg = `Device SN ${sn} is different with configuration ${conf_sn}`;

        return vscode.window.showWarningMessage(msg, options, { title: "Use " + sn },{ title: "Abort", isCloseAffordance: true })
            .then(selection => {
                if (!selection || selection.isCloseAffordance) {
                    return conf_sn;
                }
                return sn;
            });
    }

    public showApplications(apps: Application[]): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a Application...";

        let items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < apps.length; i++) {
            items.push({ label: apps[i].inst, description: "", detail: "Application: " + apps[i].name + "\t Version: " + apps[i].version, index: i });
        }
        items.push({ label: "Create new application...", description: "", index: apps.length });

        return vscode.window.showQuickPick(items, options)
            .then(selection => {
                if (!selection) {
                    return -1;
                }
                return selection.index;
            });
    }

    public dispose(): void {
        this.configStatusBarItem.dispose();
    }
}

export function getUI(): UI {
    if (ui === undefined) {
        ui = new UI();
    }
    return ui;
}