import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { UUID_LIKE } from '../common/uuid-like.pipe';

const roleCodes = ['USER', 'APPROVER', 'ADMIN'] as const;
const statuses = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const;

export class InviteUserDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ minLength: 2, maxLength: 255 })
  @IsString() @MinLength(2) @MaxLength(255) displayName: string;
  @ApiProperty({ format: 'uuid' })
  @Matches(UUID_LIKE) departmentId: string;
  @ApiProperty({ enum: roleCodes, isArray: true, minItems: 1 })
  @IsArray() @ArrayMinSize(1) @IsIn(roleCodes, { each: true }) roles: Array<typeof roleCodes[number]>;
  @ApiPropertyOptional({ type: 'array', items: { type: 'string', format: 'uuid' }, default: [] })
  @IsArray() @Matches(UUID_LIKE, { each: true }) approverDepartmentIds: string[] = [];
}
export class CreateUserDto extends InviteUserDto {
  @ApiProperty({ format: 'password', writeOnly: true, minLength: 12 })
  @IsString() @MinLength(12) temporaryPassword: string;
}
export class UpdateUserStatusDto {
  @ApiProperty({ enum: statuses })
  @IsIn(statuses) status: typeof statuses[number];
}
export class UpdateUserAccessDto {
  @ApiProperty({ enum: roleCodes, isArray: true, minItems: 1 })
  @IsArray() @ArrayMinSize(1) @IsIn(roleCodes, { each: true }) roles: Array<typeof roleCodes[number]>;
  @ApiPropertyOptional({ type: 'array', items: { type: 'string', format: 'uuid' }, default: [] })
  @IsArray() @Matches(UUID_LIKE, { each: true }) approverDepartmentIds: string[] = [];
}
export class TransferUserDepartmentDto {
  @ApiProperty({ format: 'uuid' })
  @Matches(UUID_LIKE) departmentId: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt() @Min(1) @Max(2147483647) version: number;
}
