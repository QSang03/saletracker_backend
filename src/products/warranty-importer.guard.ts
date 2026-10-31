import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { WarrantyImportService } from './warranty-import.service';
import { getRoleNames } from '../common/utils/user-permission.helper';

/**
 * Guard cho POST /products/import-warranty.
 *
 * Cho phép:
 *  - role admin (luôn luôn), hoặc
 *  - user nằm trong danh sách admin chỉ định riêng
 *    (bảng product_warranty_importers, quản lý qua
 *    GET/POST/DELETE /products/warranty-importers).
 *
 * Cần đặt SAU AuthGuard để request.user đã được giải từ JWT.
 */
@Injectable()
export class WarrantyImporterGuard implements CanActivate {
  constructor(private readonly warrantyImportService: WarrantyImportService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Chỉ cần shape tối thiểu mà AuthGuard gắn vào request sau khi giải JWT.
    const request = context.switchToHttp().getRequest<{
      user?: { id?: number };
    }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Bạn chưa đăng nhập');
    }

    const roleNames = getRoleNames(user).map((role) =>
      String(role).toLowerCase(),
    );
    if (roleNames.includes('admin')) return true;

    const allowed = await this.warrantyImportService.isImporter(user.id);
    if (allowed) return true;

    throw new ForbiddenException(
      'Chỉ admin hoặc người được admin chỉ định mới được nạp file thời gian bảo hành',
    );
  }
}
