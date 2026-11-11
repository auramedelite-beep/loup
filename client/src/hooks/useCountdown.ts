import { useEffect, useRef, useState } from 'react';

/**
 * Server-authoritative countdown. The server sends `phaseEndsAt` together with
 * `serverNow`; we anchor local time to the server clock so slow devices and
 * clock drift cannot extend or shorten a phase.
 */
export function useCountdown(endsAt: number | null | undefined, serverNow?: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const anchor = useRef({ local: Date.now(), server: serverNow ?? Date.now() });

  useEffect(() => {
    anchor.current = { local: Date.now(), server: serverNow ?? Date.now() };
    setNow(Date.now());
  }, [endsAt, serverNow]);

  useEffect(() => {
    if (!endsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 300);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  if (!endsAt) return 0;
  const estimatedServerNow = anchor.current.server + (now - anchor.current.local);
  return Math.max(0, Math.ceil((endsAt - estimatedServerNow) / 1000));
}
