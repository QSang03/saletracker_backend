import { Request } from 'express';

export interface UserRoleObject {
  id?: number;
  name: string;
  rolePermissions?: Array<{
    permission?: { name: string };
  }>;
}

export interface UserPermissionObject {
  id?: number;
  name: string;
}

export interface AuthenticatedUser {
  id: number;
  sub?: number;
  username?: string;
  fullName?: string;
  email?: string;
  roles?: Array<string | UserRoleObject>;
  permissions?: Array<string | UserPermissionObject>;
  employeeCode?: string;
  [key: string]: unknown;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

