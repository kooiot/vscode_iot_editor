'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ClientMgr } from './client_mgr';
import { IOTFileSystemProvider } from './iotExplorer';
//import { IOTViewer } from './iotViewer';
import { IOTDeviceViewer } from './deviceViewer';
import { IOTEventViewer } from './eventViewer';
import { IOTNewsViewer } from './newsViewer.';

// The example uses the file message format.
const localize = nls.config({ messageFormat: nls.MessageFormat.file })();

let client: ClientMgr;
let intervalTimer: NodeJS.Timer;
//let iotExplorer: IOTExplorer;
//let iotViewr: IOTViewer;
let iotDeviceViewer: IOTDeviceViewer;
let iotEventViewer: IOTEventViewer;
let iotNewsViewer: IOTNewsViewer;
let ioeFs: IOTFileSystemProvider;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    if (vscode.workspace.rootPath === undefined || vscode.workspace.name === undefined || !vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length <= 0) {
        const message = localize('noWorkspace.text', 'IOT Editor cannot be loaded without workspace!');
        console.log(message);
        return;
    }

    console.log('IOT Editor extension loaded!');
    //vscode.workspace.getConfiguration("iot_editor").update("show_explorer_views", true);

    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.connect', deviceConnect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.disconnect', deviceDisconnect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.defaultDeviceSelect', defaultDeviceSelect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.init', configurationEdit));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.workspaceInit', configurationEdit));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.configurationEdit', configurationEdit));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationCreate', applicationCreate));

    client = new ClientMgr(vscode.workspace.rootPath);
    iotDeviceViewer = new IOTDeviceViewer(context, client);
    iotEventViewer = new IOTEventViewer(context, client);
    iotNewsViewer = new IOTNewsViewer(context, client);

    /// For FileSystemProvider
    ioeFs = new IOTFileSystemProvider( context, client );
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('ioe', ioeFs, { isCaseSensitive: true }));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.activeFS', activeFsProvider));

    intervalTimer = setInterval(onInterval, 2500);
}

// this method is called when your extension is deactivated
export function deactivate() {
    //iot_explorer.
    clearInterval(intervalTimer);
    client.dispose();
}

function onActivationEvent(): void {
    console.log('IOT Editor is activated!');
}

function onInterval(): void {
    client.onInterval();
    iotDeviceViewer.onInterval();
    iotEventViewer.onInterval();
    iotNewsViewer.onInterval();
}

function activeFsProvider (name: string, uri: vscode.Uri): void {
    onActivationEvent();

    if (!vscode.workspace.workspaceFolders) {
        vscode.workspace.updateWorkspaceFolders(1, 0, { uri: uri, name: name });
    } else {
        for (const wsf of vscode.workspace.workspaceFolders) {
            if (wsf.uri.toString() === uri.toString()) {
                //
                if (wsf.name === name) {
                    //ioeFs.activeUri(uri);
                    vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
                } else {
                    const result = vscode.workspace.updateWorkspaceFolders(wsf.index, 1, { uri: uri, name: name });
                    console.log('updateWorkspaceFolders result', result);
                }
                return;
            }
        }
        const nu = vscode.workspace.workspaceFolders.length;
        vscode.workspace.updateWorkspaceFolders(nu, 0, { uri: uri, name: name });
    }
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

function defaultDeviceSelect(): void {
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

export function isFolderOpen(): boolean {
    return vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0;
}
