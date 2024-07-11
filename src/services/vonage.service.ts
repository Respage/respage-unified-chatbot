import {Injectable} from '@nestjs/common';
import {Auth} from '@vonage/auth';
import {Vonage} from "@vonage/server-sdk";
import axios, {AxiosRequestConfig} from "axios";
import {ConnectEventType, NCCOActions} from "@vonage/voice";

@Injectable()
export class VonageService {
    private credentials: Auth;
    private vonage: Vonage

    constructor() {}

    async onModuleInit() {
        this.credentials = new Auth({
            applicationId: process.env.VONAGE_APPLICATION_ID,
            apiKey: process.env.VONAGE_API_KEY,
            apiSecret: process.env.VONAGE_API_SECRET,
            privateKey: process.env.VONAGE_PRIVATE_KEY.replace(/\\n/g, '\n')
        });

        this.vonage = new Vonage(this.credentials);
    }

    async getConversationAudioFile(recordingUrl: string): Promise<{filename: string, file: Buffer}> {
        const options: AxiosRequestConfig = {
            url: recordingUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            params: {
                api_key: process.env.VONAGE_API_KEY,
                api_secret: process.env.VONAGE_API_SECRET,
            },
        };

        const result = await axios(options);
        let filename = recordingUrl.split('/').pop() + '.mp3';

        return {filename, file: Buffer.from(result.data)};
    }

    async forwardCall(conversation_uuid: string, fromNumber: string, forwardingNumber: string) {
        return this.vonage.voice.transferCallWithNCCO(
            conversation_uuid,
            [{
                action: NCCOActions.CONNECT,
                eventType: ConnectEventType.SYNCHRONOUS,
                eventUrl: [`${process.env.SERVER_URL}/voice/event`],
                timeout: 45,
                from: "1"+fromNumber,
                endpoint: [
                    {
                        type: 'phone',
                        number: "1"+forwardingNumber
                    },
                ],
            }]
        )
    }
}