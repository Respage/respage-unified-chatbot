import winston from "winston";
import {forwardRef, Inject, Injectable} from '@nestjs/common';
import {VoiceService} from "./voice.service";
import {ActiveCall} from "../models/active-call.model";
import {Duplex, TransformCallback} from "stream";
import axios from "axios";
import {google} from "@google-cloud/text-to-speech/build/protos/protos";
import texttospeech = google.cloud.texttospeech;


@Injectable()
export class UnrealSpeechService {
    constructor(@Inject(forwardRef(() => VoiceService)) private voiceService: VoiceService) {
    }

    getTextToSpeechStream(call: ActiveCall): Duplex {
        const original_this = this;
        const stream = new Duplex({
            read() {},
            async write(chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
                const responseStream = await original_this.textToSpeech(chunk.toString());
                //require('fs').writeFileSync('temp.raw', responseStream, {encoding: 'binary'});
                stream.push(Buffer.from(responseStream, 44));
                //responseStream.on('data', data => stream.push(data));
                callback();
            }
        });

        call.onClose(() => {
            console.log("Closing Unreal Speech text to speech stream");
            stream.end();
        });

        return stream;
    }

    async textToSpeech(text: string) {
        const response = await axios({
            method: 'POST',
            url: 'https://api.v6.unrealspeech.com/stream',
            headers: {
                Authorization: `Bearer ${process.env.UNREAL_SPEECH_API_TOKEN}`,
                'content-type': 'application/json',
            },
            data: {
                Text: text,
                VoiceId: 'Amy',
                Bitrate: '16k',
                Speed: '0.3',
                Pitch: '1',
                Codec: 'pcm_mulaw',
                Temperature: 0.25
            },
            responseType: 'arraybuffer'
        });

        return response.data;
    }
}
