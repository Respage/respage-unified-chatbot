import { Module } from '@nestjs/common';
import { RespageUnifiedChatbotController } from './respage-unified-chatbot.controller';
import { RespageUnifiedChatbotService } from './respage-unified-chatbot.service';

@Module({
  imports: [],
  controllers: [RespageUnifiedChatbotController],
  providers: [RespageUnifiedChatbotService],
})
export class RespageUnifiedChatbotModule {}
