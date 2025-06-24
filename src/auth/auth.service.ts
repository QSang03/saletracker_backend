import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { RoleService } from '../role/role.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly jwtService: JwtService,
    private readonly roleService: RoleService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findByUsername(username);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { sub: user.id, username: user.username };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(dto: RegisterDto) {
    const { username, password, roleIds } = dto;

    const existingUser = await this.usersService.findByUsername(username);
    if (existingUser) {
      throw new ConflictException('Tên đăng nhập đã tồn tại');
    }

    const hashed = await bcrypt.hash(password, 10);

    const roles = await this.roleService.findByIds(roleIds); // ✅ dùng đúng biến
    if (roles.length === 0) throw new BadRequestException('Role không hợp lệ');

    const newUser = await this.usersService.create({
      username,
      password: hashed,
      roles,
    });

    const payload = { sub: newUser.id, username: newUser.username };
    return {
      access_token: this.jwtService.sign(payload),
      user: newUser,
    };
  }
}
