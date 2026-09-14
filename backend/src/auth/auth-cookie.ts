import type { Request, Response } from 'express';

export const REFRESH_COOKIE = 'crypta_refresh';
const cookieSecure = () => process.env.COOKIE_SECURE === 'true';

export function readRefreshCookie(request: Request): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(parts.join('='));
  }
  return undefined;
}

export function setRefreshCookie(response: Response, token: string) {
  response.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30) * 86_400_000,
  });
}

export function clearRefreshCookie(response: Response) {
  response.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict',
    path: '/api/v1/auth',
  });
}
