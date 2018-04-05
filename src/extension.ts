'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated

    console.log('Congratulations, your extension "IOT Editor" is now active!');
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.configurationSelect', configurationSelect));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.configurationEdit', configurationEdit));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationDownload', applicationDownload));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationUpload', applicationUpload));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationStart', applicationStart));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.applicationStop', applicationStop));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.fileDownload', fileDownload));
    context.subscriptions.push(vscode.commands.registerCommand('iot_editor.fileUpload', fileUpload));
}

// this method is called when your extension is deactivated
export function deactivate() {
}

function configurationSelect(): void {
    vscode.window.showInformationMessage('configurationSelect!');
}

function configurationEdit(): void {
    vscode.window.showInformationMessage('configurationSelect!');    
}

function applicationDownload(): void {
    vscode.window.showInformationMessage('applicationDownload!');    
}

function applicationUpload(): void {
    vscode.window.showInformationMessage('applicationUpload!');    
}

function applicationStart(): void {
    vscode.window.showInformationMessage('applicationStart!');    
}

function applicationStop(): void {
    vscode.window.showInformationMessage('applicationStop!');    
}

function fileDownload(): void {
    vscode.window.showInformationMessage('fileDownload!');    
}

function fileUpload(): void {
    vscode.window.showInformationMessage('fileUpload!');    
}