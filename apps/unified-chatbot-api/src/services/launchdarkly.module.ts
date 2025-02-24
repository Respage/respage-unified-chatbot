import {Global, Module} from '@nestjs/common';
import {LaunchDarklyService} from './launchdarkly.service';

@Global()
@Module({
    imports: [],
    controllers: [],
    providers: [
        LaunchDarklyService
    ],
    exports: [
        LaunchDarklyService
    ]
})
export class LaunchDarklyModule {}
