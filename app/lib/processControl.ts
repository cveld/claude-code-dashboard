// Server-only: shared single-pid kill primitive. Stop-Process -Force never
// tells you whether it actually worked, so this always re-checks Get-Process
// afterward instead of trusting the exit code.
import { spawn } from "child_process";

export function stopProcess(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ps =
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; ` +
      `Start-Sleep -Milliseconds 300; ` +
      `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`;

    const child = spawn("powershell", ["-NonInteractive", "-NoProfile", "-Command", ps], { windowsHide: true });

    let settled = false;
    const finish = (gone: boolean) => {
      if (settled) return;
      settled = true;
      resolve(gone);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, 15000);

    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });

    child.on("close", () => {
      clearTimeout(timeout);
      finish(out.trim() === "gone");
    });

    child.on("error", () => {
      clearTimeout(timeout);
      finish(false);
    });
  });
}
