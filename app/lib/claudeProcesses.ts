// Server-only: raw OS-level view of every `claude.exe` process, independent of
// `~/.claude/sessions/*.json`. Needed because that registry file can go
// missing (crash, or the pruning bug fixed earlier) while the process itself
// keeps running — this is the fallback so those processes stay killable even
// when the dashboard has no session record for them.
import { spawn } from "child_process";

export interface RawClaudeProcess {
  pid: number;
  path: string;
  commandLine: string;
  createdAt: number;
  memoryBytes: number;
  /** Paged/private memory (Win32_Process.PageFileUsage, converted from KB to bytes) — commit charge backed by the page file, distinct from resident working-set RAM. */
  pagedBytes: number;
  /** Working directory read straight from the process's PEB (RTL_USER_PROCESS_PARAMETERS.CurrentDirectory) — the same value the CLI itself would report as `cwd`. Null if the read failed (process exited mid-probe, access denied, etc). */
  cwd: string | null;
}

export interface ClaudeProcessesResult {
  /** False when the probe itself failed (spawn error, timeout, bad output) — never treat `processes` as a complete/authoritative list in that case. */
  ok: boolean;
  processes: RawClaudeProcess[];
}

export function listClaudeProcesses(): Promise<ClaudeProcessesResult> {
  const empty: ClaudeProcessesResult = { ok: false, processes: [] };
  if (process.platform !== "win32") {
    return Promise.resolve(empty);
  }

  return new Promise((resolve) => {
    // Reads a process's actual working directory straight out of its PEB
    // (RTL_USER_PROCESS_PARAMETERS.CurrentDirectory) via NtQueryInformationProcess +
    // ReadProcessMemory — the same value the CLI itself recorded as `cwd` when it
    // registered. Windows has no WMI/Get-Process property for this, unlike /proc/pid/cwd
    // on Linux. Verified against three live sessions' known `~/.claude/sessions/<pid>.json`
    // cwd values before relying on it. Offsets are x64-only (fine: claude.exe is x64).
    const cwdReaderType = `
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class CwdReader {
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr hProcess, int pic, ref PROCESS_BASIC_INFORMATION pbi, int size, out int ret);

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_BASIC_INFORMATION {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr Reserved3;
    }

    [DllImport("kernel32.dll")]
    static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] buffer, int size, out int lpNumberOfBytesRead);

    public static string GetCwd(int pid) {
        Process proc;
        try { proc = Process.GetProcessById(pid); } catch { return null; }
        IntPtr h;
        try { h = proc.Handle; } catch { return null; }

        var pbi = new PROCESS_BASIC_INFORMATION();
        int ret;
        if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;

        byte[] pebBuf = new byte[0x400];
        int read;
        if (!ReadProcessMemory(h, pbi.PebBaseAddress, pebBuf, pebBuf.Length, out read)) return null;
        IntPtr processParams = (IntPtr)BitConverter.ToInt64(pebBuf, 0x20);

        byte[] ppBuf = new byte[0x400];
        if (!ReadProcessMemory(h, processParams, ppBuf, ppBuf.Length, out read)) return null;

        // CURDIR at ProcessParameters+0x38: UNICODE_STRING { ushort Length; ushort MaxLength; [pad]; PVOID Buffer }
        ushort curLen = BitConverter.ToUInt16(ppBuf, 0x38);
        long curBufPtr = BitConverter.ToInt64(ppBuf, 0x40);
        if (curLen == 0) return null;

        byte[] strBuf = new byte[curLen];
        if (!ReadProcessMemory(h, (IntPtr)curBufPtr, strBuf, curLen, out read)) return null;
        return Encoding.Unicode.GetString(strBuf, 0, read);
    }
}
`;

    // Wrapped in an object (same reasoning as getMemoryUsage): guarantees
    // valid JSON even when zero processes match, so empty stdout is
    // unambiguously "the script failed", never confused with "found none".
    const ps =
      `try { Add-Type -Language CSharp -TypeDefinition '${cwdReaderType.replace(/'/g, "''")}' } catch {}; ` +
      `$procs = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | ` +
      `Select-Object ProcessId, CommandLine, ExecutablePath, WorkingSetSize, PageFileUsage, ` +
      `@{n='CreatedAt';e={$_.CreationDate.ToString('o')}}, ` +
      `@{n='Cwd';e={ try { [CwdReader]::GetCwd($_.ProcessId) } catch { $null } }}); ` +
      `[pscustomobject]@{ procs = $procs } | ConvertTo-Json -Compress -Depth 4`;

    const child = spawn("powershell", ["-NonInteractive", "-NoProfile", "-Command", ps], { windowsHide: true });

    // Longer than the other probes in this file: Add-Type shells out to csc.exe to
    // compile CwdReader, which costs a second or more on a cold start.
    const timeout = setTimeout(() => {
      child.kill();
      resolve(empty);
    }, 10000);

    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });

    child.on("close", () => {
      clearTimeout(timeout);
      if (!out.trim()) {
        resolve(empty);
        return;
      }
      try {
        const parsed = JSON.parse(out) as { procs?: unknown };
        const arr = Array.isArray(parsed.procs) ? parsed.procs : parsed.procs ? [parsed.procs] : [];
        const processes: RawClaudeProcess[] = [];
        for (const p of arr as Array<Record<string, unknown>>) {
          const pid = typeof p.ProcessId === "number" ? p.ProcessId : Number(p.ProcessId);
          const createdAtStr = typeof p.CreatedAt === "string" ? p.CreatedAt : null;
          const createdAt = createdAtStr ? new Date(createdAtStr).getTime() : NaN;
          if (!Number.isFinite(pid) || !Number.isFinite(createdAt)) continue;
          processes.push({
            pid,
            path: typeof p.ExecutablePath === "string" ? p.ExecutablePath : "",
            commandLine: typeof p.CommandLine === "string" ? p.CommandLine : "",
            createdAt,
            memoryBytes: typeof p.WorkingSetSize === "number" ? p.WorkingSetSize : Number(p.WorkingSetSize) || 0,
            pagedBytes: (typeof p.PageFileUsage === "number" ? p.PageFileUsage : Number(p.PageFileUsage) || 0) * 1024,
            cwd: typeof p.Cwd === "string" && p.Cwd.length > 0 ? p.Cwd.replace(/[\\/]+$/, "") : null,
          });
        }
        resolve({ ok: true, processes });
      } catch {
        resolve(empty);
      }
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolve(empty);
    });
  });
}
