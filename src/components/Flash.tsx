'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const EVENT = 'app:flash';
const COOKIE = 'pkg_flash';

interface Message {
  text: string;
  kind: 'ok' | 'error';
}

/** Show a short message at the bottom of the screen. */
export function flash(text: string, kind: Message['kind'] = 'ok') {
  window.dispatchEvent(new CustomEvent<Message>(EVENT, { detail: { text, kind } }));
}

/**
 * Displays short messages. They arrive either directly from a form on this
 * page, or in a short-lived cookie set by an action that then redirected.
 */
export function Flash() {
  const pathname = usePathname();
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    const match = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`));
    if (!match) return;
    document.cookie = `${COOKIE}=; path=/; max-age=0`;
    try {
      setMessage({ text: decodeURIComponent(match.slice(COOKIE.length + 1)), kind: 'ok' });
    } catch { /* malformed cookie: nothing to show */ }
  }, [pathname]);

  useEffect(() => {
    const onFlash = (event: Event) => setMessage((event as CustomEvent<Message>).detail);
    window.addEventListener(EVENT, onFlash);
    return () => window.removeEventListener(EVENT, onFlash);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), message.kind === 'error' ? 10000 : 6000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div className={`toast${message.kind === 'error' ? ' toast-error' : ''}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      <span>{message.text}</span>
      <button type="button" className="toast-close" onClick={() => setMessage(null)} aria-label="Dismiss">×</button>
    </div>
  );
}
