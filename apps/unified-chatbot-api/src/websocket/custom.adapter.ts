import * as wsPackage from 'ws';
import {INestApplicationContext, Logger, WebSocketAdapter} from '@nestjs/common';
import { MessageMappingProperties } from '@nestjs/websockets';
import {Observable, fromEvent, EMPTY, takeUntil, share, first} from 'rxjs';
import { mergeMap, filter } from 'rxjs/operators';
import {
    CLOSE_EVENT,
    CONNECTION_EVENT,
    ERROR_EVENT,
} from '@nestjs/websockets/constants';
import {isFunction, isNil, normalizePath} from "@nestjs/common/utils/shared.utils";
import * as http from "http";

enum READY_STATE {
    CONNECTING_STATE = 0,
    OPEN_STATE = 1,
    CLOSING_STATE = 2,
    CLOSED_STATE = 3,
}

type HttpServerRegistryKey = number;
type HttpServerRegistryEntry = any;
type WsServerRegistryKey = number;
type WsServerRegistryEntry = any[];

const UNDERLYING_HTTP_SERVER_PORT = 0;

export class RespageWebSocketAdapter implements WebSocketAdapter {
    protected readonly httpServer: any;

    protected readonly logger = new Logger(RespageWebSocketAdapter.name);
    protected readonly httpServersRegistry = new Map<
        HttpServerRegistryKey,
        HttpServerRegistryEntry
        >();
    protected readonly wsServersRegistry = new Map<
        WsServerRegistryKey,
        WsServerRegistryEntry
        >();

    constructor(appOrHttpServer?: INestApplicationContext | any) {
        this.httpServer = appOrHttpServer.getUnderlyingHttpServer();
    }

    public create(
        port: number,
        options?: Record<string, any> & {
            namespace?: string;
            server?: any;
            path?: string;
        },
    ) {
        const { server, path, ...wsOptions } = options;
        if (wsOptions?.namespace) {
            const error = new Error(
                '"WsAdapter" does not support namespaces. If you need namespaces in your project, consider using the "@nestjs/platform-socket.io" package instead.',
            );
            this.logger.error(error);
            throw error;
        }

        if (port === UNDERLYING_HTTP_SERVER_PORT && this.httpServer) {
            this.ensureHttpServerExists(port, this.httpServer);
            const wsServer = this.bindErrorHandler(
                new wsPackage.Server({
                    noServer: true,
                    ...wsOptions,
                }),
            );

            this.addWsServerToRegistry(wsServer, port, path);
            return wsServer;
        }

        if (server) {
            return server;
        }
        if (path && port !== UNDERLYING_HTTP_SERVER_PORT) {
            // Multiple servers with different paths
            // sharing a single HTTP/S server running on different port
            // than a regular HTTP application
            const httpServer = this.ensureHttpServerExists(port);
            httpServer?.listen(port);

            const wsServer = this.bindErrorHandler(
                new wsPackage.Server({
                    noServer: true,
                    ...wsOptions,
                }),
            );
            this.addWsServerToRegistry(wsServer, port, path);
            return wsServer;
        }
        const wsServer = this.bindErrorHandler(
            new wsPackage.Server({
                port,
                path,
                ...wsOptions,
            }),
        );
        return wsServer;
    }

    public bindMessageHandlers(
        client: any,
        handlers: MessageMappingProperties[],
        transform: (data: any) => Observable<any>,
    ) {
        const close$ = fromEvent(client, CLOSE_EVENT).pipe(share(), first());
        const source$ = fromEvent(client, 'message').pipe(
            mergeMap(data =>
                this.bindMessageHandler(data, handlers, transform).pipe(
                    filter(result => !isNil(result)),
                ),
            ),
            takeUntil(close$),
        );
        const onMessage = (response: any) => {
            if (client.readyState !== READY_STATE.OPEN_STATE) {
                return;
            }
            client.send(JSON.stringify(response));
        };
        source$.subscribe(onMessage);
    }

    public bindMessageHandler(
        buffer: any,
        handlers: MessageMappingProperties[],
        transform: (data: any) => Observable<any>,
    ): Observable<any> {
        try {
            if (typeof buffer.data !== 'string') {
                return transform(buffer.data);
            }
            const message = JSON.parse(buffer.data);
            const messageHandler = handlers.find(
                handler => handler.message === message.event,
            );
            const { callback } = messageHandler;
            return transform(callback(message, message.event));
        } catch {
            return EMPTY;
        }
    }

    public bindErrorHandler(server: any) {
        server.on(CONNECTION_EVENT, (ws: any) =>
            ws.on(ERROR_EVENT, (err: any) => this.logger.error(err)),
        );
        server.on(ERROR_EVENT, (err: any) => this.logger.error(err));
        return server;
    }

    public bindClientConnect(server: any, callback: Function) {
        server.on(CONNECTION_EVENT, callback);
    }

    public bindClientDisconnect(client: any, callback: Function) {
        client.on(CLOSE_EVENT, callback);
    }

    public async close(server: any) {
        const isCallable = server && isFunction(server.close);
        isCallable && (await new Promise(resolve => server.close(resolve)));
    }

    public async dispose() {
        const closeEventSignals = Array.from(this.httpServersRegistry)
            .filter(([port]) => port !== UNDERLYING_HTTP_SERVER_PORT)
            .map(([_, server]) => new Promise(resolve => server.close(resolve)));

        await Promise.all(closeEventSignals);
        this.httpServersRegistry.clear();
        this.wsServersRegistry.clear();
    }

    protected ensureHttpServerExists(
        port: number,
        httpServer = http.createServer(),
    ) {
        if (this.httpServersRegistry.has(port)) {
            return;
        }
        this.httpServersRegistry.set(port, httpServer);

        httpServer.on('upgrade', (request, socket, head) => {
            try {
                const baseUrl = 'ws://' + request.headers.host + '/';
                const pathname = new URL(request.url, baseUrl).pathname;
                const wsServersCollection = this.wsServersRegistry.get(port);

                let isRequestDelegated = false;
                for (const wsServer of wsServersCollection) {
                    if (pathname === wsServer.path) {
                        wsServer.handleUpgrade(request, socket, head, (ws: unknown) => {
                            wsServer.emit('connection', ws, request);
                        });
                        isRequestDelegated = true;
                        break;
                    }
                }
                if (!isRequestDelegated) {
                    socket.destroy();
                }
            } catch (err) {
                socket.end('HTTP/1.1 400\r\n' + err.message);
            }
        });
        return httpServer;
    }

    protected addWsServerToRegistry<T extends Record<'path', string> = any>(
        wsServer: T,
        port: number,
        path: string,
    ) {
        const entries = this.wsServersRegistry.get(port) ?? [];
        entries.push(wsServer);

        wsServer.path = normalizePath(path);
        this.wsServersRegistry.set(port, entries);
    }
}
