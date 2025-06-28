import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthGuard } from '../common/guards/auth.guard';
import { UserModule } from '../users/user.module';
import { Permission } from '../permissions/permission.entity';
import { PermissionModule } from '../permissions/permission.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Permission]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
        global: true
      }),
      inject: [ConfigService],
    }),
    ConfigModule,
    PermissionModule,
    forwardRef(() => UserModule),
  ],
  providers: [
    AuthService, 
    JwtStrategy,
    AuthGuard,
    JwtAuthGuard,
    ConfigService,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    AuthGuard,
    JwtModule,
    JwtAuthGuard,
  ],
})
export class AuthModule {}
