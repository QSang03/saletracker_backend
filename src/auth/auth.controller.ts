import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Controller, Post, Body, UseGuards, Req, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserService } from '../users/user.service';
import { DepartmentService } from 'src/departments/department.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly departmentService: DepartmentService,
  ) {}

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

    let departments: any;
    const isAdmin = user.roles?.some((role) => role.name === 'admin');

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

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      nickName: user.nickName,
      status: user.status,
      isBlock: user.isBlock,
      employeeCode: user.employeeCode,
      zaloLinkStatus: user.zaloLinkStatus,
      zaloName: user.zaloName,
      avatarZalo: user.avatarZalo,
      permissions,
      departments,
      server_ip,
      roles: user.roles?.map((r) => ({ id: r.id, name: r.name })),
      email: user.email,
    };
  }

  @Post('refresh')
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    try {
      console.log('🔍 [AuthController] Refresh token request received');
      console.log('🔍 [AuthController] Request body keys:', Object.keys(refreshTokenDto));
      
      const result = await this.authService.refreshToken(refreshTokenDto);
      
      console.log('✅ [AuthController] Refresh token successful');
      console.log('🔍 [AuthController] Response keys:', Object.keys(result || {}));
      console.log('🔍 [AuthController] Has access_token:', !!result?.access_token);
      console.log('🔍 [AuthController] Has refresh_token:', !!result?.refresh_token);
      
      return result;
    } catch (error) {
      console.error('❌ [AuthController] Refresh token failed:', error.message);
      console.error('❌ [AuthController] Error stack:', error.stack?.substring(0, 200));
      throw error; // Re-throw to let NestJS handle the response
    }
  }

  @Post('refresh-after-update')
  @UseGuards(JwtAuthGuard)
  async refreshAfterUpdate(@Req() req) {
    // Tạo chỉ access token mới với thông tin user mới nhất, giữ nguyên refresh token
    const user = await this.userService.findOneWithDetails(req.user.id);
    if (!user) {
      throw new Error('User not found');
    }
    return this.authService.generateNewAccessToken(user);
  }
}
