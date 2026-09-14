import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { AssetsService } from './assets.service';
@ApiTags('Assets') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('assets')
export class AssetsController { constructor(private readonly assets: AssetsService) {} @Get() @ApiOperation({summary:'Danh sách tài sản theo quyền và phạm vi'}) list(@CurrentUser() user:AuthUser){return this.assets.list(user)} @Get(':id') @ApiOperation({summary:'Chi tiết metadata tài sản; không bao giờ trả private key'}) detail(@CurrentUser() user:AuthUser,@Param('id',UuidLikePipe) id:string){return this.assets.detail(user,id)} }
