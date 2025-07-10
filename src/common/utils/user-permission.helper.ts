// Helper functions to extract roles, permissions, employeeCode from user payload
// Support both string[] and object[]

export function getRoleNames(user: any): string[] {
  if (!user) return [];
  if (Array.isArray(user.roles)) {
    if (typeof user.roles[0] === 'string') return user.roles;
    if (typeof user.roles[0] === 'object' && user.roles[0] !== null) {
      return user.roles.map((r: any) => r.name).filter(Boolean);
    }
  }
  return [];
}

export function getPermissions(user: any): string[] {
  if (!user) return [];
  if (Array.isArray(user.permissions)) {
    if (typeof user.permissions[0] === 'string') return user.permissions;
    if (typeof user.permissions[0] === 'object' && user.permissions[0] !== null) {
      return user.permissions.map((p: any) => p.name).filter(Boolean);
    }
  }
  // Có thể permissions nằm trong roles
  if (Array.isArray(user.roles)) {
    let perms: string[] = [];
    for (const role of user.roles) {
      if (role && Array.isArray(role.rolePermissions)) {
        perms.push(...role.rolePermissions.map((rp: any) => rp.permission?.name).filter(Boolean));
      }
    }
    return perms;
  }
  return [];
}

export function getEmployeeCode(user: any): string {
  return user?.employeeCode || '';
}
