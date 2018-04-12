/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';

export function make_promise(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        resolve();
    });
}
export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}