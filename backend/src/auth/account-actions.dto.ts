import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ACCOUNT_ACTION_TOKEN_PATTERN } from './account-action-token';
import { NewPasswordDto } from './auth.dto';

export class RequestPasswordResetDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email: string;
}

export class CompleteAccountActionDto extends NewPasswordDto {
  @ApiProperty({ writeOnly: true, pattern: ACCOUNT_ACTION_TOKEN_PATTERN.source, description: 'Mã một lần từ liên kết email.' })
  @IsString()
  @Matches(ACCOUNT_ACTION_TOKEN_PATTERN, { message: 'Liên kết không hợp lệ hoặc đã hết hạn.' })
  token: string;
}
