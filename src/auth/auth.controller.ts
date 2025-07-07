import { Controller, Post, Body, UseGuards, Req, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserService } from '../users/user.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(
      loginDto.username,
      loginDto.password,
    );
    return this.authService.login(user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req) {
    return this.authService.logout(req.user);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req) {
    const user = await this.userService.findOneWithDetails(req.user.id);
    if (!user) return null;

    // Trả về cả name và action cho mỗi permission
    const permissions = user.roles.flatMap((role) =>
      role.rolePermissions
        .filter((rp) => rp.isActive)
        .map((rp) => ({
          name: rp.permission.name,
          action: rp.permission.action,
        })),
    );

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      nickName: user.nickName,
      status: user.status,
      isBlock: user.isBlock,
      employeeCode: user.employeeCode,
      permissions,
      departments:
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
        })) || [],
      roles: user.roles?.map((r) => ({ id: r.id, name: r.name })),
      // Nếu không cần các trường dưới, có thể bỏ để nhẹ hơn:
      email: user.email,
      // lastLogin: user.lastLogin,
      // createdAt: user.createdAt,
      // updatedAt: user.updatedAt,
    };
  }
}
