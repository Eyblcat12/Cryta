import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự.' })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8, { message: 'Mật khẩu hiện tại không hợp lệ.' })
  currentPassword: string;

  @IsString()
  @MinLength(12, { message: 'Mật khẩu mới phải có ít nhất 12 ký tự.' })
  newPassword: string;
}
