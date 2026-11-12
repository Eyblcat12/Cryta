import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email: string;

  @ApiProperty({ format: 'password', writeOnly: true, minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự.' })
  password: string;
}

export class NewPasswordDto {
  @ApiProperty({ format: 'password', writeOnly: true, minLength: 12, maxLength: 64,
    description: 'Gồm chữ hoa, chữ thường, số và ký tự đặc biệt.' })
  @IsString()
  @MinLength(12, { message: 'Mật khẩu mới phải có ít nhất 12 ký tự.' })
  @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, { message: 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt.' })
  newPassword: string;
}

export class ChangePasswordDto extends NewPasswordDto {
  @ApiProperty({ format: 'password', writeOnly: true, minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Mật khẩu hiện tại không hợp lệ.' })
  currentPassword: string;
}
