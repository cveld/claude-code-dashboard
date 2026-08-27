// Server-only: takes the Win32_Process snapshot that stray-process detection runs on.
// Kept out of app/lib/strayProcesses.ts so client components can import those types.
import { spawn } from "child_process";
import { HELPER_NAMES, toNumber } from "@/app/lib/strayProcesses";
import type { RawProc } from "@/app/lib/strayProcesses";

export interface Snapshot {
  procs: RawProc[];
  livePids: Set<number>;
}

// One PowerShell spawn per request: the helper processes plus every live pid,
// so orphan detection needs no second call.
export function snapshot(): Promise<Snapshot> {
  const empty: Snapshot = { procs: [], livePids: new Set() };

  return new Promise((resolve) => {
    const filter = HELPER_NAMES.map((n) => `Name='${n}'`).join(" OR ");
    const ps =
      `$procs = Get-CimInstance Win32_Process -Filter "${filter}" | ` +
      `Select-Object ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, ` +
      `@{n='CreatedAt';e={$_.CreationDate.ToString('o')}}; ` +
      `[pscustomobject]@{ procs = @($procs); pids = @(Get-Process | Select-Object -ExpandProperty Id) } | ` +
      `ConvertTo-Json -Compress -Depth 4`;

    const child = spawn("powershell", ["-NonInteractive", "-NoProfile", "-Command", ps]);

    let settled = false;
    const finish = (value: Snapshot) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(empty);
    }, 5000);

    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });

    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const parsed: unknown = JSON.parse(out.trim() || "{}");
        const payload = (parsed ?? {}) as { procs?: unknown; pids?: unknown };
        // ConvertTo-Json collapses a single-element array, hence @() above plus this guard.
        const procs = Array.isArray(payload.procs)
          ? (payload.procs as RawProc[])
          : payload.procs && typeof payload.procs === "object"
            ? [payload.procs as RawProc]
            : [];
        const livePids = new Set<number>();
        if (Array.isArray(payload.pids)) {
          for (const p of payload.pids) {
            const n = toNumber(p);
            if (n !== undefined) livePids.add(n);
          }
        }
        finish({ procs, livePids });
      } catch {
        finish(empty);
      }
    });

    child.on("error", () => {
      clearTimeout(timeout);
      finish(empty);
    });
  });
}

