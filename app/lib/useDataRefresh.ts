"use client";

import { useEffect, useRef } from "react";
import type { HookEvent } from "./dashboard";

export interface ChangeEvent {
  slug: string | null;
  sessionId: string | null;
}

export interface SessionEvent {
  type: "added" | "removed";
  pid: number;
}

export function useDataRefresh(
  onRefresh: (change?: ChangeEvent) => void,
  onHookEvent?: (event: HookEvent) => void,
  onSessionEvent?: (event: SessionEvent) => void
) {
  const refreshRef = useRef(onRefresh);
  const hookRef = useRef(onHookEvent);
  const sessionRef = useRef(onSessionEvent);

  // Keep the refs pointing at the latest callbacks without depending on them
  // in the effect below — ref writes must happen outside render.
  useEffect(() => {
    refreshRef.current = onRefresh;
    hookRef.current = onHookEvent;
    sessionRef.current = onSessionEvent;
  });

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

    es.addEventListener("session", (e) => {
      if (sessionRef.current) {
        sessionRef.current(JSON.parse((e as MessageEvent).data) as SessionEvent);
      }
    });

    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, []);
}
