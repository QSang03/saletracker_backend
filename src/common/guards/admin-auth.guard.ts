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
    const roleNames = getRoleNames(user);
    
    // Kiểm tra role "view" - không cho phép truy cập admin functions
    if (roleNames.includes('view')) {
      throw new ForbiddenException('Role view không có quyền truy cập chức năng admin');
    }
    
    if (!roleNames.includes('admin')) {
      throw new ForbiddenException('Bạn không có quyền admin');
    }

    return true;
  }
}
