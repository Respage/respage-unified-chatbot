import { Test, TestingModule } from '@nestjs/testing';
import { RespageUnifiedChatbotController } from './respage-unified-chatbot.controller';
import { RespageUnifiedChatbotService } from './respage-unified-chatbot.service';

describe('RespageUnifiedChatbotController', () => {
  let respageUnifiedChatbotController: RespageUnifiedChatbotController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RespageUnifiedChatbotController],
      providers: [RespageUnifiedChatbotService],
    }).compile();

    respageUnifiedChatbotController = app.get<RespageUnifiedChatbotController>(RespageUnifiedChatbotController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(respageUnifiedChatbotController.getHello()).toBe('Hello World!');
    });
  });
});
