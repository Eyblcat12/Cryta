import { useLayoutEffect, useRef } from 'react';
import { animateRouteContent, shouldAnimateRoute, type MotionRoute } from './routeMotion';

export function useRouteMotion(route: MotionRoute) {
  const mainRef = useRef<HTMLElement>(null);
  const previous = useRef<MotionRoute | null>(null);
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const allowed = shouldAnimateRoute(previous.current, route, media.matches);
    let animation:Animation|null=null;
    // The route commits immediately. Prepare its entrance before the next paint,
    // outside React's commit task, which already owns scroll/layout work.
    const frame=allowed?window.requestAnimationFrame(()=>{
      if(!media.matches)animation=animateRouteContent(mainRef.current);
    }):0;
    previous.current = route;
    const cancel = () => { window.cancelAnimationFrame(frame); animation?.cancel(); };
    // Cancel immediately if the OS preference changes, including mid-transition.
    media.addEventListener('change', cancel);
    return () => {
      media.removeEventListener('change', cancel);
      cancel();
    };
  }, [route.scope, route.page, route.enabled]);
  return mainRef;
}
