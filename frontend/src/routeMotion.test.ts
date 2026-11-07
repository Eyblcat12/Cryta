import { describe, expect, it, vi } from 'vitest';
import { animateRouteContent, ROUTE_MOTION, shouldAnimateRoute, type MotionRoute } from './routeMotion';

const dashboard: MotionRoute = { scope: 'READY:alice:ADMIN:false', page: 'dashboard', enabled: true };
const users: MotionRoute = { ...dashboard, page: 'users' };

describe('committed route motion policy', () => {
  it('animates a different workspace page in the same session', () => {
    expect(shouldAnimateRoute(dashboard, users, false)).toBe(true);
    expect(shouldAnimateRoute(users, dashboard, false)).toBe(true);
  });
  it('does not animate initial load or session restoration', () => {
    expect(shouldAnimateRoute(null, users, false)).toBe(false);
  });
  it('does not animate query, refresh or theme changes on the same page', () => {
    expect(shouldAnimateRoute(users, { ...users }, false)).toBe(false);
  });
  it('honors reduced motion', () => {
    expect(shouldAnimateRoute(dashboard, users, true)).toBe(false);
  });
  it.each(['READY:bob:ADMIN:false', 'READY:alice:USER:false', 'GUEST::USER:false', 'READY:alice:ADMIN:true'])(
    'skips session/role/password boundary %s', (scope) => {
      expect(shouldAnimateRoute(dashboard, { ...users, scope }, false)).toBe(false);
    },
  );
  it('skips disabled routes, details, auth redirects and the off switch', () => {
    expect(shouldAnimateRoute(dashboard, { ...users, enabled: false }, false)).toBe(false);
    expect(shouldAnimateRoute({ ...dashboard, enabled: false }, users, false)).toBe(false);
  });
});

describe('route entrance enhancement', () => {
  it('only animates opacity for 160 ms without persisting styles', () => {
    const animation = { cancel: vi.fn() } as unknown as Animation;
    const animate = vi.fn(() => animation);
    expect(animateRouteContent({ animate })).toBe(animation);
    expect(animate).toHaveBeenCalledWith([{ opacity: 0.6 }, { opacity: 1 }], ROUTE_MOTION);
    expect(ROUTE_MOTION.duration).toBe(160);
    expect(ROUTE_MOTION).not.toHaveProperty('fill');
  });
  it('works without an element or animation API', () => {
    expect(animateRouteContent(null)).toBeNull();
    expect(animateRouteContent({} as HTMLElement)).toBeNull();
  });
  it('does not block navigation if the browser rejects animation', () => {
    expect(animateRouteContent({ animate: () => { throw new Error('unsupported'); } })).toBeNull();
  });
});
