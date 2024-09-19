import {Module} from '@nestjs/common';
import {VoiceController} from "./voice.controller";
import {VoiceService} from "../services/voice.service";
import {VonageService} from "../services/vonage.service"
import {VonageGatewayModule} from "./gateways/vonage-gateway.module";
import {GoogleService} from "../services/google.service";
import {OpenAiService} from "../services/open-ai.service";
import {ElevenLabsService} from "../services/eleven-labs.service";
// import {DeepgramService} from "../services/deepgram.service";
// import {UnrealSpeechService} from "../services/unreal-speech.service";
import {ResmateService} from "../services/resmate.service";
import {RedisModule} from "../services/redis.module";

@Module({
    imports: [
        VonageGatewayModule,
        RedisModule
    ],
    controllers: [
        VoiceController
    ],
    providers: [
        VoiceService,
        VonageService,
        GoogleService,
        OpenAiService,
        ElevenLabsService,
        // DeepgramService,
        // UnrealSpeechService,
        ResmateService,
    ]
})
export class VoiceModule {}
