import axios from 'axios';
import {forwardRef, Inject, Injectable} from "@nestjs/common";
import {Duplex} from "stream";
import {VoiceService} from "./voice.service";
import {ActiveCall, DONE_BUFFER} from "../models/active-call.model";

const MODEL = "eleven_turbo_v2";
const WEBHOOK_URL = `wss://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_LABS_FEMALE_VOICE_ID}/stream-input?model_id=${MODEL}&output_format=pcm_16000&optimize_streaming_latency=2`;
const TEXT_TO_SPEECH_URL = `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_LABS_FEMALE_VOICE_ID}?output_format=pcm_16000`;
const SIMILARITY_BOOST = 0.8;
const STABILITY = 0.1

@Injectable()
export class ElevenLabsService {

    constructor(@Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService) {}

    getTextToSpeechStream(call: ActiveCall): Duplex {
        const original_this = this;
        let chunks = [];
        let stream: Duplex = new Duplex({
            read() {},
            async write(chunk, encoding, callback) {
                if (chunk.compare(DONE_BUFFER)) {
                    chunks.push(chunk);
                } else {
                    if (chunks.length) {
                        let strs: any = Buffer.concat(chunks)
                            .toString().split(/(\. |! |\?)/)
                            .map(x => !!x ? x.trim().replace(/[\n]+/g, ' ') : x);

                        for (let i = 0; i < strs.length; i += 2) {
                            if (!strs[i + 1]) {
                                break;
                            }

                            strs[i] += strs[i + 1];
                            strs[i + 1] = null;
                        }
                        strs = strs.filter(x => !!x);
                        // console.log(strs);

                        let previous = 'Quickly but pleasantly they said: "';
                        let current = strs[0];
                        let next = strs[2];
                        stream.push(await original_this.textToSpeech(previous, current, next));
                        for (let i = 1; i < strs.length; i++) {
                            previous = current;
                            current = strs[i];
                            next = strs[i + 1];

                            stream.push(await original_this.textToSpeech(previous, current, next));
                            await (new Promise(resolve => setTimeout(resolve, 100)));
                        }
                        chunks = [];
                    }

                    stream.push(DONE_BUFFER);
                }

                callback();
            }
        });

        return stream;
    }

    async textToSpeech(previous_text: string, text: string, next_text: string) {
        const data: any = {
            model_id: MODEL,
            text,
            voice_settings: {
                similarity_boost: 0,
                stability: 0.3,
                style: 0,
                use_speaker_boost: true
            },
            pronunciation_dictionary_locators: [
                {
                    pronunciation_dictionary_id: process.env.ELEVEN_LABS_PRONUNCIATION_DICTIONARY_ID,
                    version_id: process.env.ELEVEN_LABS_PRONUNCIATION_DICTIONARY_VERSION_ID
                }
            ],
        };

        if (previous_text) {
            data.previous_text = previous_text;
        }

        if (next_text) {
            data.previous_text = next_text;
        }

        const config = {
            method: 'POST',
            responseType: 'arraybuffer' as any,
            url: `${TEXT_TO_SPEECH_URL}`,
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVEN_LABS_API_KEY,
            },
            data
        };

        const response = await axios(config);

        return response.data;
    }
}
