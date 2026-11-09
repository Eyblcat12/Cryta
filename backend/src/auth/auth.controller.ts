import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { corsOrigins } from '../common/deployment-config';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth-cookie';
import { ChangePasswordDto, LoginDto } from './auth.dto';
import { AuthService } from './auth.service';
import { AccountActionsService } from './account-actions.service';
import { CompleteAccountActionDto, RequestPasswordResetDto } from './account-actions.dto';
import { AllowPasswordChange, JwtAuthGuard, type OidcRequest } from './jwt-auth.guard';
import { MfaEnrollmentAckDto, MfaRecoveryDto, MfaStepUpDto, MfaTotpDto } from './mfa.dto';

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
  @Post('login') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Xác thực mật khẩu và bắt đầu MFA nếu tài khoản yêu cầu' })
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({passthrough:true}) res: Response) {
    const result = await this.auth.login(body.email, body.password, this.sessionContext(req));
    if ('mfa' in result) { clearRefreshCookie(res); return result; }
    return this.sessionResponse(res, result);
  }

  @Post('mfa/verify') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Xác minh TOTP và cấp phiên MFA' })
  async verifyMfa(@Body() body: MfaTotpDto, @Req() req: Request, @Res({passthrough:true}) res: Response) {
    return this.sessionResponse(res, await this.auth.verifyMfaLogin(body.challenge, body.totpCode, this.sessionContext(req)));
  }

  @Post('mfa/recover') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Dùng mã khôi phục một lần để bắt đầu thiết lập ứng dụng mới' })
  recoverMfa(@Body() body: MfaRecoveryDto) { return this.auth.recoverMfa(body.challenge, body.recoveryCode); }

  @Post('mfa/enrollment/verify') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Xác minh ứng dụng mới và cấp bộ mã khôi phục' })
  verifyMfaEnrollment(@Body() body: MfaTotpDto) { return this.auth.verifyMfaEnrollment(body.challenge, body.totpCode); }

  @Post('mfa/enrollment/finish') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Kích hoạt ứng dụng và tạo phiên sau khi người dùng lưu mã khôi phục' })
  async finishMfaEnrollment(@Body() body: MfaEnrollmentAckDto, @Req() req: Request, @Res({passthrough:true}) res: Response) {
    return this.sessionResponse(res, await this.auth.finishMfaEnrollment(body.challenge, this.sessionContext(req)));
  }

  @Get('mfa/status') @Header('Cache-Control', 'no-store') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem số mã khôi phục chưa dùng của tài khoản hiện tại' })
  mfaStatus(@CurrentUser() user: AuthUser) { return this.auth.mfaStatus(user); }

  @Post('mfa/step-up') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Xác nhận mật khẩu và TOTP trước khi thay yếu tố hoặc cấp lại mã' })
  stepUpMfa(@CurrentUser() user: AuthUser, @Body() body: MfaStepUpDto, @Req() req: OidcRequest) {
    return this.auth.stepUpMfa(user, body.currentPassword, body.totpCode, body.purpose, req.oidcSessionId);
  }
  @Post('refresh') @HttpCode(200) @ApiOperation({ summary: 'Xoay vòng refresh token và cấp access token mới' })
  @ApiCookieAuth('refreshCookie')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    const { origin } = req.headers;
    // CORS limits response access. Check the origin before a cookie can rotate a session.
    if (token && origin !== undefined && !corsOrigins().includes(origin)) {
      throw new ForbiddenException({ code: 'REFRESH_ORIGIN_DENIED', message: 'Nguồn yêu cầu làm mới phiên không được phép.' });
    }
    return this.sessionResponse(res, await this.auth.refresh(token, this.sessionContext(req)));
  }
  @Post('logout') @HttpCode(200) @UseGuards(JwtAuthGuard) @ApiBearerAuth() @ApiOperation({ summary: 'Thu hồi phiên hiện tại' })
  @AllowPasswordChange()
  async logout(@CurrentUser() user: AuthUser,@Req() req: OidcRequest,@Res({passthrough:true}) res: Response) { const result=await this.auth.logout(readRefreshCookie(req),user.id,req.oidcSessionId); clearRefreshCookie(res); return result; }
  @Get('me') @AllowPasswordChange() @UseGuards(JwtAuthGuard) @ApiBearerAuth() @ApiOperation({ summary: 'Lấy danh tính, vai trò và phạm vi hiện tại' }) me(@CurrentUser() user: AuthUser) { return user; }
  @Post('change-password') @HttpCode(200) @UseGuards(JwtAuthGuard) @ApiBearerAuth() @ApiOperation({summary:'Đổi mật khẩu và thu hồi toàn bộ phiên'})
  @AllowPasswordChange()
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    if (user.signInMethod === 'SSO') throw new ForbiddenException({ code: 'OIDC_PASSWORD_MANAGED', message: 'Hãy đổi mật khẩu trong hệ thống danh tính của tổ chức.' });
    const result = await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    clearRefreshCookie(res);
    return result;
  }

  private sessionContext(req: Request) { return { ipAddress: req.ip, userAgent: req.headers['user-agent'] }; }

  private sessionResponse<T extends { refreshToken: string }>(res: Response, result: T) {
    const { refreshToken, ...safe } = result;
    setRefreshCookie(res, refreshToken);
    return safe;
  }
}
