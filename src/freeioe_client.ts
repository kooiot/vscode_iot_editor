'use strict';

import * as events from 'events';
import * as vscode from 'vscode';
import {basename, dirname} from 'path';
import { WSMessage, FreeIOEWS, WSAppEvent, WSEvent } from './freeioe_ws';


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

export class WSClient extends events.EventEmitter {
    private disposables: vscode.Disposable[] = [];
    private device_ws: string = "";
    private device_sn: string | undefined;
    private device_user: string = "";
    private device_password: string = "";
    private ws_con: FreeIOEWS;
    private connected: boolean = false;
    private event_buf: WSEvent[] = [];

    constructor( options : any ) {
        super();

        let host: string = options.host ? options.host : "127.0.0.1";
        let port: number = options.port ? options.port : 8818;
        this.device_ws = "ws://" + host + ":" + port;
        this.device_sn = options.sn;
        this.device_user = options.user ? options.user : "admin";
        this.device_password = options.password ? options.password : "admin1";

        this.ws_con = new FreeIOEWS(this.device_ws, this.device_user, this.device_password);
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

    public connect() : Thenable<WSClient> {
        return new Promise((c, e) => {
            if (this.connected) {
                c(this);
            } else {
                this.ws_con.connect();
                this.once('ready', () => {
                    c(this);
                });
                this.once('error', (message: string) => {
                    e(message);
                });
            }
        });
    }
    private on_device_info(sn: string, beta: boolean) {
        if (this.device_sn && this.device_sn !== sn) {
            this.emit('device_sn_diff', sn);
        } else {
            this.emit('device_info', sn, beta);
        }
    }
    private on_login(result: boolean, message: string) {
        vscode.workspace.getConfiguration('iot_editor').update('online', result);
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
        }
    }
    private on_disconnected(code: number, reason: string) {
        vscode.workspace.getConfiguration('iot_editor').update('online', false);
        this.connected = false;
        this.appendOutput(`Device disconnected code: ${code}\t reason:${reason}`);
        this.emit("disconnect", code, reason);
    }
    public disconnect() {
        vscode.workspace.getConfiguration('iot_editor').update('online', false);
        if (this.ws_con !== undefined) {
            this.ws_con.close();
        }
    }
    
    public create_app(app: Application) : Thenable<Application> {
		return new Promise((c, e) => {
            this.ws_con.app_new(app.name, app.inst).then(msg => {
                let data = msg.data;
                if (data.result === true) {
                    app.version = 0;
                    app.islocal = 1;
                    c(app);
                } else {
                    e('Error while create application: ' + data.message);
                }
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }

    public restart_app(inst: string, reason: string): Thenable<boolean> {
        this.appendOutput(`Restart Application ${inst}`);
		return new Promise((c, e) => {     
            return this.stop_app(inst, reason).then((result)=> {
                if (result) {
                    setTimeout(async ()=>{
                        this.start_app(inst).then( (result) => {
                            c(result);
                        }, (reason) => {
                            e(reason);
                        });
                    }, 1000);
                } else {
                    e('Failed to stop application');
                }
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    public start_app(inst: string): Thenable<boolean> {
        this.appendOutput(`Start Application ${inst}`);
		return new Promise((c, e) => {       
            return this.ws_con.app_start(inst).then( (msg) => {
                let data = msg.data;
                if (data.result === true) {
                    c(data.result);
                } else {
                    e('Error while create application: ' + data.message);
                }
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    public stop_app(inst: string, reason: string): Thenable<boolean> {
        this.appendOutput(`Stop Application ${inst}`);
		return new Promise((c, e) => {       
            return this.ws_con.app_stop(inst, reason).then( (msg) => {
                let data = msg.data;
                if (data.result === true) {
                    c(data.result);
                } else {
                    e('Error while create application: ' + data.message);
                }
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }

    public list_apps(): Thenable<Application[]> {
        this.appendOutput(`Get Application List`);

        return new Promise((c, e) => {
            this.ws_con.app_list().then( (msg) => {
                let data = msg.data;
                interface AppList { [key: string]: Application; }
    
                let list: AppList = Object.assign({}, data);
                let apps: Application[] = [];
                for(let k in list) {
                    if (!list[k].inst) {
                        list[k].inst = k;
                    }
                    apps.push(list[k]);
                }
                this.appendOutput(`Get Application List Done!`);
                c(apps);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
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
        return new Promise((c, e) => {
            let qs = {
                app: inst,
                operation: 'get_node',
                id: sub_path
            };
            this.ws_con.editor_get(qs).then((msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    e(`Dir application failed! ${data.message}`);
                    return;
                }
                if (data.content === "[]") {
                    data.content = [];
                }
                let nodes: ApplicationFileNode[] = Object.assign([], data.content);
                let file_nodes: ApplicationFileNode[] = [];
                for (let node of nodes) {
                    if (typeof(node.children) !== 'boolean') {
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
                c(nodes);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    public download_file(inst: string, filepath: string): Thenable<string>  {
        this.appendOutput(`Download Application File ${inst} ${filepath}`);
        return new Promise((c, e) => {
            let qs = {
                app: inst,
                operation: 'get_content',
                id: filepath
            };
            this.ws_con.editor_get(qs).then( (msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    e(`Download application file failed! ${data.message}`);
                    return;
                }
                if (data.content !== undefined) {
                    interface FileContent {
                        content: string;
                    }
                    let fc: FileContent = Object.assign({}, data.content);
                    c(fc.content);
                } else {
                    e("No file content found!");
                }
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    public upload_file(inst: string, filepath: string, content: string) : Thenable<boolean> {
        this.appendOutput(`Upload Application File ${inst} ${filepath}`);
        return new Promise((c, e) => {
            let form = {
                app: inst,
                operation: 'set_content_ex',
                id: filepath,
                text: content,
            };
            this.ws_con.editor_post(form).then((msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`File ${filepath} upload failed! ${data.message}`);
                } else {
                    this.appendOutput(`File ${filepath} uploaded`);
                }
                c(data.result);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    
    public rename(inst: string, path: string, new_basename: string) : Thenable<boolean> {
        this.appendOutput(`Rename name from ${path} to ${new_basename} under app ${inst}`);
        return new Promise((c, e) => {
            let qs = {
                app: inst,
                operation: 'rename_node',
                id: path,
                text: new_basename,
            };
            this.ws_con.editor_get(qs).then((msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Rename node from ${path} to ${new_basename} failed! ${data.message}`);
                } else {
                    this.appendOutput(`Rename node from ${path} to ${new_basename} successed`);
                }
                c(data.result);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    
    public delete(inst: string, path: string) : Thenable<boolean> {
        this.appendOutput(`Delete node ${path} under app ${inst}`);
        return new Promise((c, e) => {
            let qs = {
                app: inst,
                operation: 'delete_node',
                id: path
            };
            this.ws_con.editor_get(qs).then((msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Delete node ${path} failed! ${data.message}`);
                } else {
                    this.appendOutput(`Delete node ${path} successed`);
                }
                c(data.result);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    
    public create_directory(inst: string, path: string) : Thenable<boolean> {
        this.appendOutput(`Create directory ${path} under app ${inst}`);
        return new Promise((c, e) => {
            let qs = {
                app: inst,
                operation: 'create_node',
                id: path,
                type: "directory"
            };
            this.ws_con.editor_get(qs).then((msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Create folder ${path} under app ${inst} failed! ${data.message}`);
                } else {
                    this.appendOutput(`Create folder ${path} under app ${inst} successed`);
                }
                c(data.result);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }
    
    public create_file(inst: string, path: string) : Thenable<boolean> {
        let folder = dirname(path);
        let filename = basename(path);
        this.appendOutput(`Create file ${path} under app ${inst}`);
        return new Promise((c, e) => {
            let qs = {
                app: inst,
                operation: 'create_node',
                id: folder,
                text: filename,
                type: "file"
            };
            this.ws_con.editor_get(qs).then((msg) => {
                let data = msg.data;
                if (data.result !== true) {
                    this.appendOutput(`Create file ${path} under app ${inst} failed! ${data.message}`);
                } else {
                    this.appendOutput(`Create file ${path} under app ${inst} successed`);
                }
                c(data.result);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
            });
        });
    }

    public stat(inst: string, path: string) : Thenable<IOTFileStat> {
        this.appendOutput(`Stat path ${path} under app ${inst}`);
        return new Promise((c, e) => {
            let qs = {
                app: inst,
                operation: 'stat_node',
                id: path
            };
            this.ws_con.editor_get(qs).then((msg) => {
                let data = msg.data;
                let stat: IOTFileStat = Object.assign({}, data.content);
                c(stat);
            }, (reason) => {
                this.appendOutput(reason);
                e(reason);
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