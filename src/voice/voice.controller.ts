import {Request} from 'express';
import {Logger} from 'winston';
import {Controller, Get, Inject, Post, Req} from '@nestjs/common';
import {VONAGE_GATEWAY_PATH} from "./gateways/vonage.gateway";
import {OpenAiService} from "../services/open-ai.service";
import {uploadRecording} from "../services/aws.service";
import {VonageService} from "../services/vonage.service";
import {ResmateService} from "../services/resmate.service";
import {WINSTON_MODULE_PROVIDER} from "nest-winston";

@Controller('voice')
export class VoiceController {
    constructor(private openAiService: OpenAiService,
                private vonageService: VonageService,
                private resmateService: ResmateService,
                @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {}

    @Get('/answer')
    answer(@Req() req: Request): any {
        this.logger.info('REQUEST TO /answer', req.query);
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
        this.logger.info('REQUEST TO /input', req.query);
    }

    @Get('/event')
    event(@Req() req: Request) {
        this.logger.info('REQUEST TO /event', req.query);
    }

    @Get('/fallback')
    fallback(): string {
        this.logger.info('REQUEST TO /fallback');
        return 'Fallback';
    }

    @Get('/text-embedding')
    getEmbedding(@Req() req: Request) {
        this.logger.info('REQUEST TO /text-embedding', req.query);
        return this.openAiService.getTextEmbedding(req.query.text);
    }

    @Post('/recording')
    async recording(@Req() req: Request) {
        this.logger.info('REQUEST TO /recording', req.body);
        try {
            const { filename, file } = await this.vonageService.getConversationAudioFile(req.body.recording_url);
            this.logger.info('/recording getConversationAudioFile', { filename });
            const recording_url = await uploadRecording(filename, file);
            this.logger.info('/recording uploadRecording', { recording_url });
            const result = await this.resmateService.updateConversation(req.body.conversation_uuid, { recording_url });
            this.logger.info('/recording updateConversation', { result });
        } catch (e) {
            this.logger.error(e);
        }
    }
}
