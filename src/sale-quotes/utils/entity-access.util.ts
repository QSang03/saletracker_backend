import { ForbiddenException } from '@nestjs/common';
import { getRoleNames } from '../../common/utils/user-permission.helper';
import { AuthenticatedUser } from '../types/auth-user.type';

export { AuthenticatedUser, AuthenticatedRequest } from '../types/auth-user.type';

export function getUserRoleNames(
  user: AuthenticatedUser | undefined | null,
): string[] {
  return getRoleNames(user).map((role) => String(role).toLowerCase());
}

export function isAdminUser(
  user: AuthenticatedUser | undefined | null,
): boolean {
  return getUserRoleNames(user).includes('admin');
}

export function isViewOnlyUser(
  user: AuthenticatedUser | undefined | null,
): boolean {
  const roles = getUserRoleNames(user);
  return roles.includes('view') && !roles.includes('admin');
}

/**
 * Admin và role view được đọc toàn bộ dữ liệu; các role khác chỉ đọc dữ liệu
 * của mình (hoặc dữ liệu được chia sẻ).
 */
export function canReadAll(
  user: AuthenticatedUser | undefined | null,
): boolean {
  const roles = getUserRoleNames(user);
  return roles.includes('admin') || roles.includes('view');
}

export function assertCanMutate(
  user: AuthenticatedUser | undefined | null,
): void {
  if (isViewOnlyUser(user)) {
    throw new ForbiddenException(
      'Tài khoản role view chỉ có quyền xem dữ liệu',
    );
  }
}

export function assertOwnerOrAdmin(
  ownerId: number | null | undefined,
  user: AuthenticatedUser | undefined | null,
  message = 'Bạn không có quyền thao tác dữ liệu này',
): void {
  assertCanMutate(user);
  if (!isAdminUser(user) && Number(ownerId) !== Number(user?.id)) {
    throw new ForbiddenException(message);
  }
}

export function canReadOwnerResource(
  ownerId: number | null | undefined,
  user: AuthenticatedUser | undefined | null,
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

export function getUserId(user: AuthenticatedUser | undefined | null): number {
  const id = Number(user?.id ?? user?.sub);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ForbiddenException('Không xác định được người dùng');
  }
  return id;
}
