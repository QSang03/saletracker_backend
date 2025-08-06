import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString({ message: 'Refresh token phải là chuỗi' })
  @IsNotEmpty({ message: 'Refresh token không được để trống' })
  @MinLength(10, { message: 'Refresh token không hợp lệ' })
  refreshToken: string;
}
