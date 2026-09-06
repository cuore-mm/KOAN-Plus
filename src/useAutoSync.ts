import { useEffect, useRef } from "react";

/** Checking local freshness costs no requests. Hidden/offline pages do no work. */
export function useAutoSync(tick: () => Promise<void>, view: string) {
  const latest = useRef(tick);
  latest.current = tick;
  const wake = useRef(() => {});
  useEffect(() => {
    let active = true;
    let busy = false;
    const run = async () => {
      if (!active || busy || document.visibilityState === "hidden" || navigator.onLine === false) return;
      busy = true;
      try { await latest.current(); } finally { busy = false; }
    };
    const notify = () => { void run(); };
    wake.current = notify;
    const interval = window.setInterval(notify, 30_000);
    document.addEventListener("visibilitychange", notify);
    window.addEventListener("online", notify);
    window.addEventListener("focus", notify);
    notify();
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", notify);
      window.removeEventListener("online", notify);
      window.removeEventListener("focus", notify);
    };
  }, []);
  useEffect(() => wake.current(), [view]);
}
