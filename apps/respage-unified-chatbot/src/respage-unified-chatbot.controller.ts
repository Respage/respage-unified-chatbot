import { Controller, Get } from '@nestjs/common';
import { RespageUnifiedChatbotService } from './respage-unified-chatbot.service';

@Controller()
export class RespageUnifiedChatbotController {
  constructor(private readonly respageUnifiedChatbotService: RespageUnifiedChatbotService) {}

  @Get()
  getHello(): string {
    return this.respageUnifiedChatbotService.getHello();
  }
}
