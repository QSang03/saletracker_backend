import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { User } from '../users/user.entity';
import { Role } from '../roles/role.entity';
import { Permission } from '../permissions/permission.entity';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,

    private readonly jwtService: JwtService,
  ) {}

  async validateUser(username: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { username },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user) throw new UnauthorizedException('Không tìm thấy tài khoản');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new UnauthorizedException('Sai mật khẩu');

    return user;
  }

  async login(user: User) {
    let permissions: string[];

    if (user.username === 'admin') {
      const allPermissions = await this.permissionRepo.find();
      permissions = allPermissions.map((p) => p.action);
    } else {
      permissions = user.roles.flatMap((role) =>
        role.permissions.map((perm) => perm.action),
      );
    }

    const payload = {
      sub: user.id,
      username: user.username,
      permissions: [...new Set(permissions)],
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        permissions: [...new Set(permissions)],
      },
    };
  }

  async register(dto: RegisterDto) {
    const { username, password, roleIds } = dto;

    const existing = await this.userRepo.findOne({ where: { username } });
    if (existing) throw new BadRequestException('Username đã tồn tại');

    const roles = await this.userRepo.manager.getRepository(Role).find({
      where: { id: In(roleIds) },
      relations: ['permissions'],
    });

    const hashed = await bcrypt.hash(password, 10);

    const user = this.userRepo.create({
      username,
      password: hashed,
      roles,
    });

    await this.userRepo.save(user);

    return {
      message: 'Đăng ký thành công',
      user: {
        id: user.id,
        username: user.username,
        roles: user.roles.map((r) => r.name),
      },
    };
  }
}
