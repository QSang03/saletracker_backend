import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getHandler()
    );
    
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    
    if (!user || !Array.isArray(user.permissions)) {
      throw new ForbiddenException('Không có thông tin quyền truy cập');
    }

    const hasAllPermissions = required.every(perm => 
      user.permissions.includes(perm)
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException(
        `Bạn cần có quyền: ${required.join(', ')} để thực hiện hành động này`
      );
    }

    return true;
  }
}
