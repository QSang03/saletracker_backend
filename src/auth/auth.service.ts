import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../users/user.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { Role } from 'src/roles/role.entity';
import { RolePermission } from 'src/roles_permissions/roles-permissions.entity';
import { Permission } from 'src/permissions/permission.entity';
import { UserGateway } from 'src/users/user.gateway';
import { UserStatus } from '../users/user-status.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userGateway: UserGateway,
  ) {}

  async register(createUserDto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    return this.usersService.createUser({
      ...createUserDto,
      password: hashedPassword,
    });
  }

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
      username: updatedUser.username,
      fullName: updatedUser.fullName,
      email: updatedUser.email,
      status: updatedUser.status,
      roles: updatedUser.roles?.map((role) => role.name) || [],
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

    this.userGateway.server.to('admin_dashboard').emit('user_login', {
      userId: updatedUser.id,
      status: updatedUser.status,
      last_login: updatedUser.lastLogin,
    });

    return {
      access_token: this.jwtService.sign(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '7d',
      }),
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        status: updatedUser.status,
        isBlock: updatedUser.isBlock,
        roles: updatedUser.roles?.map((role) => role.name) || [],
      },
    };
  }

  async logout(user: any) {
    await this.usersService.updateUser(user.id, {
      status: UserStatus.INACTIVE,
    });

    this.userGateway.server.to('admin_dashboard').emit('user_logout', {
      userId: user.id,
      status: UserStatus.INACTIVE,
    });

    return { message: 'Đăng xuất thành công!' };
  }
}
