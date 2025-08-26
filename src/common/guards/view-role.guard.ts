import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { getRoleNames } from '../utils/user-permission.helper';

@Injectable()
export class ViewRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('Bạn chưa đăng nhập');
    }

    // Kiểm tra role "view" - không cho phép truy cập
    const roleNames = getRoleNames(user);
    if (roleNames.includes('view')) {
      throw new ForbiddenException('Role view không có quyền truy cập chức năng này');
    }

    return true;
  }
}
