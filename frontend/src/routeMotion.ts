import type { WorkspaceView } from './routes';

export const MOTION_TOKENS = {
  fast:120,
  page:160,
  overlay:180,
  entrance:'cubic-bezier(0.2, 0, 0, 1)',
  exit:'cubic-bezier(0.4, 0, 1, 1)',
} as const;
export const ROUTE_MOTION = { duration: MOTION_TOKENS.page, easing: MOTION_TOKENS.entrance };

export function applyMotionTokens(element:Pick<HTMLElement,'style'>) {
  for(const name of ['fast','page','overlay'] as const)element.style.setProperty(`--motion-${name}`,`${MOTION_TOKENS[name]}ms`);
  element.style.setProperty('--motion-ease-entrance',MOTION_TOKENS.entrance);
  element.style.setProperty('--motion-ease-exit',MOTION_TOKENS.exit);
}
export type MotionRoute = { scope: string; page: WorkspaceView; enabled: boolean };

// Query changes and detail drawers are not new workspace pages. No old-page snapshots.
export function shouldAnimateRoute(previous: MotionRoute | null, next: MotionRoute, reduced: boolean) {
  return !reduced && !!previous?.enabled && next.enabled
    && previous.scope === next.scope && previous.page !== next.page;
}

export function animateRouteContent(element: Pick<HTMLElement, 'animate'> | null): Animation | null {
  if (!element || typeof element.animate !== 'function') return null;
  try {
    // Leave layout, pointer events and focus untouched. No fill mode: underlying opacity stays 1.
    return element.animate([{ opacity: 0.6 }, { opacity: 1 }], ROUTE_MOTION);
  } catch {
    // Enhancement failure must never prevent navigation or hide content.
    return null;
  }
}
