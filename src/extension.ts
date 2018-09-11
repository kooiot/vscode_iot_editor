'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Client } from './client';
import { IOTExplorer } from './iotExplorer';
import { IOTDeviceViewer } from './deviceViewer';
import { IOTEventViewer } from './eventViewer';

let client: Client;
let intervalTimer: NodeJS.Timer;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    
    console.log('IOT Editor extension loaded!');
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.aboutEditor', aboutEditor));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.connect', deviceConnect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.disconnect', deviceDisconnect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.configurationSelect', configurationSelect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.configurationEdit', configurationEdit));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationCreate', applicationCreate));

    vscode.workspace.getConfiguration('iot_editor').update('online', false);
    
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        let rootFolder: vscode.WorkspaceFolder = vscode.workspace.workspaceFolders[0];        
        client = new Client(rootFolder);
        new IOTExplorer(context, client);
        //iot_viewer = new IOTViewer(context, client);
        new IOTDeviceViewer(context, client);
        new IOTEventViewer(context, client);
    }
    intervalTimer = setInterval(onInterval, 2500);

    // vscode.workspace.onDidSaveTextDocument((e: vscode.TextDocument) => {
    //     if (vscode.workspace.getConfiguration('iot_editor').get('auto') === true) {
    //         client.handleFileUploadCommand(e);
    //     } else {
    //         console.log("this is no auto", vscode.workspace.getConfiguration('iot_editor').get('auto'));
    //     }
    // });
    /*
    vscode.workspace.onDidOpenTextDocument((e: vscode.TextDocument) => {
        if (vscode.workspace.getConfiguration('iot_editor').get('auto') === true) {
            fileDownload(e);
        } else {
            console.log("this is no auto", vscode.workspace.getConfiguration('iot_editor').get('auto'));
        }
    });
    */
}

// this method is called when your extension is deactivated
export function deactivate() {
    vscode.workspace.getConfiguration('iot_editor').update('online', false);

    //iot_explorer.
    clearInterval(intervalTimer);
    client.dispose();
}

function onActivationEvent(): void {
}

function onInterval(): void {
    client.onInterval();
}

function deviceConnect(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to select a configuration');
    } else {
        client.handleConfigurationSelectCommand();
    }
}

function deviceDisconnect(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to select a configuration');
    } else {
        client.handleDisconnectCommand();
    }
}

function configurationSelect(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to select a configuration');
    } else {
        client.handleConfigurationSelectCommand();
    }
}

function configurationEdit(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        client.handleConfigurationEditCommand();
    }
}

function applicationCreate(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        client.handleApplicationCreateCommand();
    }
}

function aboutEditor(): void {
    vscode.window.showInformationMessage('About IOT Editor');
}

export function isFolderOpen(): boolean {
    return vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0;
}