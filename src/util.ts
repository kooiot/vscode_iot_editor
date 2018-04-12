'use strict';

//import * as vscode from 'vscode';

export function make_promise(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        resolve();
    });
}
export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
