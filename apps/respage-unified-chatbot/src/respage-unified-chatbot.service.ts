import { Injectable } from '@nestjs/common';

@Injectable()
export class RespageUnifiedChatbotService {
  getHello(): string {
    return 'Hello World!';
  }
}
