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
            if (this.client.OutputChannel) {
                this.client.OutputChannel.appendLine("UDP is listening on " + addr.address + ":" + addr.port);
            }
        });
        this.udpServer.bind(port);
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

    private onData(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        interface MSG {
            type: string;
            data: any;
        }
        
        let obj: MSG = Object.assign([], JSON.parse(msg.toString()));
       
        if (obj.type === 'log') {
            let channel = this.client.LogChannel;
            if (channel) {
                let tm = this.formatDateTime(<number>obj.data.timestamp * 1000);
                channel.appendLine(`[${rinfo.address}] [${tm}] [${obj.data.level}] [${obj.data.process}] ${obj.data.content} `);
            }
        } 
        if (obj.type === 'event') {
            let channel = this.client.LogChannel;
            if (channel) {
                let tm = this.formatDateTime(<number>obj.data.timestamp * 1000);
                let data_data = JSON.stringify(obj.data.data);
                channel.appendLine(`[${rinfo.address}] [${tm}] [${obj.data.type}] [${obj.data.app}] [${obj.data.level}] ${obj.data.info} ${data_data}`);
            }
        } 
        if (obj.type === 'comm') {
            let channel = this.client.CommChannel;
            if (channel) {
                let tm = this.formatDateTime(<number>obj.data.ts * 1000);
                let data = new Buffer(obj.data.data, 'base64');
                channel.appendLine(`[${rinfo.address}] [${tm}] [${obj.data.dir}] [${obj.data.sn}] ${data.toString('hex')} `);
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
    public heartbeat(device_ip: string): void {
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