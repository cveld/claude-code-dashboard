"use client";

import { useEffect, useRef } from "react";
import type { HookEvent } from "./dashboard";

export function useDataRefresh(
  onRefresh: () => void,
  onHookEvent?: (event: HookEvent) => void
) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const hookRef = useRef(onHookEvent);
  hookRef.current = onHookEvent;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const es = new EventSource("/api/events");

    es.addEventListener("change", () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current(), 1_000);
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
