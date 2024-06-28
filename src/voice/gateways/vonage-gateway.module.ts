import {Module} from "@nestjs/common";
import {VonageGateway} from "./vonage.gateway";
import {VoiceService} from "../services/voice.service";
import {GoogleService} from "../../services/google.service";
import {OpenAiService} from "../../services/open-ai.service";
import {ElevenLabsService} from "../../services/eleven-labs.service";
import {DeepgramService} from "../../services/deepgram.service";
import {UnrealSpeechService} from "../../services/unreal-speech.service";
import {ResmateService} from "../../services/resmate.service";

@Module({
    providers: [
        VonageGateway,
        VoiceService,
        GoogleService,
        OpenAiService,
        ElevenLabsService,
        DeepgramService,
        UnrealSpeechService,
        ResmateService,
    ]
})
export class VonageGatewayModule {}
