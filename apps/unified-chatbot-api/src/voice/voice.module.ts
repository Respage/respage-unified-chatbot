import {Module} from '@nestjs/common';
import {VoiceController} from "./voice.controller";
import {VoiceService} from "../services/voice.service";
import {VonageService} from "../services/vonage.service"
import {VonageGatewayModule} from "./gateways/vonage-gateway.module";
import {GoogleService} from "../services/google.service";
import {OpenAiService} from "../services/open-ai.service";
import {ElevenLabsService} from "../services/eleven-labs.service";
import {ResmateService} from "../services/resmate.service";
import {RedisModule} from "../services/redis.module";
import {LaunchDarklyModule} from "../services/launchdarkly.module";

@Module({
    imports: [
        VonageGatewayModule,
        RedisModule,
        LaunchDarklyModule
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
        ResmateService,
    ]
})
export class VoiceModule {}
