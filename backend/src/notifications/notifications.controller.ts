import { Body,Controller,ForbiddenException,Get,Header,Param,Patch,Post,Query,UseGuards } from '@nestjs/common'; import { ApiBearerAuth,ApiOperation,ApiProperty,ApiQuery,ApiTags } from '@nestjs/swagger'; import { IsEmail } from 'class-validator'; import { JwtAuthGuard } from '../auth/jwt-auth.guard'; import type { AuthUser } from '../common/auth-user'; import { CurrentUser } from '../common/current-user.decorator'; import { UuidLikePipe } from '../common/uuid-like.pipe'; import { EmailTestService } from './email-test.service'; import { NotificationsService } from './notifications.service';
class TestEmailDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail() email: string;
}
@ApiTags('Notifications') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('notifications') export class NotificationsController{constructor(private readonly notifications:NotificationsService,private readonly email:EmailTestService){} @Get() @ApiQuery({name:'sortBy',required:false,enum:['createdAt','type','readAt']}) @ApiQuery({name:'sortOrder',required:false,enum:['asc','desc'],description:'Cần sortBy. Mặc định asc khi đã chọn cột.'}) @ApiQuery({name:'search',required:false,type:String,description:'Tìm trong thông báo của người nhận, tối đa 100 ký tự.'}) @ApiQuery({name:'type',required:false,enum:['REQUEST_SUBMITTED','REQUEST_SECOND_APPROVAL','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED','REQUEST_RECONCILIATION_REQUIRED','REQUEST_FAILED','ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED']}) list(@CurrentUser() user:AuthUser,@Query() query:Record<string,string>){return this.notifications.list(user.id,query)} @Patch('read-all') readAll(@CurrentUser() user:AuthUser){return this.notifications.markRead(user.id)} @Patch(':id/read') read(@CurrentUser() user:AuthUser,@Param('id',UuidLikePipe) id:string){return this.notifications.markRead(user.id,id)} @Get('status') async status(@CurrentUser() user:AuthUser){this.admin(user);return{smtpEnabled:process.env.SMTP_ENABLED==='true',queue:await this.notifications.stats()}} @Get('delivery-issues') issues(@CurrentUser()user:AuthUser,@Query()query:Record<string,string>){this.admin(user);return this.notifications.deliveryIssues(query)}
  @Get('delivery-issues/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Tra cứu lần gửi email theo mã thông báo' })
  deliveryDetail(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string) {
    this.admin(user);
    return this.notifications.deliveryDetail(id);
  }

  @Post('test-email') async test(@CurrentUser() user:AuthUser,@Body() body:TestEmailDto){this.admin(user);return this.email.send(user,body.email)} private admin(user:AuthUser){if(!user.roles.includes('ADMIN'))throw new ForbiddenException({code:'ADMIN_REQUIRED',message:'Chỉ Security Admin được thực hiện thao tác này.'})}}
