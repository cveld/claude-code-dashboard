import { NextResponse } from "next/server";
import { buildChains } from "@/app/lib/strayProcesses";
import type { StrayProcessesResponse } from "@/app/lib/strayProcesses";
import { snapshot } from "@/app/lib/strayProcessSnapshot";

export async function GET() {
  if (process.platform !== "win32") {
    return NextResponse.json({ supported: false, chains: [], totalProcesses: 0, oldestAgeMs: 0 });
  }

  const { procs, livePids } = await snapshot();
  const chains = buildChains(procs, livePids);

  return NextResponse.json({
    supported: true,
    chains,
    totalProcesses: chains.reduce((sum, c) => sum + c.processes.length, 0),
    oldestAgeMs: chains.reduce((max, c) => Math.max(max, c.ageMs), 0),
  } satisfies StrayProcessesResponse);
}
