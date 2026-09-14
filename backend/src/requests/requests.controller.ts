import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { CreateRequestDto, DecideRequestDto } from './request.dto';
import { RequestsService } from './requests.service';

@ApiTags('Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách theo owner, approver scope hoặc toàn hệ thống' })
  list(@CurrentUser() user: AuthUser) { return this.requests.list(user); }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu theo quyền truy cập' })
  detail(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string) { return this.requests.detail(user, id); }

  @Post()
  @ApiOperation({ summary: 'Tạo yêu cầu cấp mới, gia hạn hoặc thu hồi' })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRequestDto) { return this.requests.create(user, body); }

  @Post(':id/decision')
  @ApiOperation({ summary: 'Phê duyệt hoặc từ chối với SoD và scope check' })
  decide(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() body: DecideRequestDto) { return this.requests.decide(user, id, body); }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Người tạo hủy yêu cầu đang chờ duyệt' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string) { return this.requests.cancel(user, id); }
}
