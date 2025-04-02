import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class TestApiAuthGuard implements CanActivate {
  constructor() {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      throw new UnauthorizedException('Missing or invalid authentication');
    }

    // Extract and decode credentials from Basic auth header
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');
    console.log('username', username);
    console.log('password', password);
    // Get expected credentials from environment variables
    const expectedUsername = process.env.TESTING_API_USER;
    const expectedPassword = process.env.TESTING_API_PASSWORD;

    if (!expectedUsername || !expectedPassword) {
      throw new UnauthorizedException('Authentication configuration error');
    }

    // Validate credentials
    if (username === expectedUsername && password === expectedPassword) {
      return true;
    }

    throw new UnauthorizedException('Invalid credentials');
  }
}