import * as fs from 'fs';
import * as path from 'path';
import {Logger} from 'winston';
import {Body, Controller, Get, Inject, Post, Res, UseGuards} from '@nestjs/common';
import {Response} from 'express';
import { AppService } from './app.service';
import { TestApiAuthGuard } from './guards/test-api-auth.guard';
import { TestingService } from './services/testing.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

@Controller()
export class AppController {
  constructor(
      private readonly appService: AppService,
      private readonly testingService: TestingService,
      @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger
  ) {}

  @Get()
  root(@Res() res: Response) {
    res.status(404).send();
  }

  @Get('/test')
  testPage(@Res() res: Response) {
    res.status(200).send(fs.readFileSync(path.join(__dirname, 'client', 'test.html'), 'utf8'));        
  }
  
  @Get('/test/authenticate')
  @UseGuards(TestApiAuthGuard)
  async testAuthenticate(@Res() res: Response) {
    res.status(200).send();
  }

  @Post('/test')
  @UseGuards(TestApiAuthGuard)
  async testApi(@Res() res: Response, @Body() body: { campaign_id: number, statements: string[], phone: string, iterations: number, to_number: string }) {
    try {
      console.log(body);
      const response = await this.testingService.generateConversation(body.campaign_id, body.statements, body.iterations, body.to_number, body.phone)
      res.status(200).send(response);
    } catch (e) {
      this.logger.error("Error in testApi", {error: e});
      res.status(500).send({error: e.message});
    }
  }

  @Get('/v1/health')
  healthCheck(@Res() res: Response) {
    res.status(200).send();
  }
}
