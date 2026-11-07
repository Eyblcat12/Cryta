import { Controller, ForbiddenException, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { clearRefreshCookie, setRefreshCookie } from './auth-cookie';
import { AuthService } from './auth.service';
import { OidcService, oidcDenied } from './oidc.service';

const token = '[A-Za-z0-9_-]{43}';
const cookieValue = new RegExp(`^${token}(?:\\.${token})?$`);
const responseFields = new Set(['state', 'code', 'iss', 'session_state', 'error', 'error_description', 'error_uri']);

@Controller('auth/oidc')
export class OidcController {
  constructor(private readonly oidc: OidcService, private readonly auth: AuthService) {}

  @Get('status') @Header('Cache-Control', 'no-store')
  status() { return { enabled: Boolean(this.oidc.options) }; }

  @Post('start') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async start(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireOrigin(req);
    const { redirect, browser } = await this.oidc.start();
    res.cookie(this.cookieName(), browser, { ...this.cookieOptions(), maxAge: 300_000 });
    return { redirect };
  }

  @Post('callback') @HttpCode(303)
  async callback(@Req() req: Request, @Res() res: Response) {
    let result = 'denied';
    const [browser, existingHandoff] = this.cookie(req)?.split('.') ?? [];
    if (browser && !existingHandoff) {
      try {
        const form = readForm(req, responseFields, 4096);
        const ticket = await this.oidc.callback(form, browser);
        res.cookie(this.cookieName(), `${browser}.${ticket}`, { ...this.cookieOptions(), maxAge: 120_000 });
        result = 'complete';
      } catch { /* Send a fixed failure outcome and keep provider details off the wire. */ }
    }
    res.set('Cache-Control', 'no-store').redirect(303, `/login?oidc=${result}`);
  }

  @Post('finish') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async finish(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireOrigin(req);
    const [browser, ticket] = this.cookie(req)?.split('.') ?? [];
    res.clearCookie(this.cookieName(), this.cookieOptions());
    if (!browser || !ticket) throw oidcDenied();
    const identity = await this.oidc.finish(ticket, browser);
    const result = await this.auth.loginOidc(identity, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    if ('mfa' in result) {
      clearRefreshCookie(res);
      return result;
    }
    const { refreshToken, ...safe } = result;
    setRefreshCookie(res, refreshToken);
    return safe;
  }

  @Post('backchannel') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async backchannel(@Req() req: Request) {
    const logoutToken = readForm(req, new Set(['logout_token']), 16_384).get('logout_token');
    if (!logoutToken) throw oidcDenied();
    await this.oidc.backchannel(logoutToken);
    return { loggedOut: true };
  }

  private requireOrigin(req: Request) {
    if (!this.oidc.options || req.get('Origin') !== this.oidc.options.appOrigin) {
      throw new ForbiddenException({ code: 'OIDC_ORIGIN_INVALID', message: 'Yêu cầu SSO cần bắt đầu từ Crypta.' });
    }
  }

  private cookieName() { return this.oidc.options?.testHttp ? 'crypta_oidc' : '__Host-crypta_oidc'; }

  private cookieOptions(): CookieOptions {
    const testHttp = this.oidc.options?.testHttp === true;
    return { httpOnly: true, secure: !testHttp, sameSite: testHttp ? 'strict' : 'none', path: '/' };
  }

  private cookie(req: Request) {
    const prefix = this.cookieName() + '=';
    const matches = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(prefix));
    const value = matches[0]?.slice(prefix.length);
    return matches.length === 1 && value && cookieValue.test(value) ? value : undefined;
  }
}

function readForm(req: Request, allowed: Set<string>, maxLength: number) {
  if (!req.is('application/x-www-form-urlencoded') || !req.body || typeof req.body !== 'object') throw oidcDenied();
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(req.body)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length > maxLength) throw oidcDenied();
    form.set(key, value);
  }
  return form;
}
