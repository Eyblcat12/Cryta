import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UUID_LIKE } from '../common/uuid-like.pipe';

export class CreateRequestDto {
  @ApiProperty({ enum: ['CREATE', 'RENEW', 'REVOKE'] })
  @IsIn(['CREATE', 'RENEW', 'REVOKE'])
  type: 'CREATE' | 'RENEW' | 'REVOKE';

  @ApiPropertyOptional({ format: 'uuid', description: 'Bắt buộc với RENEW hoặc REVOKE. Bỏ qua với CREATE.' })
  @ValidateIf((dto: CreateRequestDto) => dto.type !== 'CREATE')
  @Matches(UUID_LIKE, { message: 'Tài sản mục tiêu không hợp lệ.' })
  targetAssetId?: string;

  @ApiProperty({ format: 'uuid' })
  @Matches(UUID_LIKE, { message: 'Phiên bản policy không hợp lệ.' })
  policyVersionId: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10, { message: 'Lý do nghiệp vụ phải có ít nhất 10 ký tự.' })
  reason: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  emergency?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Tham số theo phiên bản policy. Bỏ qua hoặc gửi {} với REVOKE.' })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export class DecideRequestDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ minLength: 10, description: 'Bắt buộc khi từ chối yêu cầu.' })
  @ValidateIf((dto: DecideRequestDto) => dto.decision === 'REJECTED')
  @IsString()
  @MinLength(10, { message: 'Lý do từ chối phải có ít nhất 10 ký tự.' })
  comment?: string;

  @ApiPropertyOptional({ type: String, description: 'Phiên bản của yêu cầu vừa đọc, gửi ở dạng chuỗi.' })
  @IsOptional()
  @IsString()
  version?: string;
}

export class SaveDraftDto {
  @ApiProperty({ enum: ['CREATE', 'RENEW', 'REVOKE'] })
  @IsIn(['CREATE', 'RENEW', 'REVOKE'])
  type: CreateRequestDto['type'];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Matches(UUID_LIKE)
  targetAssetId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Matches(UUID_LIKE)
  policyVersionId?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emergency?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 2_147_483_647, description: 'Bỏ qua khi tạo lần đầu. Gửi khi chỉnh nháp đã lưu.' })
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  version?: number;
}

export class SubmitDraftDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  version: number;
}

export class CancelRequestDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  version?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
