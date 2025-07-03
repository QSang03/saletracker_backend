// src/auth/interfaces/jwt-payload.interface.ts
export interface JwtUserPayload {
  id: number;
  username: string;
  role: string;
  departmentId?: number;
}
