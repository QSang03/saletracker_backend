import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Thiếu header Authorization');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Định dạng token không hợp lệ');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET')
      });
      request['user'] = payload;
      return true;
    } catch (err) {
      console.error('[AUTH] Token verification error:', err);

      if (err.name === 'TokenExpiredError') {
        console.error(`[AUTH] Token expired at ${err.expiredAt}`);
        throw new UnauthorizedException('Token đã hết hạn');
      }

      if (err.name === 'JsonWebTokenError') {
        console.error('[AUTH] Malformed token');
        throw new UnauthorizedException('Token không hợp lệ');
      }

      throw new UnauthorizedException('Lỗi xác thực không xác định');
    }
  }
}
