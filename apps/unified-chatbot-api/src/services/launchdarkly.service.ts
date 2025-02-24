import {Injectable} from "@nestjs/common";
import {LDClient, init} from "@launchdarkly/node-server-sdk";
import {FeatureFlag} from "../models/feature_flag_enum";

const USER = {key: process.env.LAUNCH_DARKLY_USERNAME || 'unified-chatbot'};

enum CampaignVariationTypes {
    All= 'all',
    None = 'none'
}

@Injectable()
export class LaunchDarklyService {
    _client: LDClient;
    _isInitialized: boolean;

    constructor() {
        if (process.env.LAUNCH_DARKLY_SDK_KEY) {
            this._client = init(process.env.LAUNCH_DARKLY_SDK_KEY);
        }

        if (!this._client) {
            throw new Error('Unable to initialize LaunchDarkly client');
        }

        this._client.waitForInitialization()
            .then(() => {
                this._isInitialized = true;
                return this._client.identify(USER);
            });
    }

    async isFeatureFlagEnabled(featureFlag: FeatureFlag, campaignId = null) {
        if (!this._isInitialized) {
            console.log('launchdarkly initialize() not called');
            return false;
        }

        if (!Object.values(FeatureFlag).includes(featureFlag)) throw new Error(`Feature Flag ${featureFlag} not found`);

        const state = this._client && await this._client.variation(featureFlag, USER, false);

        if (campaignId === null) return state;

        if (typeof state !== 'string') return false;

        if (!isNaN(campaignId)) {
            campaignId = +campaignId;
        }

        switch (state) {
            case CampaignVariationTypes.All:
                return true;
            case CampaignVariationTypes.None:
                return false;
            default:
                if (Array.isArray(campaignId)) {
                    return campaignId.length ? campaignId.every(campaign => state.split(',').map(Number).includes(+campaign)) : false;
                }
                return state.split(',').map(Number).includes(campaignId);
        }
    }
}
