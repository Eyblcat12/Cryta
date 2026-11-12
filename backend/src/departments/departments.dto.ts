import { IsBoolean, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveDepartmentDto {
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_-]{0,49}$' })
  @IsString() @Matches(/^[A-Z][A-Z0-9_-]{0,49}$/) code: string;
  @ApiProperty({ minLength: 2, maxLength: 255 })
  @IsString() @MinLength(2) @MaxLength(255) name: string;
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(2147483647) version?: number;
}
export class DepartmentStatusDto {
  @ApiProperty()
  @IsBoolean() active: boolean;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt() @Min(1) @Max(2147483647) version: number;
}
