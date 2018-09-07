

import { Readable } from 'stream';
import { EventEmitter } from 'events';

declare namespace JSFreeIOE {


    interface JSFreeIOEOptions {
        host: string;
        port?: number | 21;
        user?: string | 'admin';
        pass?: string | 'admin1';
        useList?: boolean
    }

    interface Callback<T> {
        (err: any, result: T): void;
    }


    interface Entry {
        name: string;
        size: number;
        time: number;
        type: 0 | 1;
    }
}

interface JSFreeIOE extends EventEmitter {
    auth(user: string, password: string, callback: JSFreeIOE.Callback<void>): void
    keepAlive(wait?: number): void;
    ls(path: string, callback: JSFreeIOE.Callback<JSFreeIOE.Entry[]>): void;
    list(path: string, callback: JSFreeIOE.Callback<any>): void;
    put(buffer: Buffer, path: string, callback: JSFreeIOE.Callback<void>): void;
    get(path: string, callback: JSFreeIOE.Callback<Readable>): void;
    setType(type: 'A' | 'AN' | 'AT' | 'AC' | 'E' | 'I' | 'L', callback: JSFreeIOE.Callback<any>): void;
    raw(command: string, args: any[], callback: JSFreeIOE.Callback<void>): void;
    raw<T>(command: string, args: any[], callback: JSFreeIOE.Callback<T>): void;
}

interface JSFreeIOEConstructor {
    new(options: JSFreeIOE.JSFreeIOEOptions): JSFreeIOE;
}

declare const JSFreeIOE: JSFreeIOEConstructor;

export = JSFreeIOE;
