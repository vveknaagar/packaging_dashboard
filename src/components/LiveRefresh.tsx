'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Never refresh more often than this, however often the window gains focus. */
const MIN_GAP_MS = 5000;

/**
 * Stock is changed by other people at other locations. When someone comes back
 * to a screen they left open, this reloads its figures so they are not looking
 * at old stock. It only acts when the person returns, so an unattended screen
 * still reaches the idle sign-out.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();
    function refresh() {
      if (document.visibilityState !== 'visible' || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      router.refresh();
    }
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);

  return null;
}
