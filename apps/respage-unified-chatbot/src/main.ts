import { NestFactory } from '@nestjs/core';
import { RespageUnifiedChatbotModule } from './respage-unified-chatbot.module';

async function bootstrap() {
  const app = await NestFactory.create(RespageUnifiedChatbotModule);
  await app.listen(3000);
}
bootstrap();
