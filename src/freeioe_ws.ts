'use strict';

import * as events from 'events';
import * as vscode from 'vscode';
import WebSocket = require('ws');

        
export interface WSMessage {
    id: number;
    code: string;
    data: any;
}
type WSCallback = (msg: WSMessage) => void;

export class FreeIOEWS extends events.EventEmitter {
    private disposables: vscode.Disposable[] = [];
    private address: string;
    private user: string;
    private password: string;
    private websocket: WebSocket | undefined;
    private msg_id: number = 0;
    private callback_map = new Map<number, WSCallback>();
    private reconnect_timer: NodeJS.Timer | undefined;
    private closed = false;

    // Events
    // on(event: 'message', listener: (this: WsConn, msg : WSMessage) => void): this;
    // on(event: 'login' , listener: (this: WsConn, result: boolean, message: string) => void): this;
    // on(event: 'close', listener: (this: WsConn, code: number, reason: string) => void): this;
    // on(event: 'console' | 'comm' | 'log', listener: (this: WsConn, data: string) => void): this;

    constructor( address: string, user: string, password: string) {
        super();
        this.address = address;
        this.user = user;
        this.password = password;
    }
    private appendOutput(content : string) {
        this.emit('console', content);
    }
    private appendLog(content : string) {
        this.emit('log', content);
    }
    private appendComm(content : string) {
        this.emit('comm', content);
    }
    public connect() {
        if (this.websocket) {
            return;
        }
        let ws = new WebSocket(this.address);
        ws.on('open',  () => this.on_ws_open());
        ws.on('close', (code: number, reason: string) => this.on_ws_close(code, reason));
        ws.on('error', (error: Error) => this.on_ws_error(error));
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
        this.appendOutput("WebSocket connection is ready to " + this.address);
        if (this.websocket) {
            this.websocket.ping("hello world");
        }
    }
    private on_ws_close(code: number, reason: string ) {
        this.appendOutput("WebSocket connection is closed from " + this.address);
        this.emit('close', code, reason);
        this.websocket = undefined;

        if (this.closed || this.reconnect_timer) {
            return;
        }
        
        this.reconnect_timer = setTimeout(async ()=>{
            this.reconnect_timer = undefined;
            this.connect();
        }, 3000);
    }
    private on_ws_error(error: Error) {
        this.appendOutput(`unexpected response: ${error}`);
    }
    private on_ws_message(data: string) {
        let msg: WSMessage = Object.assign({}, JSON.parse(data));
        let func: WSCallback | undefined = this.callback_map.get(msg.id);
        if (func !== undefined) {
            this.callback_map.delete(msg.id);
            func(msg);
            return;
        }
        if (msg.code === 'info') {
            this.emit('info', msg.data.sn, msg.data.beta);
            this.send_login().then(msg => {
                this.emit('login', msg.data.result, msg.data.message);
            }, (reason) => {
                this.emit('login', false, reason);
            });
        }
        else if (msg.code === 'log') {
            let tm = this.formatDateTime(<number>msg.data.timestamp * 1000);
            this.appendLog(`[${tm}] [${msg.data.level}] [${msg.data.process}] ${msg.data.content} `);
        } 
        else if (msg.code === 'event') {
            let tm = this.formatDateTime(<number>msg.data.timestamp * 1000);
            let data_data = JSON.stringify(msg.data.data);
            this.appendLog(`[${tm}] [${msg.data.type}] [${msg.data.app}] [${msg.data.level}] ${msg.data.info} ${data_data}`);
        } 
        else if (msg.code === 'app_event') {
            // let tm = this.formatDateTime(<number>msg.data.timestamp * 1000);
            // let data_data = JSON.stringify(msg.data.data);
            // this.appendLog(`[${tm}] [${msg.data.type}] [${msg.data.app}] [${msg.data.level}] ${msg.data.info} ${data_data}`);
        } 
        else if (msg.code === 'comm') {
            let tm = this.formatDateTime(<number>msg.data.ts * 1000);
            let data = new Buffer(msg.data.data, 'base64');
            this.appendComm(`[${tm}] [${msg.data.dir}] [${msg.data.sn}] ${data.toString('hex')} `);
        }
        else {
            this.emit('message', msg);
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
        if (!this.websocket) {
            if (cb) {
                cb(Error("Not connected!!"));
            }
            return;
        }
        this.websocket.send(JSON.stringify(msg), {mask: true}, cb);
    }
    private send_login() : Thenable<WSMessage> {
		return new Promise((c, e) => {            
            let data = {
                user: this.user,
                passwd: this.password
            };            
            this.send_ws_message("login", data, (msg) => { c(msg); }, (err) => { e(err); });
        });
    }
    public editor_post(form: { [key: string]: any } | string) : Thenable<WSMessage> {
		return new Promise((c, e) => {
            this.send_ws_message("editor_post", form, (msg) => { c(msg); }, (err) => { e(err); });
        });
    }
    public editor_get(qs: { [key: string]: any } | string) : Thenable<WSMessage> {
		return new Promise((c, e) => {
            this.send_ws_message("editor_get", qs, (msg) => { c(msg); }, (err) => { e(err); });
        });
    }

    public watch(msg_id: number) : Thenable<WSMessage> {
		return new Promise((c, e) => {
            this.callback_map.set(msg_id, (msg) => {
                c(msg);
            });
        });
    }

    public app_new(app:string, inst:string) : Thenable<WSMessage> {
		return new Promise((c, e) => {
            let data = {
                app: app,
                inst: inst
            };
            this.send_ws_message("app_new", data, (msg) => { c(msg); }, (err) => { e(err); });
        });
    }
    

    public app_start(inst:string) : Thenable<WSMessage> {
		return new Promise((c, e) => {
            let data = {
                inst: inst
            };
            this.send_ws_message("app_start", data, (msg) => { c(msg); }, (err) => { e(err); });
        });
    }

    public app_stop(inst: string, reason:string) : Thenable<WSMessage> {
		return new Promise((c, e) => {
            let data = {
                inst: inst,
                reason: reason
            };
            this.send_ws_message("app_stop", data, (msg) => { c(msg); }, (err) => { e(err); });
        });
    }

    public app_list() : Thenable<WSMessage> {
		return new Promise((c, e) => {
            this.send_ws_message("app_list", {}, (msg) => { c(msg); }, (err) => { e(err); });
        });
    }

    public close() {
        this.closed = true;
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer);
        }
        if (this.websocket) {
            this.websocket.close();
            this.websocket = undefined;
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
