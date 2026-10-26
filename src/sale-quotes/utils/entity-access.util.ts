import { ForbiddenException } from '@nestjs/common';
import { getRoleNames } from '../../common/utils/user-permission.helper';

export function getUserRoleNames(user: any): string[] {
  return getRoleNames(user).map((role) => String(role).toLowerCase());
}

export function isAdminUser(user: any): boolean {
  return getUserRoleNames(user).includes('admin');
}

export function isViewOnlyUser(user: any): boolean {
  const roles = getUserRoleNames(user);
  return roles.includes('view') && !roles.includes('admin');
}

/**
 * Admin và role view được đọc toàn bộ dữ liệu; các role khác chỉ đọc dữ liệu
 * của mình (hoặc dữ liệu được chia sẻ).
 */
export function canReadAll(user: any): boolean {
  const roles = getUserRoleNames(user);
  return roles.includes('admin') || roles.includes('view');
}

export function assertCanMutate(user: any): void {
  if (isViewOnlyUser(user)) {
    throw new ForbiddenException(
      'Tài khoản role view chỉ có quyền xem dữ liệu',
    );
  }
}

export function assertOwnerOrAdmin(
  ownerId: number | null | undefined,
  user: any,
  message = 'Bạn không có quyền thao tác dữ liệu này',
): void {
  assertCanMutate(user);
  if (!isAdminUser(user) && Number(ownerId) !== Number(user?.id)) {
    throw new ForbiddenException(message);
  }
}

export function canReadOwnerResource(
  ownerId: number | null | undefined,
  user: any,
  isShared = false,
): boolean {
  if (canReadAll(user)) {
    return true;
  }
  if (isShared) {
    return true;
  }
  return Number(ownerId) === Number(user?.id);
}

export function getUserId(user: any): number {
  const id = Number(user?.id ?? user?.sub);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ForbiddenException('Không xác định được người dùng');
  }
  return id;
}
