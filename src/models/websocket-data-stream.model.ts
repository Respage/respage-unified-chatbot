import {WebSocket} from 'ws';
import {Readable} from "stream";

export class BinDataStream {
    private socket: WebSocket;
    private stream: Readable;

    constructor(s: WebSocket) {
        this.socket = s;
        this.stream = new Readable();
        this.socket.on('message', (msg) => {
            this.stream.push(msg);
        });
    }
}
