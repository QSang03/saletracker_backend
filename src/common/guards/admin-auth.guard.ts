import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRoleNames } from '../utils/user-permission.helper';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('Bạn chưa đăng nhập');
    }

    // Chuẩn hóa lấy role name từ user payload
    if (!getRoleNames(user).includes('admin')) {
      throw new ForbiddenException('Bạn không có quyền admin');
    }

    return true;
  }
}
