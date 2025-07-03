import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from 'src/users/user.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly userService: UserService) {
    super();
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const can = await super.canActivate(context);
    if (!can) return false;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const dbUser = await this.userService.findOne(user.id);
    if (!dbUser || dbUser.isBlock) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    return true;
  }

  handleRequest(err, user, info) {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token đã hết hạn');
      }
      throw new UnauthorizedException('Token không hợp lệ');
    }
    return user;
  }
}
