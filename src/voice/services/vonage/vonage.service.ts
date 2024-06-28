import { Injectable } from '@nestjs/common';
import { Auth } from '@vonage/auth';
import {Vonage} from "@vonage/server-sdk";

@Injectable()
export class VonageService {
    private credentials: Auth;
    private vonage: Vonage

    constructor() {}

    async onModuleInit() {
        this.credentials = new Auth({
            applicationId: process.env.VONAGE_APPLICATION_ID,
            apiKey: process.env.VONAGE_API_KEY,
            apiSecret: process.env.VONAGE_API_SECRET,
            privateKey: process.env.VONAGE_PRIVATE_KEY.replace(/\\n/g, '\n')
        });

        this.vonage = new Vonage(this.credentials);
    }
}
