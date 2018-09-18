'use strict';

import * as events from 'events';
import * as vscode from 'vscode';
import {basename, dirname} from 'path';
import { WSMessage, FreeIOEWS, WSAppEvent, WSEvent } from './freeioe_ws';
import { DeviceConfig }  from './configurations';


export interface Application {
    inst: string;
    name: string;
    version: number;
    conf?: string;
    auto?: number;
    islocal?: number;
    sn: string;
    running: boolean;
}

export interface ApplicationFileNode {
    type: string;
    id: string;
    text: string;
    children: ApplicationFileNode[] | boolean;
}

export interface IOTFileStat {
    mode: string; // file, directory,link,socket,named pipe,char device,block device or other
    access: number; 
    modification: number;
    size: number;
}

export interface DeviceInfo {
    config: DeviceConfig;
    device: Object;
}

export class WSClient extends events.EventEmitter {
    private disposables: vscode.Disposable[] = [];
    //private config: DeviceConfig;
    private _beta = false;
    private ws_con: FreeIOEWS;
    private connected: boolean = false;
    private event_buf: WSEvent[] = [];

    constructor( private config : DeviceConfig, private auth_code : string ) {
        super();
        //this.config = Object.assign({}, config);
        let device_ws = "ws://" + this.config.host + ":" + this.config.port;

        let user = "admin";
        let password = "admin1";
        if (this.config.user && this.config.password) {
            user = this.config.user;
            password = this.config.password;
        } else {
            user = "AUTH_CODE";
            password = this.auth_code;
        }

        this.ws_con = new FreeIOEWS(device_ws, user, password);
        this.ws_con.on("info", (sn: string, beta: boolean) => this.on_device_info(sn, beta));
        this.ws_con.on("login",  (result: boolean, message: string) => this.on_login(result, message));
        this.ws_con.on("close",  (code: number, reason: string) => this.on_disconnected(code, reason));
        this.ws_con.on("message", (msg : WSMessage) => this.on_ws_message(msg));
        this.ws_con.on("event", (event: WSEvent) => this.on_ws_event(event));
        this.ws_con.on("app_event", (event: WSAppEvent) => this.on_ws_app_event(event));

        this.ws_con.on("console", (content: string) => { this.emit("console", content); });
        this.ws_con.on("log", (content: string) => { this.emit("log", content); });
        this.ws_con.on("comm", (content: string) => { this.emit("comm", content); });
    }

    private appendOutput(content : string) {
        this.emit('console', content);
    }
    private on_ws_message( msg: WSMessage) {
        this.appendOutput(`WebSocket message: ${msg.id} ${msg.code} ${msg.data}`);
    }
    private on_ws_event( event: WSEvent) {
        this.event_buf.push(event);
        this.emit("event", event);
    }
    private on_ws_app_event( event: WSAppEvent) {
        this.emit("app_event", event);
    }

    public get Connected() : boolean {
        return this.connected;
    }
    public get Events() : WSEvent[] {
        return this.event_buf;
    }
    public get WS() : FreeIOEWS {
        return this.ws_con;
    }
    public get Config() : DeviceConfig {
        return this.config;
    }
    public get FsUri() : vscode.Uri {
        return vscode.Uri.parse(`ioe://${this.config.host}:${this.config.port}/`);
    }
    public get EventUri() : vscode.Uri {
        return vscode.Uri.parse(`freeioe_event://${this.config.host}:${this.config.port}/`);
    }
    public get DeviceUri() : vscode.Uri {
        return vscode.Uri.parse(`freeioe://${this.config.host}:${this.config.port}/${this.config.name}.json`);
    }
    public get Beta(): boolean {
        return this._beta;
    }
    public get Name(): string {
        return this.Config.name;
    }

    public connect() : Thenable<WSClient> {
        return new Promise((c, e) => {
            if (this.connected) {
                return c(this);
            } else {
                this.ws_con.connect();
                this.once('ready', () => {
                    return c(this);
                });
                this.once('error', (message: string) => {
                    this.appendOutput(`Login error ${message}`);
                    return e(message);
                });
            }
        });
    }
    private on_device_info(sn: string, beta: boolean) {
        this._beta = beta;
        if (this.config.sn && this.config.sn !== sn) {
            this.emit('device_sn_diff', sn);
        }
    }
    private on_login(result: boolean, message: string) {
        if (result === true) {
            this.appendOutput('Login successfully!!');
            this.emit("ready");
            this.connected = true;

            /// Buffer the events
            this.list_events().then( events => {
                for (let event of events) {
                    this.event_buf.push(event);
                }
            });

        } else {
            this.appendOutput(`Login failed: ${message}`);
            this.disconnect();
            this.emit("error", message);
            this.connected = false;
            this.event_buf = [];
        }
    }
    private on_disconnected(code: number, reason: string) {
        this.connected = false;
        this.event_buf = [];
        this.appendOutput(`Device disconnected code: ${code}\t reason:${reason}`);
        this.emit("disconnect", code, reason);
    }
    public disconnect() {
        if (this.ws_con !== undefined) {
            this.ws_con.close();
        }
    }

    public device_info() : Thenable<Object> {
        this.appendOutput('Get device info');
		return this.ws_con.device_info().then(msg => { return { config: this.config, device: Object.assign({}, msg.data) }; });
    }

    public create_app(app: Application): Thenable<Application> {
        this.appendOutput(`Create Application ${app.inst} ${app.name}`);
        return this.ws_con.app_new(app.name, app.inst).then(msg => {
            return new Promise((c, e) => {
                let data = msg.data;
                if (data.result === true) {
                    app.version = 0;
                    app.islocal = 1;
                    return c(app);
                } else {
                    this.appendOutput(`Create Application error ${data.message}`);
                    return e('Error while create application: ' + data.message);
                }
            });
        });
    }

    public restart_app(inst: string, reason: string): Thenable<boolean> {
        this.appendOutput(`Restart Application ${inst}`);   
        return this.stop_app(inst, reason).then((result) => {
            return new Promise((c, e) => {
                return result ? this.start_app(inst) : false;
            });
        });
    }
    public start_app(inst: string): Thenable<boolean> {
        this.appendOutput(`Start Application ${inst}`);
        return this.ws_con.app_start(inst).then((msg) => {
            return new Promise((c, e) => {
                let data = msg.data;
                if (data.result === true) {
                    return c(data.result);
                } else {
                    this.appendOutput(`Start Application error ${data.message}`);
                    return e('Error while start application: ' + data.message);
                }
            });
        });
    }
    public stop_app(inst: string, reason: string): Thenable<boolean> {
        this.appendOutput(`Stop Application ${inst}`); 
        return this.ws_con.app_stop(inst, reason).then((msg) => {
            return new Promise((c, e) => {
                let data = msg.data;
                if (data.result === true) {
                    return c(data.result);
                } else {
                    this.appendOutput(`Stop Application error ${data.message}`);
                    return e('Error while stop application: ' + data.message);
                }
            });
        });
    }

    public list_apps(): Thenable<Application[]> {
        this.appendOutput(`Get Application List`);
        return this.ws_con.app_list().then((msg) => {
            return new Promise((c, e) => {
                let data = msg.data;
                interface AppList { [key: string]: Application; }

                let list: AppList = Object.assign({}, data);
                let apps: Application[] = [];
                for (let k in list) {
                    if (!list[k].inst) {
                        list[k].inst = k;
                    }
                    apps.push(list[k]);
                }
                this.appendOutput(`Get Application List Done!`);
                c(apps);
            });
        });
    }

    public list_events(): Thenable<WSEvent[]> {
        this.appendOutput(`Get Event List`);
        return this.ws_con.event_list();
    }

    public dir_app(inst: string, sub_path: string, recursion: boolean): Thenable<ApplicationFileNode[]>  {
        if (sub_path.length === 0 || sub_path === '/') {
            sub_path = '/';
        }
        this.appendOutput(`Dir Application ${inst} ${sub_path}`);
        let qs = {
            app: inst,
            operation: 'get_node',
            id: sub_path
        };
        return this.ws_con.editor_get(qs).then((msg) => {
            return new Promise((c, e) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Dir Application error ${data.message}`);
                    return e(`Dir application failed! ${data.message}`);
                }
                if (data.content === "[]") {
                    data.content = [];
                }
                let nodes: ApplicationFileNode[] = Object.assign([], data.content);
                let file_nodes: ApplicationFileNode[] = [];
                for (let node of nodes) {
                    if (typeof (node.children) !== 'boolean') {
                        for (let child of node.children) {
                            console.log(child);
                            if (child.type === 'folder' && recursion === true) {
                                this.dir_app(inst, child.id, true)
                                    .then((nodes) => {
                                        child.children = nodes;
                                    }, (err) => {
                                        e(`Dir application failed! ${data.message}`);
                                    });
                            }
                            if (child.type === 'file') {
                                this.appendOutput(`Dir Application file: ${child.id}`);
                                file_nodes.push(child);
                            }
                        }
                    } else {
                        this.appendOutput(`Dir Application file: ${node.id}`);
                        file_nodes.push(node);
                    }
                }
                return c(nodes);
            });
        });
    }
    public download_file(inst: string, filepath: string): Thenable<string>  {
        this.appendOutput(`Download Application File ${inst} ${filepath}`);
        let qs = {
            app: inst,
            operation: 'get_content',
            id: filepath
        };
        return this.ws_con.editor_get(qs).then((msg) => {
            return new Promise((c, e) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Download Application file error: ${data.message}`);
                    return e(`Download application file failed! ${data.message}`);
                }
                if (data.content !== undefined) {
                    interface FileContent {
                        type: string;
                        content: string;
                    }
                    let fc: FileContent = Object.assign({}, data.content);
                    this.appendOutput(`File ${filepath} downloaded`);
                    return c(fc.content);
                } else {
                    this.appendOutput(`Download Application file error: No file content found!`);
                    return e("No file content found!");
                }
            });
        });
    }
    public upload_file(inst: string, filepath: string, content: string) : Thenable<boolean> {
        this.appendOutput(`Upload Application File ${inst} ${filepath}`);
        let form = {
            app: inst,
            operation: 'set_content_ex',
            id: filepath,
            text: content,
        };
        return this.ws_con.editor_post(form).then( msg => msg.data.result );
    }

    public rename(inst: string, path: string, new_basename: string): Thenable<boolean> {
        this.appendOutput(`Rename name from ${path} to ${new_basename} under app ${inst}`);
        let qs = {
            app: inst,
            operation: 'rename_node',
            id: path,
            text: new_basename,
        };
        return this.ws_con.editor_get(qs).then( msg => msg.data.result );
    }

    public delete(inst: string, path: string): Thenable<boolean> {
        this.appendOutput(`Delete node ${path} under app ${inst}`);
        let qs = {
            app: inst,
            operation: 'delete_node',
            id: path
        };
        return this.ws_con.editor_get(qs).then( msg => msg.data.result );
    }

    public create_directory(inst: string, path: string): Thenable<boolean> {
        this.appendOutput(`Create directory ${path} under app ${inst}`);
        let qs = {
            app: inst,
            operation: 'create_node',
            id: path,
            type: "directory"
        };
        return this.ws_con.editor_get(qs).then( msg => msg.data.result );
    }
    
    public create_file(inst: string, path: string) : Thenable<boolean> {
        let folder = dirname(path);
        let filename = basename(path);
        this.appendOutput(`Create file ${path} under app ${inst}`);
        let qs = {
            app: inst,
            operation: 'create_node',
            id: folder,
            text: filename,
            type: "file"
        };
        return this.ws_con.editor_get(qs).then(msg => msg.data.result);
    }

    public stat(inst: string, path: string): Thenable<IOTFileStat> {
        if (path.length === 0) {
            path = "/";
        }
        this.appendOutput(`Stat path ${path} under app ${inst}`);
        let qs = {
            app: inst,
            operation: 'stat_node',
            id: path
        };
        return this.ws_con.editor_get(qs).then((msg) => {
            return new Promise((c, e) => {
                let data = msg.data;
                interface LocalFileStat {
                    id: string;
                    stat: IOTFileStat;
                }
                let stat: LocalFileStat = Object.assign({}, data.content);
                if (!stat.stat || !stat.stat.mode) {
                    return e(`Stat path ${path} under app ${inst} failed!`);
                }
                return c(stat.stat);
            });
        });

    }

    public dispose(): Thenable<void> {
        this.disconnect();

        let promise: Thenable<void> = Promise.resolve();
        return promise.then(() => {
            this.disposables.forEach((d) => d.dispose());
            this.disposables = [];
        });
    }
}