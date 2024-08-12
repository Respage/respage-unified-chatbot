import winston from "winston";
import {forwardRef, Inject, Injectable} from "@nestjs/common";
import {Duplex} from "stream";
import {VoiceService} from "./voice.service";
import {createClient, DeepgramClient, LiveTranscriptionEvents} from "@deepgram/sdk";
import {SpeakClient} from "@deepgram/sdk/dist/main/packages/SpeakClient";
import {ActiveCall} from "../models/active-call.model";

const SPEECH_TO_TEXT_MODEL = "nova-2";
const TEXT_TO_SPEECH_MODEL = "aura-asteria-en";
const AUDIO_STREAMING_URL_EN = "https://api.deepgram.com/v1/speak?model=aura-asteria-en";

@Injectable()
export class DeepgramService {
    private client: DeepgramClient

    constructor(@Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService) {
        this.client = createClient(process.env.DEEPGRAM_SECRET_KEY);
    }

    getSpeechToTextStream(call: ActiveCall): Duplex {
        let stream: Duplex;
        let connection = this.client.listen.live({
            model: SPEECH_TO_TEXT_MODEL,
            language: "en-US",
            smart_format: true,
            encoding: 'linear16',
            sample_rate: 16000
        });

        connection.on(LiveTranscriptionEvents.Open, () => {
            connection.on(LiveTranscriptionEvents.Close, () => {
                winston.info("Connection closed.");
            });

            connection.on(LiveTranscriptionEvents.Transcript, (data) => {
                if (data.channel.alternatives[0].transcript) {
                    call.startTyping();
                    stream.push(data.channel.alternatives[0].transcript);
                }
            });

            connection.on(LiveTranscriptionEvents.Metadata, (data) => {
                winston.info(data);
            });

            connection.on(LiveTranscriptionEvents.Error, (err) => {
                console.error(err);
            });
        });

        stream = new Duplex({
            read() {
            },
            write(chunk, encoding, callback) {
                connection.send(chunk)
                callback();
            }
        });

        return stream;
    }

    getTextToSpeechStream(streamInput = false): Duplex {
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

                const speakClient = await original_this.client.speak.request(
                    {text: textBuffer},
                    {
                        model: TEXT_TO_SPEECH_MODEL,
                        encoding: 'linear16',
                        sample_rate: 16000
                    }
                )

                textBuffer = '';
                callback();

                const audioOverflowBuffer = Buffer.alloc(640, 0, 'binary');

                let bufferIndex = 0;
                let chunkIndex = 0;
                let overflowIndex = 0;

                for await (const chunk of (await speakClient.getStream() as any)) {
                    const chunkBuffer = Buffer.from(chunk);
                    chunkIndex = 0;
                    overflowIndex = chunkBuffer.length;

                    if (bufferIndex) {
                        chunkIndex = 640 - bufferIndex;
                        if (chunkIndex < chunkBuffer.length) {
                            chunkBuffer.copy(audioOverflowBuffer, bufferIndex, 0, chunkIndex);

                            stream.push(Buffer.from(audioOverflowBuffer));
                            bufferIndex = 0;
                        } else {
                            chunkBuffer.copy(audioOverflowBuffer, bufferIndex);
                            bufferIndex += chunkBuffer.length
                            continue;
                        }
                    }

                    const overflow = chunkBuffer.length < 640 ? chunkBuffer.length : (chunkBuffer.length - chunkIndex) % 640;
                    if (overflow) {
                        bufferIndex = overflow;
                        overflowIndex = chunkBuffer.length - overflow;
                        chunkBuffer.copy(audioOverflowBuffer, 0, overflowIndex);

                        if (overflow === chunkBuffer.length) {
                            continue;
                        }
                    }

                    const window = chunkBuffer.subarray(chunkIndex, overflowIndex);
                    // winston.info(window.length / 640);

                    stream.push(window);
                }
            }
        });

        return stream;
    }
}
