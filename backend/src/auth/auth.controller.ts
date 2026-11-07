import { Body, Controller, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth-cookie';
import { ChangePasswordDto, LoginDto } from './auth.dto';
import { AuthService } from './auth.service';
import { AccountActionsService } from './account-actions.service';
import { CompleteAccountActionDto, RequestPasswordResetDto } from './account-actions.dto';
import { AllowPasswordChange, JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('Authentication') @Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly actions: AccountActionsService) {}

  @Get('account-actions') @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Kiểm tra môi trường có bật mời tài khoản và đặt lại mật khẩu qua email' })
  accountActions() { return { enabled: this.actions.enabled }; }

  @Post('password-reset') @HttpCode(202) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Tiếp nhận yêu cầu đặt lại mật khẩu mà không tiết lộ tài khoản tồn tại' })
  requestReset(@Body() body: RequestPasswordResetDto) { return this.actions.requestReset(body.email); }

  @Post('password-reset/complete') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Đặt mật khẩu mới bằng token một lần từ email' })
  completeReset(@Body() body: CompleteAccountActionDto) {
    return this.actions.complete('PASSWORD_RESET', body.token, body.newPassword);
  }

  @Post('invitation/accept') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Kích hoạt tài khoản bằng token một lần từ email mời' })
  acceptInvitation(@Body() body: CompleteAccountActionDto) {
    return this.actions.complete('INVITATION', body.token, body.newPassword);
  }
  @Post('login') @HttpCode(200) @ApiOperation({ summary: 'Đăng nhập và tạo phiên refresh token bảo mật' })
  async login(@Body() body: LoginDto,@Req() req: Request,@Res({passthrough:true}) res: Response) { const result=await this.auth.login(body.email,body.password,{ipAddress:req.ip,userAgent:req.headers['user-agent']}); setRefreshCookie(res,result.refreshToken); const {refreshToken:_,...safe}=result; return safe; }
  @Post('refresh') @HttpCode(200) @ApiOperation({ summary: 'Xoay vòng refresh token và cấp access token mới' })
  @ApiCookieAuth('refreshCookie')
  async refresh(@Req() req: Request,@Res({passthrough:true}) res: Response) { const result=await this.auth.refresh(readRefreshCookie(req),{ipAddress:req.ip,userAgent:req.headers['user-agent']}); setRefreshCookie(res,result.refreshToken); const {refreshToken:_,...safe}=result; return safe; }
  @Post('logout') @HttpCode(200) @UseGuards(JwtAuthGuard) @ApiBearerAuth() @ApiOperation({ summary: 'Thu hồi phiên hiện tại' })
  @AllowPasswordChange()
  async logout(@CurrentUser() user: AuthUser,@Req() req: Request,@Res({passthrough:true}) res: Response) { const result=await this.auth.logout(readRefreshCookie(req),user.id); clearRefreshCookie(res); return result; }
  @Get('me') @AllowPasswordChange() @UseGuards(JwtAuthGuard) @ApiBearerAuth() @ApiOperation({ summary: 'Lấy danh tính, vai trò và phạm vi hiện tại' }) me(@CurrentUser() user: AuthUser) { return user; }
  @Post('change-password') @HttpCode(200) @UseGuards(JwtAuthGuard) @ApiBearerAuth() @ApiOperation({summary:'Đổi mật khẩu và thu hồi toàn bộ phiên'})
  @AllowPasswordChange()
  async changePassword(@CurrentUser()user:AuthUser,@Body()body:ChangePasswordDto,@Res({passthrough:true})res:Response){const result=await this.auth.changePassword(user.id,body.currentPassword,body.newPassword);clearRefreshCookie(res);return result}
}
