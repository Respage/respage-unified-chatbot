import {Controller, Get, Req, Res} from '@nestjs/common';
import {Request, Response} from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
      private readonly appService: AppService,
  ) {}

  @Get()
  root(@Res() res: Response) {
    res.status(404).send();
  }
}

