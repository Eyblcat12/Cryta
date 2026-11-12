import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { DepartmentStatusDto, SaveDepartmentDto } from './departments.dto';
import { DepartmentsService } from './departments.service';

@ApiTags('Department administration') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) { return this.departments.list(user, query); }
  @Get(':id') detail(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string) { return this.departments.detail(user, id); }
  @Put(':id') save(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() body: SaveDepartmentDto) { return this.departments.save(user, id, body); }
  @Patch(':id/status') status(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() body: DepartmentStatusDto) { return this.departments.status(user, id, body); }
}
