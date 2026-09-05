'use client';

import { useEffect, useState } from 'react';

import { PillButton } from '../../components/pill-button';
import { Toast, OFFLINE } from '../../components/toast';

/**
 * The Offline state, docs/DESIGN-TOKENS.md section 8.
 *
 * It is the one state in this product that no server can decide, so it is
 * decided in the browser: `navigator.onLine` at first paint and the two events
 * that change it. The copy says what is still true rather than what failed,
 * because a cover does not stop existing when a phone loses signal, and Retry
 * reloads the screen rather than pretending to reconnect.
 *
 * Rendered as nothing at all while the browser is online, so it costs an online
 * screen one boolean and no layout.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
 */

export function OfflineNotice() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const read = () => setOffline(!navigator.onLine);
    read();
    window.addEventListener('online', read);
    window.addEventListener('offline', read);
    return () => {
      window.removeEventListener('online', read);
      window.removeEventListener('offline', read);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="offline">
      <Toast>
        <span className="flex flex-col gap-1">
          <span className="font-medium">{OFFLINE.title}</span>
          <span className="text-secondary text-ink-2">{OFFLINE.body}</span>
        </span>
      </Toast>
      <PillButton onClick={() => window.location.reload()} variant="secondary">
        {OFFLINE.action}
      </PillButton>
    </div>
  );
}
