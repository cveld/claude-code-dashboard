import { EventEmitter } from "events";
import type { HookEvent } from "./dashboard";

export type { HookEvent };

class HookEventEmitter extends EventEmitter {}
export const hookEmitter = new HookEventEmitter();
hookEmitter.setMaxListeners(100);
