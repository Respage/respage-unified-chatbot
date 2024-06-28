import {WebSocket} from 'ws';
import {Duplex, TransformCallback} from "stream";

export class WebSocketDataStream {
    private socket: WebSocket;
    private stream: Duplex;

    constructor(
        s: WebSocket,
        init?: {
            onSend?: (chunk: any) => any;
            onOpen?: (client) => void,
            onMessage?: (msg: any) => any,
            onClose?: () => void,
            stringFormat?: boolean
        }) {
        const original_this = this;
        this.socket = s;

        const write = init?.onSend ?
            function (chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
                original_this.socket.send(init.onSend(chunk));
                callback(null, chunk);
            } :
            function (chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
                original_this.socket.send(chunk);
                callback(null, chunk);
            };

        this.stream = new Duplex({
            read() {},
            write
        });

        if (init?.onOpen) {
            this.socket.on(
                'open',
                (client) => init.onOpen(client)
            );
        }

        this.socket.on(
            'message',
            init?.onMessage ?
                (msg) => this.stream.push(init.onMessage(msg)) :
                (msg) => this.stream.push(msg)
        );

        this.socket.on(
            'close',
            init?.onClose ? async () => {
                init.onClose();
                this.stream.push(null);
            } : () => this.stream.push(null)
        );
    }

    send(msg: any) {
        this.socket.send(msg);
    }

    getStream(): Duplex {
        return this.stream;
    }


    getIterator(): AsyncIterable<any> {
        return this.stream.iterator({destroyOnReturn: false});
    }

    streamClosed() {
        return this.stream.closed;
    }

    closeStream() {
        this.stream.destroy();
        this.socket.close();
    }
}
