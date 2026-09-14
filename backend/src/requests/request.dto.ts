import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { UUID_LIKE } from '../common/uuid-like.pipe';

export class CreateRequestDto {
  @IsIn(['CREATE', 'RENEW', 'REVOKE'])
  type: 'CREATE' | 'RENEW' | 'REVOKE';

  @ValidateIf((dto: CreateRequestDto) => dto.type !== 'CREATE')
  @Matches(UUID_LIKE, { message: 'Tài sản mục tiêu không hợp lệ.' })
  targetAssetId?: string;

  @Matches(UUID_LIKE, { message: 'Phiên bản policy không hợp lệ.' })
  policyVersionId: string;

  @IsString()
  @MinLength(10, { message: 'Lý do nghiệp vụ phải có ít nhất 10 ký tự.' })
  reason: string;

  @IsOptional()
  @IsBoolean()
  emergency?: boolean;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export class DecideRequestDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @ValidateIf((dto: DecideRequestDto) => dto.decision === 'REJECTED')
  @IsString()
  @MinLength(10, { message: 'Lý do từ chối phải có ít nhất 10 ký tự.' })
  comment?: string;

  @IsOptional()
  @IsString()
  version?: string;
}
