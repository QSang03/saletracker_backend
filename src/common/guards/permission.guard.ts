import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './permission.decorator';
import { getRoleNames, hasPMRole } from '../utils/user-permission.helper';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { departmentSlug, action } =
      this.reflector.get<{ departmentSlug: string; action: string }>(
        PERMISSION_KEY,
        context.getHandler(),
      ) || {};
    if (!departmentSlug || !action) return true; // Không cấu hình thì bỏ qua

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('User not found');

    // Lấy tất cả roles của user (giả sử user.roles là mảng role name)
      const userRoles: string[] = getRoleNames(user);
    // Tạo role cần kiểm tra, ví dụ: manager-cong-no, user-cong-no, pm-cong-no
    const requiredRoles = [
      `manager-${departmentSlug}`,
      `user-${departmentSlug}`,
      `pm-${departmentSlug}`,
      // Có thể mở rộng thêm các role khác nếu cần
    ];
    // Lấy tất cả permissions của user (giả sử user.permissions là mảng object { name, action })
    const userPermissions = user.permissions || [];
    // Kiểm tra user có role phù hợp không
    const hasRole = userRoles.some((role) => requiredRoles.includes(role));
    // Kiểm tra user có permission phù hợp không
    const hasPermission = userPermissions.some(
      (p) => p.name === departmentSlug && p.action === action,
    );
    // Debug log để kiểm tra user.roles và user.permissions
    // Nếu user có role admin thì cho phép tất cả
      const isAdmin = userRoles.some((r) => String(r).toLowerCase() === 'admin');
      if (isAdmin) return true;

    // Nếu user có role PM thì cho phép truy cập
      const isPM = hasPMRole(user) || userRoles.some((r) => {
        const v = String(r).toLowerCase();
        return v === 'pm' || v.startsWith('pm-');
      });
      if (isPM) return true;
    if (!hasRole || !hasPermission) {
      throw new ForbiddenException(
        `Bạn không có quyền ${action} cho phòng ban ${departmentSlug}`,
      );
    }
    return true;
  }
}
