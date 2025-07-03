import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export type JwtPayload = {
  sub: number;
  username: string;
  full_name?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  status?: "active" | "inactive";
  permissions: string[];
  department?: string;
  lastLogin?: string;
  iat?: number;
  exp?: number;
  departmentId?: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not defined');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      username: payload.username,
      fullName: payload.full_name,
      email: payload.email,
      phone: payload.phone,
      avatar: payload.avatar,
      status: payload.status,
      permissions: payload.permissions,
      department: payload.department,
      lastLogin: payload.lastLogin,
      departmentId: payload.departmentId
    };
  }
}
