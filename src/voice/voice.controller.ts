import {Request} from 'express';
import {Controller, Get, Req} from '@nestjs/common';
import {VONAGE_GATEWAY_PATH} from "./gateways/vonage.gateway";
import {OpenAiService} from "../services/open-ai.service";

@Controller('voice')
export class VoiceController {
    constructor(private openAiService: OpenAiService) {}

    @Get('/answer')
    answer(@Req() req: Request): any {
        return [
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
                            conversation_id: req.query.conversation_uuid
                        }
                    }
                ]
            },
        ];
    }

    @Get('/input')
    input(@Req() req: Request) {
        console.log(req.query);
    }

    @Get('/event')
    event(@Req() req: Request) {
        console.log('/event', req.query);
    }

    @Get('/fallback')
    fallback(): string {
        return 'Fallback';
    }

    @Get('/text-embedding')
    getEmbedding(@Req() req: Request) {
        return this.openAiService.getTextEmbedding(req.query.text);
    }
}
