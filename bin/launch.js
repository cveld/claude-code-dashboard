// Spawns a Next.js server (`start` or `dev`) and, when enabled, keeps a Caddy route pointed at
// it for the lifetime of the process. Shared by bin/cli.js and scripts/dev.mjs so both
// launchers behave identically around ports, logging and cleanup.

const { spawn } = require("node:child_process");
const {
  resolveOptions,
  createCaddyRoute,
  waitForPort,
  detectPort,
  isPortFree,
  getFreePort,
} = require("./caddy.js");

/**
 * @param {object} params
 * @param {string} params.nextBin       Path to next/dist/bin/next.
 * @param {string} params.cwd           Directory to run next from.
 * @param {string[]} params.argv        Raw process args (caddy flags are stripped here).
 * @param {"start"|"dev"} params.command
 * @param {string} params.defaultHost   Hostname to register with Caddy.
 * @param {boolean} [params.caddyByDefault]  Register without an explicit --caddy flag.
 * @param {number} [params.defaultPort] Port to assume when none is given; omit to pick a free one.
 */
async function launch({
  nextBin,
  cwd,
  argv,
  command,
  defaultHost,
  caddyByDefault = true,
  defaultPort = null,
}) {
  const options = resolveOptions({ argv, defaultHost, defaultEnabled: caddyByDefault });
  const nextArgs = options.rest[0] === command ? options.rest.slice() : [command, ...options.rest];

  let port = detectPort(nextArgs);
  if (port == null && options.enabled) {
    try {
      // Next silently moves to the next free port when the one it wants is taken, which would
      // leave the route pointing at the wrong process - so the port is pinned here instead.
      port = defaultPort != null && (await isPortFree(defaultPort)) ? defaultPort : await getFreePort();
      nextArgs.push("-p", String(port));
    } catch (e) {
      console.warn(`Caddy: skipped, could not find a free port (${e.message}).`);
      port = null;
    }
  }

  const route = options.enabled && port != null ? createCaddyRoute(options) : null;
  let registered = false;

  if (route) {
    const result = await route.register(port);
    if (result.ok) {
      registered = true;
      console.log(`Caddy: http://${options.host} -> ${result.dial}:${port} (server "${result.serverName}")`);
    } else {
      console.log(`Caddy: not registered - ${result.reason}. The dashboard runs normally without it.`);
    }
  } else if (!options.enabled && caddyByDefault) {
    console.log("Caddy: disabled.");
  }

  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (registered) {
    // The route can only be verified once the app actually listens, so this runs alongside the
    // child instead of blocking its startup.
    waitForPort(port).then(async (up) => {
      if (!up) return;
      const check = await route.verifyAndFix(port);
      if (check.switched && check.ok) {
        console.log(`Caddy: upstream re-pointed to ${check.dial}:${port} (Caddy appears to run in a container).`);
      } else if (!check.ok && !check.skipped) {
        console.warn(
          `Caddy: http://${options.host} does not reach ${check.dial}:${port} yet. ` +
            "Override the upstream with --caddy-dial-host=<host> if needed."
        );
      }
    });
  }

  let finalizing = false;
  let childExited = false;

  function finalize(code, signal) {
    if (finalizing) return;
    finalizing = true;
    const cleanup = registered ? route.unregister() : Promise.resolve();
    cleanup.finally(() => {
      // A signal handler on this process suppresses Node's default terminate action, so
      // re-raising the signal here would just re-enter this handler - exit explicitly instead.
      process.exit(code != null ? code : signal ? 1 : 0);
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!childExited) child.kill(signal);
      finalize(null, signal);
    });
  }

  child.on("exit", (code, signal) => {
    childExited = true;
    finalize(code, signal);
  });
}

module.exports = { launch };
