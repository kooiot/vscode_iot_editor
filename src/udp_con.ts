'use strict';

import * as vscode from 'vscode';
import * as dgram from 'dgram';
import { Client } from './client';


export class UdpConn {
    private disposables: vscode.Disposable[] = [];
    private client: Client;
    private udpServer: dgram.Socket;
    
    constructor( client: Client, port: number) {
        this.client = client;
        this.udpServer = dgram.createSocket("udp4");
        this.udpServer.addListener("message", (msg: Buffer, rinfo: dgram.AddressInfo) => {
            this.onData(msg, rinfo);
        });
        this.udpServer.addListener("error", (err: Error) => {
            this.onError(err);
        });
        this.udpServer.addListener("listening", () => {
            let addr = this.udpServer.address();
            vscode.window.showInformationMessage("UDP is listening on " + addr.address + ":" + addr.port);
        });
        this.udpServer.bind(port);
    }

    private onData(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        interface MSG {
            type: string;
            data: any;
        }
        
        let obj: MSG = Object.assign([], JSON.parse(msg.toString()));
       
        if (obj.type === 'log') {
            let channel = this.client.OutputChannel;
            if (channel) {
                channel.appendLine(`[${rinfo.address}] ${obj.data.timestamp} [${obj.data.level}] [${obj.data.process}] ${obj.data.content} `);
            }
        } else {
            let channel = this.client.DebugChannel;
            if (channel) {
                channel.appendLine(`[${rinfo.address}] ${obj.data.ts} [${obj.data.dir}] [${obj.data.sn}] ${obj.data.data} `);
            }
        }
    }
    private onError(err: Error): void {
        let channel = this.client.OutputChannel;
        if (channel) {
            channel.show();
            channel.appendLine(err.message);
        }
    }
    public ping(device_ip: string): void {
        this.udpServer.send("Hello world", 7788, device_ip);
    }
    public startForward(device_ip: string): void {
        this.udpServer.send("WHOISYOURDADDY", 7788, device_ip);
    }

    public dispose(): Thenable<void> {
        this.udpServer.close();
        
        let promise: Thenable<void> = Promise.resolve();
        return promise.then(() => {
            this.disposables.forEach((d) => d.dispose());
            this.disposables = [];
        });
    }
}