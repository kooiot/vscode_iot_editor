'use strict';

import * as vscode from 'vscode';
import WebSocket = require('ws');
import { Client } from './client';

        
interface WSMessage {
    id: number;
    code: string;
    data: any;
}
type WSCallback = (code: string, data: any) => boolean;

export class WsConn {
    private disposables: vscode.Disposable[] = [];
    private client: Client;
    private address: string;
    private user: string;
    private password: string;
    private websocket: WebSocket | undefined;
    private msg_id: number = 0;
    private callback_map = new Map<number, WSCallback>();
    private reconnect_timer: NodeJS.Timer | undefined;
    private closed = false;


    constructor( client: Client, address: string, user: string, password: string) {
        this.client = client;
        this.address = address;
        this.user = user;
        this.password = password;
        this.connect();
    }
    private connect() {
        let ws = new WebSocket(this.address);
        ws.on('open',  () => this.on_ws_open());
        ws.on('close', () => this.on_ws_close());
        ws.on('error', (error) => this.on_ws_error(error));
        ws.on('message', (data: string) => this.on_ws_message(data));
        this.websocket = ws;
    }

    private formatDateTime(date: number): string {
        // 2018-08-09 14:33:13.256
        let tm = new Date(date);

        //return string
        var returnDate = "";
        var dd = tm.getDate();
        var mm = tm.getMonth() + 1; //because January is 0! 
        var yyyy = tm.getFullYear();
        var min = tm.getMinutes();
        var hour = tm.getHours();
        var sec = tm.getSeconds();
        var ms = tm.getMilliseconds();

        //Interpolation date
        returnDate += yyyy;
        if (mm < 10) {
            returnDate += `-0${mm}`;
        } else {
            returnDate += `-${mm}`;
        }
        if (dd < 10) {
            returnDate += `-0${dd}`;
        } else {
            returnDate += `-${dd}`;
        }

        if (hour < 10) {
            returnDate += ` 0${hour}`;
        } else {
            returnDate += ` ${hour}`;
        }
        if (min < 10) {
            returnDate += `:0${min}`;
        } else {
            returnDate += `:${min}`;
        }
        if (sec < 10) {
            returnDate += `:0${sec}`;
        } else {
            returnDate += `:${sec}`;
        }
        if (ms < 10) {
            returnDate += `.00${ms}`;
        } else if(ms < 100) {
            returnDate += `.0${ms}`;
        } else {
            returnDate += `.${ms}`;
        }
        return returnDate;
    }

    private on_ws_open() {
        this.client.appendOutput("WebSocket connection is ready to " + this.address);
        if (this.websocket) {
            this.websocket.ping("hello world");
        }
    }
    private on_ws_close() {
        this.client.appendOutput("WebSocket connection is closed from " + this.address);
        this.client.on_disconnected(this);
        this.websocket = undefined;

        if (this.closed || this.reconnect_timer) {
            return;
        }
        
        this.reconnect_timer = setTimeout(async ()=>{
            this.reconnect_timer = undefined;
            this.connect();
        }, 3000);
    }
    private on_ws_error(error:any) {
        this.client.appendOutput(`unexpected response: ${error}`);
    }
    private on_ws_message(data: string) {
        let msg: WSMessage = Object.assign({}, JSON.parse(data));
        let func: WSCallback | undefined = this.callback_map.get(msg.id);
        if (func !== undefined) {
            let r: boolean = func(msg.code, msg.data);
            if (r !== false) {
                this.callback_map.delete(msg.id);
            }
            return;
        }
        if (msg.code === 'info') {
            this.client.on_device_sn(msg.data.sn, () => {
                this.send_login();
            });
        }
        else if (msg.code === 'log') {
            let channel = this.client.LogChannel;
            if (channel) {
                let tm = this.formatDateTime(<number>msg.data.timestamp * 1000);
                channel.appendLine(`[${tm}] [${msg.data.level}] [${msg.data.process}] ${msg.data.content} `);
            }
        } 
        else if (msg.code === 'event') {
            let channel = this.client.LogChannel;
            if (channel) {
                let tm = this.formatDateTime(<number>msg.data.timestamp * 1000);
                let data_data = JSON.stringify(msg.data.data);
                channel.appendLine(`[${tm}] [${msg.data.type}] [${msg.data.app}] [${msg.data.level}] ${msg.data.info} ${data_data}`);
            }
        } 
        else if (msg.code === 'app_event') {
            let channel = this.client.LogChannel;
            if (channel) {
                // let tm = this.formatDateTime(<number>msg.data.timestamp * 1000);
                // let data_data = JSON.stringify(msg.data.data);
                // channel.appendLine(`[${tm}] [${msg.data.type}] [${msg.data.app}] [${msg.data.level}] ${msg.data.info} ${data_data}`);
            }
        } 
        else if (msg.code === 'comm') {
            let channel = this.client.CommChannel;
            if (channel) {
                let tm = this.formatDateTime(<number>msg.data.ts * 1000);
                let data = new Buffer(msg.data.data, 'base64');
                channel.appendLine(`[${tm}] [${msg.data.dir}] [${msg.data.sn}] ${data.toString('hex')} `);
            }
        }
        else {
            this.client.on_ws_message(msg.code, msg.data);
        }
    }
    private send_ws_message(code: string, data:any, callback?: WSCallback, cb?: (err: Error) => void) {
        var msg_id = this.msg_id++;
        if (callback !== undefined) {
            this.callback_map.set(msg_id, callback);
        }
        let msg: WSMessage = {
            id: msg_id,
            code: code,
            data: data
        };
        if (this.websocket) {
            return this.websocket.send(JSON.stringify(msg), {mask: true}, cb);
        }
        return false;
    }
    private send_login() {
        let data = {
            user: this.user,
            passwd: this.password
        };
        return this.send_ws_message("login", data, (code: string, data: any) => {
            this.client.on_login(data.result, data.message);
            return true;
        });
    }
    public editor_post(form: { [key: string]: any } | string, callback?: WSCallback, cb?: (err: Error) => void) {
        return this.send_ws_message("editor_post", form, callback, cb);
    }
    public editor_get(qs: { [key: string]: any } | string, callback?: WSCallback, cb?: (err: Error) => void) {
        return this.send_ws_message("editor_get", qs, callback, cb);
    }

    public app_new(app: string, inst:string, callback?: WSCallback, cb?: (err: Error) => void) {
        let data = {
            app: app,
            inst: inst
        };
        return this.send_ws_message("app_new", data, callback, cb);
    }

    public app_start(inst:string, callback?: WSCallback, cb?: (err: Error) => void) {
        let data = {
            inst: inst
        };
        return this.send_ws_message("app_start", data, callback, cb);
    }

    public app_stop(inst: string, reason:string, callback?: WSCallback, cb?: (err: Error) => void) {
        let data = {
            inst: inst,
            reason: reason
        };
        return this.send_ws_message("app_stop", data, callback, cb);
    }

    public app_list(callback?: WSCallback, cb?: (err: Error) => void) {
        return this.send_ws_message("app_list", {}, callback, cb);
    }

    public close() {
        this.closed = true;
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer);
        }
        if (this.websocket) {
            this.websocket.close();
        }
    }
    
    public dispose(): Thenable<void> {
        if (this.websocket) {
            this.websocket.close();
        }
        
        let promise: Thenable<void> = Promise.resolve();
        return promise.then(() => {
            this.disposables.forEach((d) => d.dispose());
            this.disposables = [];
        });
    }
}
