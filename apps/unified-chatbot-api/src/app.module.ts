import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VoiceModule } from "./voice/voice.module";
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import {customFormatter} from "./services/winston-log.service";

@Module({
  imports: [
      VoiceModule,
      WinstonModule.forRoot({
          transports: new winston.transports.Console({
              format: winston.format.combine(
                  winston.format(customFormatter)(),
                  winston.format.json()
              )
          })
      })
  ],
  controllers: [
      AppController
  ],
  providers: [
      AppService
  ]
  
})
export class AppModule {}
