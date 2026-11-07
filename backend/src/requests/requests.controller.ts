import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery,ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { CancelRequestDto, CreateRequestDto, DecideRequestDto, SaveDraftDto, SubmitDraftDto } from './request.dto';
import { RequestsService } from './requests.service';

@ApiTags('Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách theo owner, approver scope hoặc toàn hệ thống' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['submittedAt','updatedAt','status','type','emergency'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc','desc'], description: 'Cần sortBy. Mặc định asc khi đã chọn cột. ID cùng chiều phân định các dòng bằng nhau.' })
  @ApiQuery({name:'createdByMe',required:false,enum:['true','false'],description:'true: chỉ yêu cầu do user của phiên tạo, áp dụng trước count/pagination; không truyền hoặc false giữ scope theo quyền đã cấp.'})
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) { return this.requests.list(user, query); }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu theo quyền truy cập' })
  detail(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string) { return this.requests.detail(user, id); }

  @Post()
  @ApiOperation({ summary: 'Tạo yêu cầu cấp mới, gia hạn hoặc thu hồi' })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRequestDto) { return this.requests.create(user, body); }

  @Put('drafts/:id')
  @ApiOperation({ summary: 'Lưu hoặc sửa nháp của người tạo' })
  saveDraft(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() body: SaveDraftDto) {
    return this.requests.saveDraft(user, id, body);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Gửi nháp của người tạo vào hàng duyệt' })
  submit(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() body: SubmitDraftDto) {
    return this.requests.submitDraft(user, id, body.version);
  }

  @Post(':id/decision')
  @ApiOperation({ summary: 'Phê duyệt hoặc từ chối với SoD và scope check' })
  decide(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() body: DecideRequestDto) { return this.requests.decide(user, id, body); }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Người tạo hủy nháp hoặc yêu cầu đang chờ duyệt' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() body: CancelRequestDto) {
    return this.requests.cancel(user, id, body);
  }
}
