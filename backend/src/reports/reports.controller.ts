import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsUUID, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { reportDatasets, reportFilters, reportFormats, type ReportDataset, type ReportFormat } from './report-data.service';
import { ReportsService } from './reports.service';

class ReportDatasetDto {
  @ApiProperty({ enum: [...reportDatasets] }) @IsIn(reportDatasets)
  dataset!: ReportDataset;
}

class ReportPreviewDto extends ReportDatasetDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @ValidateIf((_body, value) => value !== undefined) @IsObject()
  filters?: Record<string, unknown>;
}

class CreateReportDto extends ReportPreviewDto {
  @ApiProperty({ enum: [...reportFormats] }) @IsIn(reportFormats)
  format!: ReportFormat;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4')
  requestKey!: string;
}

@ApiTags('Reports') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('preview') @HttpCode(200) @Header('Cache-Control', 'no-store')
  preview(@CurrentUser() user: AuthUser, @Body() dto: ReportPreviewDto) {
    return this.reports.preview(user, dto.dataset, reportFilters(dto.dataset, dto.filters));
  }

  @Post() @HttpCode(202) @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reports.enqueue(user, dto.dataset, dto.format, reportFilters(dto.dataset, dto.filters), dto.requestKey);
  }

  @Get() @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser, @Query() query: ReportDatasetDto) {
    return this.reports.list(user, query.dataset);
  }

  @Post(':id/cancel') @HttpCode(200) @Header('Cache-Control', 'no-store')
  cancel(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.reports.cancel(user, id);
  }

  @Get(':id/file')
  @ApiOkResponse({ description: 'Tệp báo cáo theo quyền hiện tại của người tạo.', content: {
    'text/csv': { schema: { type: 'string', format: 'binary' } },
    'application/pdf': { schema: { type: 'string', format: 'binary' } },
  } })
  async download(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() res: Response) {
    const { content, dataset, format } = await this.reports.download(user, id);
    const extension = format.toLowerCase();
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/pdf',
      'Content-Disposition': `attachment; filename="crypta-${dataset.toLowerCase()}-${id}.${extension}"`,
      'X-Content-Type-Options': 'nosniff',
    }).send(content);
  }
}
