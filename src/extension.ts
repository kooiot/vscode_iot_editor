'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Client } from './client';

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
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.configurationSelect', configurationSelect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.configurationEdit', configurationEdit));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationDownload', applicationDownload));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationUpload', applicationUpload));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationStart', applicationStart));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationStop', applicationStop));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.fileDownload', fileDownload));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.fileUpload', fileUpload));

    vscode.workspace.getConfiguration('iot_editor').update('online', false);
    
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        let rootFolder: vscode.WorkspaceFolder = vscode.workspace.workspaceFolders[0];        
        client = new Client(rootFolder);
    }
    intervalTimer = setInterval(onInterval, 2500);

    vscode.workspace.onDidSaveTextDocument((e: vscode.TextDocument) => {
        if (vscode.workspace.getConfiguration('iot_editor').get('auto') === true) {
            fileUpload(e);
        } else {
            console.log("EEEEEEEEEEE", vscode.workspace.getConfiguration('iot_editor').get('auto'));
        }
    });
    /*
    vscode.workspace.onDidOpenTextDocument((e: vscode.TextDocument) => {
        if (vscode.workspace.getConfiguration('iot_editor').get('auto') === true) {
            fileDownload(e);
        } else {
            console.log("EEEEEEEEEEE", vscode.workspace.getConfiguration('iot_editor').get('auto'));
        }
    });
    */
}

// this method is called when your extension is deactivated
export function deactivate() {
    vscode.workspace.getConfiguration('iot_editor').update('online', false);

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

function applicationDownload(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        client.handleApplicationDownloadCommand();
    }
}

function applicationUpload(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        client.handleApplicationUploadCommand();
    }
}

function applicationStart(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        client.handleApplicationStartCommand();
    }
}

function applicationStop(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        client.handleApplicationStopCommand();
    }
}

function fileDownload(doc: vscode.TextDocument | undefined): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        if (doc === undefined) {
            let editor = vscode.window.activeTextEditor;
            if (editor) {
                doc = editor.document;
            }
        }
        if (doc) {
            client.handleFileDownloadCommand(doc);
        } else {
            vscode.window.showInformationMessage("What's up?");
        }
    }
}

function fileUpload(doc: vscode.TextDocument | undefined): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        if (doc === undefined) {
            let editor = vscode.window.activeTextEditor;
            if (editor) {
                doc = editor.document;
            }
        }
        if (doc) {
            client.handleFileUploadCommand(doc);
        } else {
            vscode.window.showInformationMessage("What's up?");
        }
    }
}

function aboutEditor(): void {
    vscode.window.showInformationMessage('About IOT Editor');
}

export function isFolderOpen(): boolean {
    return vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0;
}