import winston from "winston";
import {SubscribeMessage, WebSocketGateway} from "@nestjs/websockets";
import {RespageWebSocketAdapter} from "../../websocket/custom.adapter";
import {VoiceService} from "../../services/voice.service";
import {forwardRef, Inject} from "@nestjs/common";

export const VONAGE_GATEWAY_PATH = 'websocket/vonage'

@WebSocketGateway({ path: VONAGE_GATEWAY_PATH })
export class VonageGateway {
    clients: RespageWebSocketAdapter[] = [];

    constructor(@Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService) {}

    afterInit(server) {
        console.log("Vonage Websocket Gateway initialized");
        // console.log("Vonage Websocket Gateway initialized");
    }

    handleConnection(client) {
        console.log('VonageGateway handleConnection');
        // console.log('VonageGateway handleConnection', {client});
        this.clients.push(client);
    }

    handleDisconnect(client) {
        // console.log('VonageGateway handleDisconnect', {client});
        const index = this.clients.indexOf(client);

        if (index > -1) {
            this.clients.splice(index, 1);
        }
    }

    @SubscribeMessage('websocket:connected')
    async handleMessage(client, payload) {
        try {
            console.log('VonageGateway handleMessage websocket:connected');
            // console.log('VonageGateway handleMessage websocket:connected', {client, payload});
            await this.voiceService.startCall(payload.conversation_id, payload.call_id, payload.from_number, payload.to_number, client);
        } catch (e) {
            console.log(e);
            // console.error({e})
        }
    }
}
