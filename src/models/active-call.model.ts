import {WebSocket} from "ws";
import {Duplex, promises as nodeStreamPromises} from "stream";
import {VoiceService} from "../voice/services/voice.service";
import {ChatHistoryLog, Conversation, ConversationInfo, PropertyInfo} from "./conversation.model";
import {DateTime} from "luxon";
import {FUNC_SCHEDULE_TOUR} from "./open-ai-functions.model";
const {pipeline} = nodeStreamPromises;

const SAMPLE_SIZE = 320; // How many individual samples are in the sample?
const SAMPLE_SIZE_BYTES = 640; // How many bytes in a single sample?
const BYTES_PER_SAMPLE = 2;
const SIGNED_INT_MAX = 32768;

const START_TALKING_THRESHOLD = 12.5; // How many samples must be consistently above the threshold? 50 = 1 second
const STOP_TALKING_THRESHOLD = 50; // How many samples must be consistently below the threshold? 50 = 1 second
const AVG_WEIGHT = 24000;

export const DONE_BUFFER = Buffer.from("DONE");

enum ActiveCallStreamState {
    POOL,
    STREAM
}

export class ActiveCall {
    readonly id: string;

    private callSocket: WebSocket;
    private readonly onCloseCallbacks: Array<() => void>
    private aIStream: Duplex;

    conversation: Conversation;

    doStopTyping: boolean = false;
    doStopAmbiant: boolean = false;
    playingTyping: number = -1
    doNotInterrupt: boolean = false;

    internalMessageIncoming: boolean = false;

    stallTimeout = null;

    pool: any[] = [];

    strikes = 0;
    state: ActiveCallStreamState = ActiveCallStreamState.POOL;

    private minimumVolume;
    private maximumVolume;
    private weightedAvgVolume;

    constructor(id: string, campaign_id: number, callMemorySize = 20) {
        this.minimumVolume = -1;
        this.maximumVolume = SIGNED_INT_MAX; // maximum absolute value of a signed 16 bit integer
        this.weightedAvgVolume = (this.maximumVolume / 2) + AVG_WEIGHT;

        this.id = id;

        this.onCloseCallbacks = [];

        this.conversation = new Conversation(campaign_id);
    }

    static compileTourDateTime(timezone: string, time: string, day: string, month: string, year?: string) {
        if (!(time && day && month)) {
            return null;
        }

        return DateTime.fromFormat(`${time || '00:00'} ${day || 1} ${month} ${year || DateTime.now().year}`, "HH:mm d MMMM yyyy", {zone: timezone});
    }

    init(websocket: WebSocket, speechToText: Duplex, AI: Duplex, textToSpeech: Duplex, systemPrompData: { property: PropertyInfo, conversation: ConversationInfo }) {
        const original_this = this;

        this.updateSystemPrompt(systemPrompData.property, systemPrompData.conversation);
        this.conversation.functions = [FUNC_SCHEDULE_TOUR];

        let streamStart = 0;
        let audioLength = 0;
        let notStreaming = true;
        // Configure websocket and stream for call audio
        const callStream = new Duplex({
            read() {},
            async write(chunk, encoding, callback) {
                if (!chunk.compare(DONE_BUFFER)) {
                    setTimeout(() => {
                        console.log("Done streaming audio out...");
                        notStreaming = true;
                        streamStart = 0;
                        audioLength = 0;
                        original_this.startListening();
                        // original_this.setStallTimeout();
                    }, audioLength - (Date.now() - streamStart));
                } else {
                    if (notStreaming) {
                        streamStart = Date.now();
                        original_this.stopTyping();
                        notStreaming = false;
                        console.log("Start streaming audio out...");
                    }

                    audioLength += (chunk.length / 640) * 20;

                    for (let i = 0; i < chunk.length; i+= 640) {
                        let subArray = chunk.subarray(i, i + 640);
                        console.log("PACKET LENGTH: ", subArray.length);
                        websocket.send(subArray);
                        await (new Promise(resolve => setTimeout(resolve, 18)))
                    }
                }

                callback()
            }
        });

        websocket.on('message', (msg) => callStream.push(msg));
        websocket.on('close', async () => {
            for (const callback of this.onCloseCallbacks) {
                callback();
            }

            this.stopTyping();
            this.callSocket = null;
        });

        this.callSocket = websocket;

        this.aIStream = AI;

        this.promptAI("Introduce yourself and mention the name of the property.");

        pipeline([
            this.streamAudioOnSpeech(callStream) as any,
            speechToText,
            AI,
            textToSpeech,
            callStream
        ])
            .catch(e => {
                console.error(e);
            });
    }

    // Interface methods
    onClose(callback: () => void) {
        this.onCloseCallbacks.push(callback);
    }

    sendToSocket(chunk: Buffer) {
        this.callSocket?.send(chunk);
    }

    promptAI(prompt: string) {
        this.stopListening();
        try {
            this.internalMessageIncoming = true;
            this.aIStream.write(`[${prompt}]`);
            this.aIStream.write(DONE_BUFFER);
        } catch (e) {
            console.error(e);
        }
    }

    streamAudioOnSpeech(stream): AsyncIterable<any> {
        const original_this = this;

        return (async function* () {
            for await (const chunk of stream) {
                if (original_this.doNotInterrupt) {
                    //process.stdout.write('-M');
                    continue;
                }

                if (original_this.state === ActiveCallStreamState.POOL) {
                    //process.stdout.write('-P');
                    if (original_this.sampleCrossesThreshold(chunk, 1)) {
                        original_this.pool.push(chunk);
                        if (original_this.pool.length >= START_TALKING_THRESHOLD) {
                            original_this.state = ActiveCallStreamState.STREAM;
                            console.log("Streaming...");
                            yield original_this.pool.shift();
                        }
                    } else {
                        original_this.pool = [];
                    }
                } else if (original_this.state === ActiveCallStreamState.STREAM) {

                    //process.stdout.write('-S');
                    original_this.pool.push(chunk);

                    if (original_this.sampleCrossesThreshold(chunk, -1)) {
                        original_this.strikes++
                        if (original_this.strikes >= STOP_TALKING_THRESHOLD) {
                            yield DONE_BUFFER;
                        }
                    } else {
                        original_this.strikes = 0;
                    }

                    if (original_this.pool.length) {
                        yield original_this.pool.shift();
                    }
                }
            }
        })();
    }

    stopListening() {
        //this.setStallTimeout();
        this.pool = [];
        this.strikes = 0;
        this.state = ActiveCallStreamState.POOL;
        this.doNotInterrupt = true;
    }

    startListening() {
        console.log("Pooling...");
        this.stopTyping();
        // this.playAmbiant().then();
        this.doNotInterrupt = false;
    }

    setStallTimeout() {
        clearTimeout(this.stallTimeout)
        this.stallTimeout = setTimeout(() => {
            this.promptAI("Apologize because something has gone wrong and ask the user to try again.");
        }, 20000);
    }

    clearStallTimeout() {
        clearTimeout(this.stallTimeout);
    }

    async startTyping() {
        this.setStallTimeout();
        this.doStopAmbiant = true;
        this.doStopTyping = false;
        let sent = 0;
        do {
            this.playingTyping = Math.floor(Math.random() * VoiceService.typingSounds.length);
            const buffer = VoiceService.typingSounds[this.playingTyping];

            for (let i = 0; i < buffer.length; i += 640) {
                sent++;
                this.sendToSocket(buffer.subarray(i, i + 640));
                await (new Promise(resolve => setTimeout(resolve, 10)));
                if (this.doStopTyping) {
                    break;
                }
            }

            if (this.doStopTyping) {
                break;
            }

            const waitTime = (buffer.length / 32);
            console.log ("WAITING ", (waitTime / 1000).toFixed(2), " Before next typing.");

            await (new Promise<void>(resolve => {
                let monitorInterval;
                let maxTimeout = setTimeout(() => {
                    clearInterval(monitorInterval);
                    resolve();
                }, waitTime);

                monitorInterval = setInterval(() => {
                    if (this.doStopTyping) {
                        clearTimeout(maxTimeout);
                        resolve();
                    }
                }, 10);
            }));
        } while (!this.doStopTyping);

        // console.log("SECONDS OF TYPING SENT: ", (sent * 20) / 1000);
        this.stopTyping();
    }

    async playAmbiant() {
        this.doStopAmbiant = false;
        do {
            for (let i = 0; i < VoiceService.ambiantSound.length; i += 640) {
                this.sendToSocket(VoiceService.ambiantSound.subarray(i, i + 640));
                await (new Promise(resolve => setTimeout(resolve, 10)));
                if (this.doStopAmbiant) {
                    break;
                }
            }
        } while (!this.doStopAmbiant);
    }

    stopTyping() {
        this.clearStallTimeout();
        //this.playAmbiant().then();
        this.doStopTyping = true;
        this.playingTyping = -1;
    }

    updateCallHistory(message: ChatHistoryLog) {
        this.conversation.updateCallHistory(message);
    }

    getCallMessageWindow() {
        return this.conversation.getCallMessageWindow();
    }

    getCallHistory() {
        return this.conversation.getCallHistory();
    }

    setTourScheduled(scheduled: boolean) {
        this.updateSystemPrompt(null, {tour_scheduled: scheduled});
    }

    getTourDateTimeConfirmed() {
        return this.conversation.conversationInfo?.tour_date_time_confirmed;
    }

    getTourDateTime() {
        return this.conversation.conversationInfo?.tour_date_time;
    }

    tourScheduled() {
        return this.conversation.conversationInfo?.tour_scheduled;
    }

    getFunctions() {
        if (this.conversation.functions.length) {
            return this.conversation.functions;
        }

        return null;
    }

    updateSystemPrompt(propertyInfoUpdate?: PropertyInfo, conversationInfoUpdate?: ConversationInfo) {
        this.conversation.updateSystemPrompt(propertyInfoUpdate, conversationInfoUpdate);
    }

    // Internal methods
    private removeFunction(name: string) {
        const index = this.conversation.functions.findIndex(x => x.name === name);
        if (index > -1) {
            this.conversation.functions.splice(index, 1);
        }
    }

    private sampleCrossesThreshold(sample: Buffer, direction = 1) {
        let max = 0;
        let min = Infinity;
        for (let i = 0; i < SAMPLE_SIZE_BYTES; i += BYTES_PER_SAMPLE) {
            const val = Math.abs(sample.readInt16BE(i));
            if (val > max) {
                max = val;
            }

            if (val < min) {
                min = val;
            }

            if (!(i % 64)) {
                if (this.minimumVolume < 0 || min < this.minimumVolume) {
                    this.minimumVolume = min;

                    this.weightedAvgVolume = (AVG_WEIGHT + this.minimumVolume + this.maximumVolume) / 2;

                    if (this.weightedAvgVolume > SIGNED_INT_MAX) {
                        this.weightedAvgVolume = SIGNED_INT_MAX;
                    }
                }
            }
        }

        return direction > 0 ? max >= this.weightedAvgVolume :
            max < this.weightedAvgVolume;
    }
}
