import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './permission.decorator';

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
    const userRoles: string[] = user.roles?.map((r) => r.name) || [];
    // Tạo role cần kiểm tra, ví dụ: manager-cong-no, user-cong-no
    const requiredRoles = [
      `manager-${departmentSlug}`,
      `user-${departmentSlug}`,
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
    const isAdmin =
      Array.isArray(user.roles) &&
      user.roles.some(
        (r: any) => (typeof r === 'string' ? r : r.name) === 'admin',
      );
    if (isAdmin) return true;
    if (!hasRole || !hasPermission) {
      throw new ForbiddenException(
        `Bạn không có quyền ${action} cho phòng ban ${departmentSlug}`,
      );
    }
    return true;
  }
}
