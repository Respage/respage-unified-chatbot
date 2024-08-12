import winston from "winston";
import {Injectable} from "@nestjs/common";
import {createClient, RedisClientType} from "redis";

const SYSTEM_PROMPT_DATA_KEY = `~unified-chatbot~system-prompt-data`;

@Injectable()
export class RedisService {
    _client: RedisClientType;
    _pingInterval;

    constructor() {
        this.connect();
    }

    connect() {
        if (this._client) {
            this._client
                .disconnect()
                // .then(() => console.log('REDIS SERVICE Client disconnected'))
                .catch((err) =>
                    console.error('REDIS SERVICE Error disconnecting client'/*, { err }*/),
                );
            clearInterval(this._pingInterval);
        }

        this._client = createClient({
            url: process.env.REDIS_URL,
            socket: { reconnectStrategy: 1000 },
        });

        (this._client as any).on('connect', () => {
            // console.log('REDIS SERVICE Connected to Redis!');
        });

        (this._client as any).on('error', (err) => {
            console.error('REDIS SERVICE Error'/*, { err }*/);
            if (
                (typeof err === 'string' && err.includes('connection')) ||
                (typeof err === 'object' &&
                    ['CONNECTION_BROKEN', 'NR_CLOSED', 'EADDRNOTAVAIL'].indexOf(
                        err.code,
                    ) > -1)
            ) {
                // console.log('Server stopped due to redis connection');
                process.exit(1);
            }
        });

        this._client.connect();

        this._pingInterval = setInterval(async () => {
            await this._client.ping();
        }, 30000);
    }

    async getSystemPromptData(campaignId: number) {
        return JSON.parse(await this.get(`${campaignId}${SYSTEM_PROMPT_DATA_KEY}`) as string);
    }

    async getHash(hashKey: string) {
        try {
            return this._client.hGetAll(hashKey as any);
        } catch (err) {
            console.error('REDIS SERVICE getHash Error'/*, { err }*/);
        }
    }

    async getHashField(hashKey: string, fieldName: string) {
        try {
            return this._client.hGet(hashKey as any, fieldName as any);
        } catch (err) {
            console.error('REDIS SERVICE getHashField Error'/*, { err }*/);
        }
    }

    async getHashFields(
        hashKey: string,
        fieldNames: string[],
    ): Promise<string[]> {
        try {
            return this._client.hmGet(hashKey as any, fieldNames as any);
        } catch (err) {
            console.error('REDIS SERVICE getHashFields Error'/*, { err }*/);
        }
    }

    async removeHashFields(hashKey: string, fieldNames: string) {
        try {
            return this._client.hDel(hashKey as any, fieldNames as any);
        } catch (err) {
            console.error('REDIS SERVICE removeHashFields Error'/*, { err }*/);
        }
    }

    async set(key: string, value: string, expiration?: number) {
        try {
            return this._client.set(
                key as any,
                value as any,
                { EX: expiration } as any,
            );
        } catch (err) {
            console.error('REDIS SERVICE set Error'/*, { err }*/);
        }
    }

    async get(key: string): Promise<any> {
        try {
            return this._client.get(key as any);
        } catch (err) {
            console.error('REDIS SERVICE get Error'/*, { err }*/);
        }
    }

    async mget(keys: string[]): Promise<any> {
        try {
            return this._client.mGet(keys as any);
        } catch (err) {
            console.error('REDIS SERVICE mget Error'/*, { err }*/);
        }
    }

    async remove(key: string) {
        try {
            return this._client.del(key as any);
        } catch (err) {
            console.error('REDIS SERVICE remove Error'/*, { err }*/);
        }
    }

    async setHashField(
        hashKey: string,
        fieldName: string,
        value: string,
        expireInSeconds?: number,
    ) {
        try {
            const response = await this._client.hSet(
                hashKey as any,
                fieldName as any,
                value as any,
            );

            if (expireInSeconds)
                await this._client.expire(hashKey as any, expireInSeconds as any);

            return response;
        } catch (err) {
            console.error('REDIS SERVICE setHashField Error', { err });
        }
    }

    async removeHashField(hashKey: string, fieldName: string) {
        try {
            return this._client.hDel(hashKey as any, fieldName as any);
        } catch (err) {
            console.error('REDIS SERVICE removeHashField Error', { err });
        }
    }

    async setHashFields(
        hashKey: string,
        values: { field: string; value: string }[],
        expireInSeconds?: number,
    ) {
        try {
            const valuesArr = [];
            for (const value of values) {
                valuesArr.push(value.field);
                valuesArr.push(value.value);
            }
            const response = await this._client.hSet(
                hashKey as any,
                valuesArr as any,
            );

            if (expireInSeconds)
                await this._client.expire(hashKey as any, expireInSeconds as any);

            return response;
        } catch (err) {
            console.error('REDIS SERVICE setHashFields Error', { err });
        }
    }

    async getHashValues(hashKey: string) {
        try {
            return this._client.hVals(hashKey as any);
        } catch (err) {
            console.error('REDIS SERVICE getHash Error', { err });
        }
    }

    async getHashKeys(hashKey: string): Promise<string[]> {
        try {
            return this._client.hKeys(hashKey as any);
        } catch (err) {
            console.error('REDIS SERVICE getHashKeys Error', { err });
        }
    }

    async setExpiry(key: string, expiration: number) {
        try {
            return this._client.expire(key as any, expiration as any);
        } catch (err) {
            console.error('REDIS SERVICE setExpiry Error', { err });
        }
    }
}
