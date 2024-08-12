import {Request} from 'express';
import winston from 'winston';
import {Controller, Get, Post, Req} from '@nestjs/common';
import {VONAGE_GATEWAY_PATH} from "./gateways/vonage.gateway";
import {OpenAiService} from "../services/open-ai.service";
import {uploadRecording} from "../services/aws.service";
import {VonageService} from "../services/vonage.service";
import {ResmateService} from "../services/resmate.service";

@Controller('voice')
export class VoiceController {
    constructor(private openAiService: OpenAiService,
                private vonageService: VonageService,
                private resmateService: ResmateService) {}

    @Get('/answer')
    answer(@Req() req: Request): any {
        console.log('REQUEST TO /answer'/*, req.query*/);
        return [
            {
                action: "record",
                eventUrl: [`${process.env.SERVER_URL}/voice/recording`]
            },
            {
                action: "connect",
                endpoint: [
                    {
                        type: "websocket",
                        uri: `${process.env.SERVER_URL_WSS}/${VONAGE_GATEWAY_PATH}`,
                        "content-type": "audio/l16;rate=16000",
                        headers: {
                            from_number: (req.query.from as string).slice(1),
                            to_number: (req.query.to as string).slice(1),
                            conversation_id: req.query.conversation_uuid,
                            call_id: req.query.uuid
                        }
                    }
                ]
            },
        ];
    }

    @Get('/input')
    input(@Req() req: Request) {
        console.log('REQUEST TO /input'/*, req.query*/);
    }

    @Get('/event')
    event(@Req() req: Request) {
        console.log('REQUEST TO /event'/*, req.query*/);
    }

    @Get('/fallback')
    fallback(): string {
        console.log('REQUEST TO /fallback');
        return 'Fallback';
    }

    @Get('/text-embedding')
    getEmbedding(@Req() req: Request) {
        console.log('REQUEST TO /text-embedding');
        return this.openAiService.getTextEmbedding(req.query.text);
    }

    @Post('/recording')
    async recording(@Req() req: Request) {
        console.log('REQUEST TO /recording');
        try {
            const { filename, file } = await this.vonageService.getConversationAudioFile(req.body.recording_url);

            const recording_url = await uploadRecording(filename, file);
            await this.resmateService.updateConversation(req.body.conversation_uuid, { recording_url });

        } catch (e) {
            console.error(e);
        }
    }
}
