import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { mfaChallengePattern } from './mfa.service';

class MfaChallengeDto {
  @ApiProperty({ writeOnly: true, minLength: 43, maxLength: 43 })
  @IsString() @Length(43, 43) @Matches(mfaChallengePattern)
  challenge: string;
}

export class MfaTotpDto extends MfaChallengeDto {
  @ApiProperty({ writeOnly: true, minLength: 6, maxLength: 6 })
  @IsString() @Length(6, 6) @Matches(/^[0-9]{6}$/)
  totpCode: string;
}

export class MfaRecoveryDto extends MfaChallengeDto {
  @ApiProperty({ writeOnly: true, maxLength: 80 })
  @IsString() @MinLength(1) @MaxLength(80)
  recoveryCode: string;
}

export class MfaEnrollmentAckDto extends MfaChallengeDto {
  @ApiProperty({ enum: [true] })
  @Equals(true)
  savedRecoveryCodes: true;
}

export class MfaStepUpDto {
  @ApiPropertyOptional({ writeOnly: true, format: 'password', description: 'Bắt buộc với tài khoản cục bộ' })
  @IsOptional() @IsString() @MinLength(8) @MaxLength(255)
  currentPassword?: string;

  @ApiProperty({ writeOnly: true, minLength: 6, maxLength: 6 })
  @IsString() @Length(6, 6) @Matches(/^[0-9]{6}$/)
  totpCode: string;

  @ApiProperty({ enum: ['CODES', 'REPLACE'] })
  @IsIn(['CODES', 'REPLACE'])
  purpose: 'CODES' | 'REPLACE';
}
