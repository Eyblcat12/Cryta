import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const deliveryOutcomes = ['ACCEPTED', 'UNSENT'] as const;

export class EmailReconciliationDto {
  @ApiProperty({ enum: deliveryOutcomes })
  @IsIn(deliveryOutcomes) outcome: typeof deliveryOutcomes[number];

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_147_483_647 })
  @IsInt() @Min(0) @Max(2_147_483_647) attemptCount: number;

  @ApiProperty({ minLength: 4, maxLength: 64 })
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{3,63}$/) evidenceReference: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Thời điểm SMTP chấp nhận theo bằng chứng, dạng UTC có hậu tố Z.' })
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  acceptedAt?: string;
}

export class EmailRetryDto extends PickType(EmailReconciliationDto, ['attemptCount', 'evidenceReference'] as const) {}
