'use strict';

import * as events from 'events';
import * as vscode from 'vscode';
import { WSMessage, FreeIOEWS } from './freeioe_ws';


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

export class Client extends events.EventEmitter {
    private disposables: vscode.Disposable[] = [];
    private device_ws: string = "";
    private device_sn: string = "";
    private device_user: string = "";
    private device_password: string = "";
    private device_apps: Application[] = [];
    private ws_con: FreeIOEWS;
    private connected: boolean = false;

    constructor( options : any ) {
        super();

        let host: string = options.host ? options.host : "127.0.0.1";
        let port: number = options.port ? options.port : 8818;
        this.device_ws = "ws://" + host + ":" + port;
        this.device_sn = options.sn ? options.sn : "IDIDIDIDID";
        this.device_user = options.user ? options.user : "admin";
        this.device_password = options.password ? options.password : "admin1";

        this.ws_con = new FreeIOEWS(this.device_ws, this.device_user, this.device_password);
        this.ws_con.on("login",  (result: boolean, message: string) => this.on_login(result, message));
        this.ws_con.on("close",  (code: number, reason: string) => this.on_disconnected(code, reason));
        this.ws_con.on("message", (msg : WSMessage) => this.on_ws_message(msg));

        this.ws_con.on("console", (content: string) => { this.emit("console", content); });
        this.ws_con.on("log", (content: string) => { this.emit("log", content); });
        this.ws_con.on("comm", (content: string) => { this.emit("comm", content); });
    }

    private appendOutput(content : string) {
        this.emit('log', content);
    }

    public connect() : Thenable<Client> {
        this.appendOutput('Connect device....');
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
    private on_login(result: boolean, message: string) {
        vscode.workspace.getConfiguration('iot_editor').update('online', result);
        if (result === true) {
            this.appendOutput('Login successfully!!');
            this.list_apps();
            this.emit("ready");
            this.connected = true;
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
    }
    private on_ws_message( msg: WSMessage) {
        this.appendOutput(`WebSocket message: ${msg.id} ${msg.code} ${msg.data}`);
    }
    public disconnect() {
        vscode.workspace.getConfiguration('iot_editor').update('online', false);
        this.connected = false;
        this.device_apps = [];
        this.device_ws = "";
        this.device_sn = "";
        if (this.ws_con !== undefined) {
            this.appendOutput('Disconnect device....');
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
                    this.device_apps.push(app);
                    c(app);
                } else {
                    e('Error while create application: ' + data.message);
                }
            }, (reason) => {
                e(reason);
            });
        });
    }

    public restart_app(inst: string): Thenable<boolean> {
        this.emit('log', `Restart Application ${inst}`);
		return new Promise((c, e) => {     
            return this.stop_app(inst, "Restart Application").then((result)=> {
                if (result) {
                    setTimeout(async ()=>{
                        this.start_app(inst);
                    }, 1000);
                }
            }, (reason) => {
                e(reason);
            });
        });
    }
    public start_app(inst: string): Thenable<boolean> {
        this.emit('log', `Start Application ${inst}`);
		return new Promise((c, e) => {       
            return this.ws_con.app_start(inst).then( (msg) => {
                let data = msg.data;
                if (data.result === true) {
                    c(data.result);
                } else {
                    e('Error while create application: ' + data.message);
                }
            }, (reason) => {
                e(reason);
            });
        });
    }
    public stop_app(inst: string, reason: string): Thenable<boolean> {
        this.emit('log', `Stop Application ${inst}`);
		return new Promise((c, e) => {       
            return this.ws_con.app_stop(inst, reason).then( (msg) => {
                let data = msg.data;
                if (data.result === true) {
                    c(data.result);
                } else {
                    e('Error while create application: ' + data.message);
                }
            }, (reason) => {
                e(reason);
            });
        });
    }

    public list_apps(): Thenable<Application[]> {
        this.emit('log', `Get Application List`);

        return new Promise((c, e) => {
            this.ws_con.app_list().then( (msg) => {
                let data = msg.data;
                interface AppList { [key: string]: Application; };
    
                let list: AppList = Object.assign({}, data);
                for(let k in list) {
                    if (!list[k].inst) {
                        list[k].inst = k;
                    }
                    this.device_apps.push(list[k]);
                }
                c(this.device_apps);
            }, (reason) => {
                e(reason);
            });
        });
    }

    /// root path is "#"
    public dir_app(inst: string, sub_path: string, recursion: boolean): Thenable<ApplicationFileNode[]>  {
        if (sub_path.length === 0 || sub_path === '/') {
            sub_path = '#';
        }
        this.emit('log', `Dir Application ${inst} ${sub_path}`);
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
                                this.emit('log', `Dir Application file: ${child.id}`);
                                file_nodes.push(child);
                            }
                        }
                    } else {
                        this.emit('log', `Dir Application file: ${node.id}`);
                        file_nodes.push(node);
                    }
                }
                c(nodes);
            }, (reason) => {
                e(reason);
            });
        });
    }
    public download_file(inst: string, filepath: string): Thenable<string>  {
        this.emit('log', `Download Application File ${inst} ${filepath}`);
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
                interface FileContent {
                    content: string;
                }

                let fc: FileContent = Object.assign({}, data.content);
                if (fc.content) {
                    c(fc.content);
                } else {
                    e("No file content found!");
                }
            }, (reason) => {
                e(reason);
            });
        });
    }
    public upload_file(inst: string, filepath: string, content: string) : Thenable<boolean> {
        this.emit('log', `Upload Application File ${inst} ${filepath}`);
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
                    this.emit('log', `File ${filepath} upload failed! ${data.message}`);
                    c(false);
                } else {
                    this.emit('log', `File ${filepath} uploaded`);
                    c(true);
                }
                return true;
            }, (reason) => {
                this.emit('log', reason);
                c(false);
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