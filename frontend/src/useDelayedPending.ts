import { useEffect, useState } from 'react';

// Delay only the indicator, never the request or navigation. Reset for a new page.
export function useDelayedPending(pending: boolean, identity: string, delay = 180) {
  const [visibleFor, setVisibleFor] = useState<string | null>(null);
  useEffect(() => {
    setVisibleFor(null);
    if (!pending) return;
    const timer = window.setTimeout(() => setVisibleFor(identity), delay);
    return () => window.clearTimeout(timer);
  }, [pending, identity, delay]);
  return pending && visibleFor === identity;
}
