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
        // winston.info("Vonage Websocket Gateway initialized");
    }

    handleConnection(client) {
        console.log('VonageGateway handleConnection');
        // winston.info('VonageGateway handleConnection', {client});
        this.clients.push(client);
    }

    handleDisconnect(client) {
        // winston.info('VonageGateway handleDisconnect', {client});
        const index = this.clients.indexOf(client);

        if (index > -1) {
            this.clients.splice(index, 1);
        }
    }

    @SubscribeMessage('websocket:connected')
    async handleMessage(client, payload) {
        try {
            console.log('VonageGateway handleMessage websocket:connected');
            // winston.info('VonageGateway handleMessage websocket:connected', {client, payload});
            await this.voiceService.startCall(payload.conversation_id, payload.call_id, payload.from_number, payload.to_number, client);
        } catch (e) {
            console.log(e);
            // winston.error({e})
        }
    }
}
