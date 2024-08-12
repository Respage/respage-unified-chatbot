import winston from "winston";
import {forwardRef, Inject, Injectable} from '@nestjs/common';

import {SpeechClient} from '@google-cloud/speech';
import {Duplex, TransformCallback} from "stream";
import {VoiceService} from "./voice.service";
import {ActiveCall, DONE_BUFFER} from "../models/active-call.model";
import {TextToSpeechClient} from "@google-cloud/text-to-speech";
import {google} from "@google-cloud/text-to-speech/build/protos/protos";
import AudioEncoding = google.cloud.texttospeech.v1.AudioEncoding;
import {OpenAiService} from "./open-ai.service";

@Injectable()
export class GoogleService {
    private speechToTextClient: SpeechClient;
    private textToSpeechClient: TextToSpeechClient;

    constructor(@Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService,
                @Inject(forwardRef(() => OpenAiService)) private openAiService: OpenAiService) {
        const credentials = JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS);
        this.speechToTextClient = new SpeechClient({credentials});
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
                            audio: {content: Buffer.concat(chunks)},
                            config: {
                                encoding: 'LINEAR16',
                                sampleRateHertz: 16000,
                                languageCode: 'en-US',
                                useEnhanced: true,
                                model: 'phone_call',

                            },
                        });
                        chunks = [];
                        if (result?.results?.[0]?.alternatives?.[0]?.transcript) {
                            stream.push(result?.results?.[0]?.alternatives?.[0]?.transcript);
                            stream.push(DONE_BUFFER);
                        } else {
                            call.promptAI("Apologize because something has gone wrong, then ask if the user has further questions.");
                        }
                    } catch (e) {
                        console.error(e);
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
                //         console.error(e);
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
            winston.info("Closing Google speech to text stream");
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
                        audioEncoding: AudioEncoding.LINEAR16,
                        sampleRateHertz: 16000
                    }
                });

                callback();

                stream.push(Buffer.from(response.audioContent).subarray(640));
                call.startListening();
            }
        });

        call.onClose(() => {
            winston.info("Closing Google text to speech stream");
            stream.end();
        });

        return stream;
    }
}
