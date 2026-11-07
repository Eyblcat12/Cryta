import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';

export const AllowPasswordChange = () => SetMetadata('allowPasswordChange', true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Bạn cần đăng nhập để tiếp tục.' });
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tokenVersion: number; mfaVerified?: boolean }>(token);
      const user = await this.auth.getUserById(payload.sub);
      if (payload.tokenVersion !== user.tokenVersion) {
        throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi.' });
      }
      if (user.mfaRequired && payload.mfaVerified !== true) {
        throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: 'Hãy đăng nhập lại để xác thực hai bước.' });
      }
      request.user = user;
      if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>('allowPasswordChange', [context.getHandler(), context.getClass()])) {
        throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Bạn cần đổi mật khẩu tạm trước khi sử dụng chức năng này.' });
      }
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException({ code: 'TOKEN_INVALID', message: 'Access token không hợp lệ hoặc đã hết hạn.' });
    }
  }
}
