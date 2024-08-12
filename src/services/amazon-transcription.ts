import winston from "winston";
import { Injectable } from '@nestjs/common';
import {StartStreamTranscriptionCommand, TranscribeStreamingClient} from "@aws-sdk/client-transcribe-streaming";

@Injectable()
export class AmazonTranscriptionService {
    private client: TranscribeStreamingClient;

    constructor() {
        this.client = new TranscribeStreamingClient({
            region: 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        } as any);
    }

    async transcribe(AudioStream: AsyncGenerator<any>, timeout: number = 0.5) {
        const command = new StartStreamTranscriptionCommand({
            LanguageCode: 'en-US',
            MediaEncoding: 'pcm',
            MediaSampleRateHertz: 16000,
            AudioStream
        });

        const response: any = await this.client.send(command as any);

        try {
            for await (const event of response.TranscriptResultStream) {
                winston.info("AmazonTranscriptionService transcribe", {event});
            }
        } catch(e) {
            winston.error("AmazonTranscriptionService transcribe", {e});
        }
    }
}
