import {Logger} from "winston";
import {forwardRef, Inject, Injectable} from '@nestjs/common';

import {v2} from '@google-cloud/speech';
import {Duplex, TransformCallback} from "stream";
import {VoiceService} from "./voice.service";
import {ActiveCall, DONE_BUFFER} from "../models/active-call.model";
import {TextToSpeechClient} from "@google-cloud/text-to-speech";
import {google as googleTextToSpeech} from "@google-cloud/text-to-speech/build/protos/protos";
import {google as googleSpeechToText} from "@google-cloud/speech/build/protos/protos";
import {OpenAiService} from "./open-ai.service";
import {WINSTON_MODULE_PROVIDER} from "nest-winston";

@Injectable()
export class GoogleService {
    private speechToTextClient: v2.SpeechClient;
    private textToSpeechClient: TextToSpeechClient;

    constructor(@Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService,
                @Inject(forwardRef(() => OpenAiService)) private openAiService: OpenAiService,
                @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {
        const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CLOUD_CREDENTIALS, 'base64').toString('utf-8'));
        logger.info("GOOGLE CREDENTIALS", credentials);
        this.speechToTextClient = new v2.SpeechClient({...credentials, apiEndpoint: 'https://us-central1-speech.googleapis.com'});
        this.textToSpeechClient = new TextToSpeechClient({credentials})
    }

    getSpeechToTextStream(call: ActiveCall): Duplex {
        const original_this = this;
        let transcriptionStream;
        let chunks = [];
        const stream = new Duplex({
            read() {},
            async write(chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
                if (chunk.compare(DONE_BUFFER)) {
                    chunks.push(chunk);
                } else {
                    try {
                        call.stopListening();
                        call.startTyping().then();

                        const [result] = await original_this.speechToTextClient.recognize({
                            content: new Uint8Array(Buffer.concat(chunks)),
                            recognizer: 'projects/respage-app/locations/us-central1/recognizers/respage-unified-chatbot-chirp-phone-call-recognizer',
                        });
                        chunks = [];
                        const transcript = result?.results
                            ?.reduce((acc, val) => val?.alternatives?.length ? [...acc, ...val.alternatives] : acc, [])
                            .sort((a, b) => b.confidence - a.confidence)[0]?.transcript;
                        if (transcript) {
                            stream.push(transcript);
                            stream.push(DONE_BUFFER);
                        } else {
                            original_this.logger.error("GoogleService getSpeechToTextStream recognize did not return valid value", {result});
                            call.promptAI("Apologize, say you didn't catch that, and ask them to repeat themselves. Suggest they try using more words.");
                        }
                    } catch (e) {
                        original_this.logger.error('Google speech to text stream: failed to recognize', {e});
                        call.promptAI("Apologize because something has gone wrong and ask the user to try again.");
                        callback();
                        return;
                    }
                }

                callback();

                // if (!transcriptionStream) {
                //     transcriptionStream = await original_this.speechToTextClient.streamingRecognize({
                //         config: {
                //             encoding: 'LINEAR16',
                //             sampleRateHertz: 16000,
                //             languageCode: 'en-US',
                //             useEnhanced: true,
                //             model: 'phone_call',
                //
                //         },
                //         singleUtterance: true,
                //         // enableVoiceActivityEvents: true,
                //         // voiceActivityTimeout: {
                //         //     speechStartTimeout: {seconds: 2},
                //         //     speechEndTimeout: {seconds: 2}
                //         // },
                //         interimResults: false,
                //     })
                //     .on('error', e => {
                //         this.logger.error(e);
                //         transcriptionStream?.end();
                //         transcriptionStream = null;
                //     })
                //     .on('data', (data) => {
                //         clearTimeout(clearStreamTimeout);
                //
                //         if (data?.results?.[0]?.alternatives?.[0]?.transcript) {
                //             stream.push(data.results[0].alternatives[0].transcript);
                //             call.startTyping();
                //         }
                //
                //         clearStreamTimeout = setTimeout(() => {
                //             transcriptionStream?.end();
                //             transcriptionStream = null;
                //         }, 1000);
                //     })
                //     .on('end', () => {
                //         transcriptionStream = null;
                //     });
                // }
                //
                // if (!chunk.compare(DONE_BUFFER)) {
                //     transcriptionStream?.end();
                //     transcriptionStream = null;
                // } else {
                //     transcriptionStream.write(chunk);
                // }
                //
                // callback();
            }
        });

        call.onClose(() => {
            this.logger.info("Closing Google speech to text stream");
            transcriptionStream?.end()
            stream.end();
        });

        return stream;
    }

    getTextToSpeechStream(call: ActiveCall, streamInput: boolean = false): Duplex {
        const original_this = this;
        let textBuffer = "";
        const stream = new Duplex({
            read() {},
            async write(chunk, encoding, callback) {
                if (streamInput) {
                    let text = chunk.toString();
                    const sentenceEnder = /([.!?])/.exec(text);
                    if (!sentenceEnder) {
                        textBuffer += text;
                        callback();
                        return
                    } else {
                        let split = text.split(sentenceEnder[1]);
                        textBuffer += split[0] + sentenceEnder[1];
                    }
                } else {
                    textBuffer = chunk.toString()
                }

                const text = textBuffer;
                textBuffer = '';

                const [response] = await original_this.textToSpeechClient.synthesizeSpeech({
                    input: {text},
                    voice: {languageCode: 'en-US', ssmlGender: 'NEUTRAL'},
                    audioConfig: {
                        audioEncoding: googleTextToSpeech.cloud.texttospeech.v1.AudioEncoding.LINEAR16,
                        sampleRateHertz: 16000
                    }
                });

                callback();

                stream.push(Buffer.from(response.audioContent).subarray(640));
                call.startListening();
            }
        });

        call.onClose(() => {
            this.logger.info("Closing Google text to speech stream");
            stream.end();
        });

        return stream;
    }
}
