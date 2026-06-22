"use client";

import { useEffect, useRef } from "react";
import type { HookEvent } from "./dashboard";

export interface ChangeEvent {
  slug: string | null;
  sessionId: string | null;
}

export function useDataRefresh(
  onRefresh: (change?: ChangeEvent) => void,
  onHookEvent?: (event: HookEvent) => void
) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const hookRef = useRef(onHookEvent);
  hookRef.current = onHookEvent;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let pendingChange: ChangeEvent | undefined;
    const es = new EventSource("/api/events");

    es.addEventListener("change", (e) => {
      try {
        pendingChange = JSON.parse((e as MessageEvent).data) as ChangeEvent;
      } catch {
        pendingChange = { slug: null, sessionId: null };
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        refreshRef.current(pendingChange);
        pendingChange = undefined;
      }, 2_000);
    });

    es.addEventListener("hook", (e) => {
      if (hookRef.current) {
        hookRef.current(JSON.parse((e as MessageEvent).data) as HookEvent);
      }
    });

    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, []);
}
