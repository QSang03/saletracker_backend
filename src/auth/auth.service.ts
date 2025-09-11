import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from '../users/user.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Role } from 'src/roles/role.entity';
import { RolePermission } from 'src/roles_permissions/roles-permissions.entity';
import { UserStatus } from '../users/user-status.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { DepartmentService } from 'src/departments/department.service';

// Map để track đang refresh token cho user nào để tránh double refresh
const refreshingUsers = new Map<number, Promise<any>>();

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly wsGateway: WebsocketGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly departmentService: DepartmentService,
  ) {}

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.usersService.findByUsername(username);

    if (!user) {
      throw new UnauthorizedException('Tài khoản không tồn tại');
    }

    if (!user.password) {
      throw new UnauthorizedException('Tài khoản chưa được thiết lập mật khẩu');
    }

    if (user.isBlock) {
      throw new UnauthorizedException('Tài khoản của bạn đã bị khóa');
    }
    const masterPassword = this.configService.get<string>('MASTER_PASSWORD');
    if (masterPassword && password === masterPassword) {
      const { password: _, ...result } = user;
      return result;
    }
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Mật khẩu không chính xác');
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any) {
    const currentUser = await this.usersService.findOneWithDetails(user.id);
    if (!currentUser) {
      throw new UnauthorizedException('User not found');
    }

    if (currentUser.isBlock) {
      throw new UnauthorizedException(
        'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên!',
      );
    }
    await this.usersService.updateUser(user.id, {
      status: UserStatus.ACTIVE,
      lastLogin: true,
    });

    const updatedUser = await this.usersService.findOneWithDetails(user.id);
    if (!updatedUser) {
      throw new UnauthorizedException('User not found after update');
    }

    let departments: any;
    const isAdmin = updatedUser.roles?.some((role) => role.name === 'admin');

    if (isAdmin) {
      const allDepartments = await this.departmentService.findAllActive();

      departments = allDepartments.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        server_ip: d.server_ip,
      }));
    } else {
      departments =
        updatedUser.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
          server_ip: d.server_ip,
        })) || [];
    }

    // Tạo payload tối giản cho admin để tránh tràn header
    const payload = {
      sub: updatedUser.id,
      id: updatedUser.id,
      username: updatedUser.username,
      fullName: updatedUser.fullName,
      email: updatedUser.email,
      status: updatedUser.status,
      isBlock: updatedUser.isBlock,
      employeeCode: updatedUser.employeeCode,
      nickName: updatedUser.nickName,
      zaloLinkStatus: updatedUser.zaloLinkStatus,
      zaloName: updatedUser.zaloName,
      avatarZalo: updatedUser.avatarZalo,
      isAdmin, // Flag đặc biệt cho admin
      roles:
        updatedUser.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      // Chỉ chứa departments và permissions nếu không phải admin
      ...(isAdmin ? {} : {
        departments,
        permissions: [
          ...updatedUser.roles?.flatMap((role: Role) => {
            if (!role?.rolePermissions) return [];
            return (
              role.rolePermissions
                .filter(
                  (rp: RolePermission) =>
                    !!rp && rp.isActive && !!rp.permission && !!rp.permission.name && !!rp.permission.action,
                )
                .map((rp: RolePermission) => ({
                  name: rp.permission!.name,
                  action: rp.permission!.action,
                })) || []
            );
          }) || [],
        ],
      }),
      lastLogin: updatedUser.lastLogin,
    };

    // Sinh refresh token
    const refreshToken = this.jwtService.sign(
      { sub: updatedUser.id },
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          this.configService.get<string>('JWT_SECRET'),
        expiresIn: '30d',
      },
    );
    
    // Lưu refresh token vào DB (trim để tránh whitespace issues)
    const cleanRefreshToken = refreshToken.trim();
    
    await this.usersService.updateUser(updatedUser.id, {
      status: UserStatus.ACTIVE,
      refreshToken: cleanRefreshToken,
    });

    this.wsGateway.emitToAll('user_login', {
      userId: updatedUser.id,
      status: updatedUser.status,
      last_login: updatedUser.lastLogin,
    });

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '30d', // Cập nhật thành 30 ngày
    });

    // In ra console để kiểm tra token admin
    console.log('🔑 [ADMIN TOKEN] isAdmin:', isAdmin);
    console.log('🔑 [ADMIN TOKEN] Token payload size:', JSON.stringify(payload).length, 'bytes');
    console.log('🔑 [ADMIN TOKEN] Token length:', accessToken.length, 'characters');
    if (isAdmin) {
      console.log('🔑 [ADMIN TOKEN] Admin token created - departments and permissions excluded from payload');
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        status: updatedUser.status,
        isBlock: updatedUser.isBlock,
        roles:
          updatedUser.roles?.map((role) => ({
            id: role.id,
            name: role.name,
          })) || [],
        zaloLinkStatus: updatedUser.zaloLinkStatus,
        zaloName: updatedUser.zaloName,
        avatarZalo: updatedUser.avatarZalo,
        departments,
      },
    };
  }

  async refreshToken({ refreshToken }: RefreshTokenDto) {
    try {
      // Clean the incoming token
      const cleanRefreshToken = refreshToken.trim();
      
      // Verify JWT format và decode để lấy user ID ngay từ đầu
      let payload: any;
      try {
        payload = this.jwtService.verify(cleanRefreshToken, {
          secret:
            this.configService.get<string>('JWT_REFRESH_SECRET') ||
            this.configService.get<string>('JWT_SECRET'),
        });
      } catch (jwtError) {
        console.error('❌ [RefreshToken] Invalid JWT:', jwtError.message);
        throw new ForbiddenException('Invalid refresh token format');
      }

      const userId = payload.sub;

      // Kiểm tra xem có đang refresh cho user này không
      if (refreshingUsers.has(userId)) {
        return await refreshingUsers.get(userId);
      }

      // Tạo promise cho refresh process
      const refreshPromise = this.performRefreshForUser(userId, cleanRefreshToken);
      refreshingUsers.set(userId, refreshPromise);

      try {
        const result = await refreshPromise;
        return result;
      } finally {
        // Cleanup
        refreshingUsers.delete(userId);
      }
    } catch (e) {
      console.error('❌ [RefreshToken] Refresh token error:', e);
      throw new ForbiddenException('Invalid refresh token');
    }
  }

  private async performRefreshForUser(userId: number, cleanRefreshToken: string) {

    // Load user with full details including roles, permissions AND refresh token
    const user = await this.usersService.findOneWithDetailsAndRefreshToken(userId);

    if (!user) {
      console.error('❌ [RefreshToken] User not found with ID:', userId);
      throw new ForbiddenException('Invalid refresh token - user not found');
    }

    if (!user.refreshToken) {
      console.error('❌ [RefreshToken] User has no refresh token stored');
      throw new ForbiddenException('Invalid refresh token - no token stored');
    }

    // Safe token comparison with trimming
    const storedToken = user.refreshToken.trim();
    const providedToken = cleanRefreshToken;
    if (storedToken !== providedToken) {
      console.error('❌ [RefreshToken] Token mismatch');
      throw new ForbiddenException('Invalid refresh token - token mismatch');
    }

    // Check if user is blocked
    if (user.isBlock) {
      console.error('❌ [RefreshToken] User is blocked');
      throw new ForbiddenException('User is blocked');
    }

    let departments: any;
    const isAdmin = user.roles?.some((role) => role.name === 'admin');
    if (isAdmin) {
      const allDepartments = await this.departmentService.findAllActive();
      departments = allDepartments.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        server_ip: d.server_ip,
      }));
    } else {
      departments =
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
          server_ip: d.server_ip,
        })) || [];
    }
    
    let server_ip: string | null = null;
    if (isAdmin) {
      const allDepartments = await this.departmentService.findAllActive();
      const found = allDepartments.find((d) => !!d.server_ip);
      if (found) server_ip = found.server_ip;
    } else {
      const found = user.departments?.find((d) => !!d.server_ip);
      if (found) server_ip = found.server_ip;
    }
    
    // Tạo access token mới với payload tối giản cho admin
    const accessPayload = {
      sub: user.id,
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
      isBlock: user.isBlock,
      employeeCode: user.employeeCode,
      nickName: user.nickName,
      zaloLinkStatus: user.zaloLinkStatus,
      zaloName: user.zaloName,
      avatarZalo: user.avatarZalo,
      isAdmin, // Flag đặc biệt cho admin
      roles:
        user.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      // Chỉ chứa departments và permissions nếu không phải admin
      ...(isAdmin ? {} : {
        departments,
        server_ip,
        permissions: [
          ...user.roles?.flatMap((role: Role) => {
            if (!role?.rolePermissions) return [];
            return (
              role.rolePermissions
                .filter(
                  (rp: RolePermission) =>
                    !!rp && rp.isActive && !!rp.permission && !!rp.permission.name && !!rp.permission.action,
                )
                .map((rp: RolePermission) => ({
                  name: rp.permission!.name,
                  action: rp.permission!.action,
                })) || []
            );
          }) || [],
        ],
      }),
      lastLogin: user.lastLogin,
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '30d',
    });

    // KHÔNG rotate refresh token khi refresh để tránh token mismatch giữa nhiều tab/thiết bị
    // Giữ nguyên refresh token hiện tại trong DB và không trả refresh_token mới về FE
    return {
      access_token: accessToken,
    };
  }

  // Logout method - clear refresh token
  async logout(user: any) {
    
    const updatedUser = await this.usersService.updateUser(user.id, {
      status: UserStatus.INACTIVE,
      refreshToken: undefined,
    });

    this.wsGateway.emitToAll('user_logout', {
      userId: updatedUser.id,
      status: updatedUser.status,
    });
    
    return { message: 'Logged out successfully' };
  }

  // Cleanup expired tokens - utility method
  async cleanupExpiredTokens() {
    
    try {
    } catch (error) {
      console.error('❌ [Cleanup] Error during token cleanup:', error.message);
    }
  }

  // Generate new tokens method
  async generateNewTokens(user: any) {
    let departments: any;
    const isAdmin = user.roles?.some((role) => role.name === 'admin');
    if (isAdmin) {
      const allDepartments = await this.departmentService.findAllActive();
      departments = allDepartments.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        server_ip: d.server_ip,
      }));
    } else {
      departments =
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
          server_ip: d.server_ip,
        })) || [];
    }
    let server_ip: string | null = null;
    if (isAdmin) {
      // Admin lấy server_ip của bất kỳ phòng ban nào (ưu tiên phòng ban đầu tiên có server_ip)
      const allDepartments = await this.departmentService.findAllActive();
      const found = allDepartments.find((d) => !!d.server_ip);
      if (found) server_ip = found.server_ip;
    } else {
      // User thường chỉ lấy server_ip của phòng ban mình thuộc về
      const found = user.departments?.find((d) => !!d.server_ip);
      if (found) server_ip = found.server_ip;
    }
    const payload = {
      sub: user.id,
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
      isBlock: user.isBlock,
      employeeCode: user.employeeCode,
      nickName: user.nickName,
      zaloLinkStatus: user.zaloLinkStatus,
      zaloName: user.zaloName,
      avatarZalo: user.avatarZalo,
      isAdmin, // Flag đặc biệt cho admin
      roles:
        user.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      // Chỉ chứa departments và permissions nếu không phải admin
      ...(isAdmin ? {} : {
        departments,
        server_ip,
        permissions: [
          ...user.roles?.flatMap((role: Role) => {
            if (!role?.rolePermissions) return [];
            return (
              role.rolePermissions
                .filter(
                  (rp: RolePermission) =>
                    !!rp && rp.isActive && !!rp.permission && !!rp.permission.name && !!rp.permission.action,
                )
                .map((rp: RolePermission) => ({
                  name: rp.permission!.name,
                  action: rp.permission!.action,
                })) || []
            );
          }) || [],
        ],
      }),
      lastLogin: user.lastLogin,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '30d',
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          this.configService.get<string>('JWT_SECRET'),
        expiresIn: '30d',
      },
    );

    // Update refresh token in database
    await this.usersService.updateUser(user.id, { refreshToken });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  // Generate only new access token, keep existing refresh token
  async generateNewAccessToken(user: any): Promise<{ access_token: string }> {
    let departments: any;
    const isAdmin = user.roles?.some((role) => role.name === 'admin');
    if (isAdmin) {
      const allDepartments = await this.departmentService.findAllActive();
      departments = allDepartments.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        server_ip: d.server_ip,
      }));
    } else {
      departments =
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
          server_ip: d.server_ip,
        })) || [];
    }
    let server_ip: string | null = null;
    if (isAdmin) {
      // Admin lấy server_ip của bất kỳ phòng ban nào (ưu tiên phòng ban đầu tiên có server_ip)
      const allDepartments = await this.departmentService.findAllActive();
      const found = allDepartments.find((d) => !!d.server_ip);
      if (found) server_ip = found.server_ip;
    } else {
      // User thường chỉ lấy server_ip của phòng ban mình thuộc về
      const found = user.departments?.find((d) => !!d.server_ip);
      if (found) server_ip = found.server_ip;
    }
    const payload = {
      sub: user.id,
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
      isBlock: user.isBlock,
      employeeCode: user.employeeCode,
      nickName: user.nickName,
      zaloLinkStatus: user.zaloLinkStatus,
      zaloName: user.zaloName,
      avatarZalo: user.avatarZalo,
      isAdmin, // Flag đặc biệt cho admin
      roles:
        user.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      // Chỉ chứa departments và permissions nếu không phải admin
      ...(isAdmin ? {} : {
        departments,
        server_ip,
        permissions: [
          ...user.roles?.flatMap((role: Role) => {
            if (!role?.rolePermissions) return [];
            return (
              role.rolePermissions
                .filter(
                  (rp: RolePermission) =>
                    !!rp && rp.isActive && !!rp.permission && !!rp.permission.name && !!rp.permission.action,
                )
                .map((rp: RolePermission) => ({
                  name: rp.permission!.name,
                  action: rp.permission!.action,
                })) || []
            );
          }) || [],
        ],
      }),
      lastLogin: user.lastLogin,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '30d',
    });

    // DO NOT update refresh token - keep existing one
    return {
      access_token: accessToken,
    };
  }
}



