import {MessageBody, SubscribeMessage, WebSocketGateway} from "@nestjs/websockets";

@WebSocketGateway()
export class WebsocketGateway {
    afterInit() {
        console.log("Websocket Gateway initialized");
    }

    @SubscribeMessage('events')
    handleMessage(@MessageBody() data: string) {
        console.log("HERE");
        console.log(data)
    }
}
