import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';
export const Permission = (departmentSlug: string, action: string) =>
  SetMetadata(PERMISSION_KEY, { departmentSlug, action });
