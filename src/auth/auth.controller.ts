import { RefreshTokenDto } from './dto/refresh-token.dto';
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
      zaloLinkStatus: user.zaloLinkStatus,
      zaloName: user.zaloName,
      avatarZalo: user.avatarZalo,
      permissions,
      departments:
        user.departments?.map((d) => ({
          id: d.id,
          name: d.name,
          slug: d.slug,
        })) || [],
      roles: user.roles?.map((r) => ({ id: r.id, name: r.name })),
      email: user.email,
    };
  }

  @Post('refresh')
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
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

  // Test endpoint để force refresh token
  @Post('test-force-refresh')
  @UseGuards(JwtAuthGuard)
  async testForceRefresh(@Req() req, @Body() body: { userId?: number }) {
    const user = req.user;
    const targetUserId = body.userId || user.id;

    console.log(
      '🔄 [Test Force Refresh] Simulating status=2 for user:',
      targetUserId,
    );

    // Giả lập update user status = 2 và trigger force refresh
    await this.authService.testForceRefresh(targetUserId);

    return {
      message: 'Force refresh triggered',
      targetUserId,
    };
  }

  // Test endpoint để kiểm tra refresh token trong database
  @Post('test-check-refresh-token')
  @UseGuards(JwtAuthGuard)
  async testCheckRefreshToken(@Req() req, @Body() body: { userId?: number }) {
    const user = req.user;
    const targetUserId = body.userId || user.id;

    console.log(
      '🔍 [Test Check Refresh Token] Checking for user:',
      targetUserId,
    );

    // Lấy user với refresh token từ database
    const userWithToken =
      await this.userService.findOneWithDetailsAndRefreshToken(targetUserId);

    if (!userWithToken) {
      return { error: 'User not found' };
    }

    return {
      userId: targetUserId,
      hasRefreshToken: !!userWithToken.refreshToken,
      refreshTokenLength: userWithToken.refreshToken?.length,
      refreshTokenPrefix: userWithToken.refreshToken?.substring(0, 50) + '...',
    };
  }
}
