import {Inject, Injectable} from '@nestjs/common';
import {StartStreamTranscriptionCommand, TranscribeStreamingClient} from "@aws-sdk/client-transcribe-streaming";
import {WINSTON_MODULE_PROVIDER} from "nest-winston";
import {Logger} from "winston";

@Injectable()
export class AmazonTranscriptionService {
    private client: TranscribeStreamingClient;

    constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {
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
                this.logger.info("AmazonTranscriptionService transcribe", {event});
            }
        } catch(e) {
            this.logger.error("AmazonTranscriptionService transcribe", {e});
        }
    }
}
