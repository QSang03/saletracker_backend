import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from '../users/user.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Role } from 'src/roles/role.entity';
import { RolePermission } from 'src/roles_permissions/roles-permissions.entity';
import { Permission } from 'src/permissions/permission.entity';
import { UserGateway } from 'src/users/user.gateway';
import { UserStatus } from '../users/user-status.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userGateway: UserGateway,
    private readonly eventEmitter: EventEmitter2,
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

    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Mật khẩu không chính xác');
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any) {
    await this.usersService.updateUser(user.id, {
      status: UserStatus.ACTIVE,
      lastLogin: true,
    });

    const updatedUser = await this.usersService.findOneWithDetails(user.id);
    if (!updatedUser) {
      throw new UnauthorizedException('User not found after update');
    }

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
      roles:
        updatedUser.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      departments:
        updatedUser.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
        })) || [],
      permissions: [
        ...updatedUser.roles?.flatMap(
          (role: Role) =>
            role.rolePermissions
              ?.filter((rp: RolePermission) => rp.isActive)
              .map((rp: RolePermission) => ({
                name: rp.permission.name,
                action: rp.permission.action,
              })) || [],
        ),
      ],
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
    // Lưu refresh token vào DB
    await this.usersService.updateUser(updatedUser.id, { refreshToken });

    this.userGateway.server.to('admin_dashboard').emit('user_login', {
      userId: updatedUser.id,
      status: updatedUser.status,
      last_login: updatedUser.lastLogin,
    });

    return {
      access_token: this.jwtService.sign(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '30d', // Cập nhật thành 30 ngày
      }),
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
      },
    };
  }

  async refreshToken({ refreshToken }: RefreshTokenDto) {
    try {
      console.log('🔍 [RefreshToken] Received refresh request:', {
        tokenExists: !!refreshToken,
        tokenLength: refreshToken?.length,
        tokenPrefix: refreshToken?.substring(0, 20) + '...',
      });

      // Verify refresh token
      const payload: any = this.jwtService.verify(refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          this.configService.get<string>('JWT_SECRET'),
      });

      console.log('🔍 [RefreshToken] Token verified, user ID:', payload.sub);

      // Load user with full details including roles, permissions AND refresh token
      const user = await this.usersService.findOneWithDetailsAndRefreshToken(
        payload.sub,
      );
      console.log('🔍 [RefreshToken] User found:', !!user);
      console.log(
        '🔍 [RefreshToken] User refresh token from DB length:',
        user?.refreshToken?.length,
      );
      console.log(
        '🔍 [RefreshToken] Sent refresh token length:',
        refreshToken?.length,
      );
      console.log(
        '🔍 [RefreshToken] User refresh token from DB prefix:',
        user?.refreshToken?.substring(0, 50) + '...',
      );
      console.log(
        '🔍 [RefreshToken] Sent refresh token prefix:',
        refreshToken?.substring(0, 50) + '...',
      );
      console.log(
        '🔍 [RefreshToken] User refresh token matches:',
        user?.refreshToken === refreshToken,
      );

      // Debug full tokens (chỉ cho testing)
      if (user?.refreshToken !== refreshToken) {
        console.log('🔍 [RefreshToken] DB Token full:', user?.refreshToken);
        console.log('🔍 [RefreshToken] Sent Token full:', refreshToken);
      }

      if (!user || user.refreshToken !== refreshToken) {
        console.error(
          '❌ [RefreshToken] Invalid refresh token - user not found or token mismatch',
        );
        throw new ForbiddenException('Invalid refresh token');
      }

      // Check if user is blocked
      if (user.isBlock) {
        console.error('❌ [RefreshToken] User is blocked');
        throw new ForbiddenException('User is blocked');
      }

      console.log('✅ [RefreshToken] Generating new tokens for user:', user.id);

      // Tạo access token mới với đầy đủ thông tin
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
        roles:
          user.roles?.map((role) => ({
            id: role.id,
            name: role.name,
            display_name: role.display_name,
          })) || [],
        departments:
          user.departments?.map((d) => ({
            id: d.id,
            name: d.name,
            slug: d.slug,
          })) || [],
        permissions: [
          ...user.roles?.flatMap(
            (role: Role) =>
              role.rolePermissions
                ?.filter((rp: RolePermission) => rp.isActive)
                .map((rp: RolePermission) => ({
                  name: rp.permission.name,
                  action: rp.permission.action,
                })) || [],
          ),
        ],
        lastLogin: user.lastLogin,
      };

      const accessToken = this.jwtService.sign(accessPayload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '30d',
      });

      // Tạo refresh token mới để tăng bảo mật
      const newRefreshToken = this.jwtService.sign(
        { sub: user.id },
        {
          secret:
            this.configService.get<string>('JWT_REFRESH_SECRET') ||
            this.configService.get<string>('JWT_SECRET'),
          expiresIn: '30d',
        },
      );

      // Cập nhật refresh token mới vào DB
      await this.usersService.updateUser(user.id, {
        refreshToken: newRefreshToken,
      });

      return {
        access_token: accessToken,
        refresh_token: newRefreshToken,
      };
    } catch (e) {
      console.error('Refresh token error:', e);
      throw new ForbiddenException('Invalid refresh token');
    }
  }

  // Logout method - clear refresh token
  async logout(user: any) {
    await this.usersService.updateUser(user.id, { refreshToken: undefined });
    return { message: 'Logged out successfully' };
  }

  // Generate new tokens method
  async generateNewTokens(user: any) {
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
      roles:
        user.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      departments:
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
        })) || [],
      permissions: [
        ...user.roles?.flatMap(
          (role: Role) =>
            role.rolePermissions
              ?.filter((rp: RolePermission) => rp.isActive)
              .map((rp: RolePermission) => ({
                name: rp.permission.name,
                action: rp.permission.action,
              })) || [],
        ),
      ],
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
      roles:
        user.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      departments:
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
        })) || [],
      permissions: [
        ...user.roles?.flatMap(
          (role: Role) =>
            role.rolePermissions
              ?.filter((rp: RolePermission) => rp.isActive)
              .map((rp: RolePermission) => ({
                name: rp.permission.name,
                action: rp.permission.action,
              })) || [],
        ),
      ],
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

  // Test method để trigger force refresh
  async testForceRefresh(userId: number) {
    try {
      console.log(
        '🔄 [TestForceRefresh] Triggering force refresh for user:',
        userId,
      );

      // Lấy user với full details
      const user =
        await this.usersService.findOneWithDetailsAndRefreshToken(userId);
      if (!user) {
        throw new Error('User not found');
      }

      console.log(
        '✅ [TestForceRefresh] User found, emitting status change event',
      );

      // CHỈ emit event để trigger force refresh trên frontend
      // KHÔNG tạo refresh token mới để tránh mismatch
      this.eventEmitter.emit('user.status.changed', {
        userId: user.id,
        newStatus: 2, // Giả lập status = 2 (Zalo link error)
        oldStatus: Number(user.status), // Convert enum to number
      });

      return {
        success: true,
        message:
          'Force refresh triggered - frontend will refresh with existing token',
      };
    } catch (error) {
      console.error('❌ [TestForceRefresh] Error:', error);
      throw error;
    }
  }
}
