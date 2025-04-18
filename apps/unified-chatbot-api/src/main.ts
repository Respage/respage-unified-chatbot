if (!process.env.NODE_ENV) {
  require('dotenv-extended').load({path: '.env'});
}

import * as winstonService from './services/winston-log.service';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {RespageWebSocketAdapter} from "./websocket/custom.adapter";

async function bootstrap() {
  winstonService.init();
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new RespageWebSocketAdapter(app));
  await app.listen(process.env.PORT || 4200);
  console.log("LISTING");
}
bootstrap();
