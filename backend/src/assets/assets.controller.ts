import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery,ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { AssetsService } from './assets.service';
@ApiTags('Assets') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('assets')
export class AssetsController { constructor(private readonly assets: AssetsService) {} @Get() @ApiQuery({name:'sortBy',required:false,enum:['expiresAt','createdAt','code','status','type']}) @ApiQuery({name:'sortOrder',required:false,enum:['asc','desc'],description:'Cần sortBy. Mặc định asc khi đã chọn cột.'}) @ApiOperation({summary:'Danh sách tài sản theo quyền và phạm vi; page/pageSize trả kết quả phân trang'}) @ApiQuery({name:'ownedOnly',required:false,enum:['true','false'],description:'true: chỉ tài sản của owner trong phiên, áp dụng trước count/pagination; không truyền hoặc false giữ scope theo quyền đã cấp.'}) list(@CurrentUser() user:AuthUser,@Query() query:Record<string,string>){return this.assets.list(user,query)} @Get(':id/history') history(@CurrentUser()user:AuthUser,@Param('id',UuidLikePipe)id:string,@Query()query:Record<string,string>){return this.assets.history(user,id,query)} @Get(':id') @ApiOperation({summary:'Chi tiết metadata tài sản; không bao giờ trả private key'}) detail(@CurrentUser() user:AuthUser,@Param('id',UuidLikePipe) id:string){return this.assets.detail(user,id)} }
