import {SubscribeMessage, WebSocketGateway} from "@nestjs/websockets";
import {RespageWebSocketAdapter} from "../../websocket/custom.adapter";
import {VoiceService} from "../services/voice.service";

export const VONAGE_GATEWAY_PATH = 'websocket/vonage'

@WebSocketGateway({ path: VONAGE_GATEWAY_PATH })
export class VonageGateway {
    clients: RespageWebSocketAdapter[] = [];

    constructor(private voiceService: VoiceService) {}

    afterInit(server) {
        console.log("Vonage Websocket Gateway initialized");
    }

    handleConnection(client) {
        this.clients.push(client);
    }

    handleDisconnect(client) {
        const index = this.clients.indexOf(client);

        if (index > -1) {
            this.clients.splice(index, 1);
        }
    }

    @SubscribeMessage('websocket:connected')
    async handleMessage(client, payload) {
        try {
            console.log(payload);
            await this.voiceService.startCall(payload.conversation_id, payload.from_number, payload.to_number, client);
        } catch (e) {
            console.log(e);
        }
    }
}
