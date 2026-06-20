import { EventEmitter } from "events";
import type { HookEvent } from "./dashboard";

export type { HookEvent };

class HookEventEmitter extends EventEmitter {}

const g = globalThis as typeof globalThis & { __hookEmitter?: HookEventEmitter };
if (!g.__hookEmitter) {
  g.__hookEmitter = new HookEventEmitter();
  g.__hookEmitter.setMaxListeners(100);
}
export const hookEmitter: HookEventEmitter = g.__hookEmitter!;
