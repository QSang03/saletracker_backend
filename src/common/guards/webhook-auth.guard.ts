import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class WebhookAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const masterKey =
      request.headers['x-master-key'] || request.headers['authorization'];

    // Fixed master key
    const expectedMasterKey = process.env.MASTER_KEY || '';

    if (!masterKey) {
      throw new UnauthorizedException('Master key is required');
    }

    // Support both "Bearer <key>" and direct key formats
    const cleanKey =
      typeof masterKey === 'string'
        ? masterKey.replace(/^Bearer\s+/i, '')
        : masterKey;

    if (cleanKey !== expectedMasterKey) {
      throw new UnauthorizedException('Invalid master key');
    }

    return true;
  }
}
