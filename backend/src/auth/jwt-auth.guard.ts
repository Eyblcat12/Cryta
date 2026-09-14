import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Bạn cần đăng nhập để tiếp tục.' });
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tokenVersion: number }>(token);
      const user = await this.auth.getUserById(payload.sub);
      if (payload.tokenVersion !== user.tokenVersion) {
        throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi.' });
      }
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException({ code: 'TOKEN_INVALID', message: 'Access token không hợp lệ hoặc đã hết hạn.' });
    }
  }
}
