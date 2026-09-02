import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { buildChains } from "@/app/lib/strayProcesses";
import { snapshot } from "@/app/lib/strayProcessSnapshot";

export interface KillResult {
  killed: number[];
  /** Pids the server refused, with the reason — never silently dropped. */
  skipped: { pid: number; reason: string }[];
}

// Guard against a stale page: the client may only ask for pids that are still
// stray *right now*, so a recycled pid can never be killed by an old view.
async function resolveKillable(requested: number[]): Promise<{
  order: number[];
  skipped: { pid: number; reason: string }[];
}> {
  const { procs, livePids } = await snapshot();
  const chains = buildChains(procs, livePids);

  const depthByPid = new Map<number, number>();
  for (const chain of chains) {
    for (const p of chain.processes) depthByPid.set(p.pid, p.depth);
  }

  const skipped: { pid: number; reason: string }[] = [];
  const killable: number[] = [];
  for (const pid of requested) {
    if (!depthByPid.has(pid)) {
      skipped.push({ pid, reason: "no longer a stray helper process" });
      continue;
    }
    killable.push(pid);
  }

  // Leaf-first, so a parent cannot spawn a fresh helper while we work down the tree.
  killable.sort((a, b) => (depthByPid.get(b) ?? 0) - (depthByPid.get(a) ?? 0));
  return { order: killable, skipped };
}

function stopProcesses(pids: number[]): Promise<Set<number>> {
  return new Promise((resolve) => {
    // Stop, then report back which pids are actually gone — never trust the exit code.
    const ps =
      `${pids.map((p) => `Stop-Process -Id ${p} -Force -ErrorAction SilentlyContinue`).join("; ")}; ` +
      `Start-Sleep -Milliseconds 300; ` +
      `@(${pids.join(",")}) | Where-Object { -not (Get-Process -Id $_ -ErrorAction SilentlyContinue) } | ConvertTo-Json -Compress`;

    const child = spawn("powershell", ["-NonInteractive", "-NoProfile", "-Command", ps], { windowsHide: true });

    let settled = false;
    const finish = (gone: Set<number>) => {
      if (settled) return;
      settled = true;
      resolve(gone);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(new Set());
    }, 15000);

    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });

    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const parsed: unknown = JSON.parse(out.trim() || "[]");
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        finish(new Set(arr.filter((n): n is number => typeof n === "number")));
      } catch {
        finish(new Set());
      }
    });

    child.on("error", () => {
      clearTimeout(timeout);
      finish(new Set());
    });
  });
}

export async function POST(request: Request) {
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "Windows only" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { pids?: unknown }).pids;
  const requested = Array.isArray(raw)
    ? raw.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p > 0)
    : [];

  if (requested.length === 0) {
    return NextResponse.json({ error: "Expected { pids: number[] }" }, { status: 400 });
  }

  const { order, skipped } = await resolveKillable(requested);
  if (order.length === 0) {
    return NextResponse.json({ killed: [], skipped } satisfies KillResult);
  }

  const gone = await stopProcesses(order);
  const killed = order.filter((pid) => gone.has(pid));
  for (const pid of order) {
    if (!gone.has(pid)) skipped.push({ pid, reason: "still running after Stop-Process" });
  }

  console.log(`[stray-processes] killed ${killed.length}/${order.length}: ${killed.join(",")}`);
  return NextResponse.json({ killed, skipped } satisfies KillResult);
}
