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
      }));
    } else {
      departments =
        updatedUser.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
        })) || [];
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
      departments, // Sử dụng biến departments đã xử lý ở trên
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
    await this.usersService.updateUser(updatedUser.id, {
      status: UserStatus.ACTIVE,
      refreshToken,
    });

    this.wsGateway.emitToAll('user_login', {
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
        departments,
      },
    };
  }

  async refreshToken({ refreshToken }: RefreshTokenDto) {
    try {
      // Verify refresh token
      const payload: any = this.jwtService.verify(refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          this.configService.get<string>('JWT_SECRET'),
      });

      // Load user with full details including roles, permissions AND refresh token
      const user = await this.usersService.findOneWithDetailsAndRefreshToken(
        payload.sub,
      );

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

      let departments: any;
      const isAdmin = user.roles?.some((role) => role.name === 'admin');
      if (isAdmin) {
        const allDepartments = await this.departmentService.findAllActive();
        departments = allDepartments.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
        }));
      } else {
        departments =
          user.departments?.map((d) => ({
            id: d.id,
            name: d.name,
            slug: d.slug,
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
        departments,
        server_ip,
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
      }));
    } else {
      departments =
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
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
      roles:
        user.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      departments,
      server_ip,
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
    let departments: any;
    const isAdmin = user.roles?.some((role) => role.name === 'admin');
    if (isAdmin) {
      const allDepartments = await this.departmentService.findAllActive();
      departments = allDepartments.map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
      }));
    } else {
      departments =
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
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
      roles:
        user.roles?.map((role) => ({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        })) || [],
      departments,
      server_ip,
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
}
