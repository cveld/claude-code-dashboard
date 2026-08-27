// Shared Caddy admin-API integration used by both the packaged CLI (`next start`)
// and the dev launcher (`next dev`). It registers a reverse-proxy route
// `<host> -> <dial-host>:<port>` for the lifetime of the process and removes it again on exit.
//
// Note: node:http/node:https are used instead of global fetch on purpose. Undici always
// attaches Origin / Sec-Fetch-* headers, which makes Caddy's admin API treat the call as a
// browser request and reject it with `403 client is not allowed to access from origin ''`.
// Plain node:http sends no such headers and is accepted the same way curl is.

const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const DEFAULT_ADMIN = "http://127.0.0.1:2019";
const DEFAULT_DIAL_HOST = "127.0.0.1";
const DOCKER_DIAL_HOST = "host.docker.internal";

// Statuses Caddy returns when the route matched but the upstream could not be reached.
const UPSTREAM_FAILURE_STATUSES = new Set([502, 503, 504]);

/**
 * Parses caddy-related flags out of argv and merges them with the environment.
 * Flags win over env vars; `rest` is argv with every caddy flag stripped.
 */
function resolveOptions({ argv = [], env = process.env, defaultHost, defaultEnabled = true } = {}) {
  const rest = [];
  let enabled = null;
  let hostArg;
  let adminArg;
  let dialHostArg;

  for (const arg of argv) {
    if (arg === "--caddy") {
      enabled = true;
      continue;
    }
    if (arg === "--no-caddy") {
      enabled = false;
      continue;
    }
    if (arg.startsWith("--caddy-host=")) {
      hostArg = arg.slice("--caddy-host=".length);
      continue;
    }
    if (arg.startsWith("--caddy-admin=")) {
      adminArg = arg.slice("--caddy-admin=".length);
      continue;
    }
    if (arg.startsWith("--caddy-dial-host=")) {
      dialHostArg = arg.slice("--caddy-dial-host=".length);
      continue;
    }
    rest.push(arg);
  }

  if (enabled == null) {
    const raw = (env.CLAUDE_DASHBOARD_CADDY || "").trim();
    if (/^(0|false|off|no)$/i.test(raw)) enabled = false;
    else if (/^(1|true|on|yes)$/i.test(raw)) enabled = true;
    else enabled = defaultEnabled;
  }

  const envDial = env.CLAUDE_DASHBOARD_CADDY_DIAL_HOST;

  return {
    enabled,
    host: hostArg || env.CLAUDE_DASHBOARD_CADDY_HOST || defaultHost,
    admin: adminArg || env.CLAUDE_DASHBOARD_CADDY_ADMIN || DEFAULT_ADMIN,
    dialHost: dialHostArg || envDial || DEFAULT_DIAL_HOST,
    dialHostExplicit: Boolean(dialHostArg || envDial),
    serverName: env.CADDY_SERVER_NAME || null,
    rest,
  };
}

function createCaddyRoute(options) {
  // Deriving the id from the hostname keeps registration idempotent per host, and lets a dev
  // server and a production server coexist without overwriting each other's route.
  const id =
    "ccd-" +
    String(options.host || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const adminUrl = new URL(options.admin);
  const adminTransport = adminUrl.protocol === "https:" ? https : http;
  const adminBasePath = adminUrl.pathname.replace(/\/+$/, "");

  let dialHost = options.dialHost || DEFAULT_DIAL_HOST;
  let serverName = null;
  let listen = [];

  function adminRequest(method, urlPath, body) {
    return new Promise((resolve) => {
      const payload = body != null ? JSON.stringify(body) : null;
      const req = adminTransport.request(
        {
          protocol: adminUrl.protocol,
          hostname: adminUrl.hostname,
          port: adminUrl.port || (adminUrl.protocol === "https:" ? 443 : 80),
          method,
          path: adminBasePath + urlPath,
          headers: payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () =>
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode || 0,
              statusText: res.statusMessage || "",
              text: data,
            })
          );
        }
      );
      req.setTimeout(1500, () => req.destroy(new Error("timeout")));
      req.on("error", (err) => resolve({ ok: false, status: 0, statusText: err.message, text: "" }));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function register(port) {
    try {
      const serversRes = await adminRequest("GET", "/config/apps/http/servers");
      if (!serversRes.ok) {
        const detail = serversRes.status ? `${serversRes.status} ${serversRes.statusText}` : serversRes.statusText;
        return { ok: false, reason: `admin API at ${options.admin} unreachable (${detail})` };
      }

      let servers;
      try {
        servers = JSON.parse(serversRes.text || "{}");
      } catch (e) {
        return { ok: false, reason: `unreadable server config (${e.message})` };
      }

      const keys = Object.keys(servers || {});
      if (!keys.length) return { ok: false, reason: "no HTTP servers in Caddy config" };

      serverName = options.serverName && servers[options.serverName] ? options.serverName : keys[0];
      listen = Array.isArray(servers[serverName] && servers[serverName].listen)
        ? servers[serverName].listen
        : [];

      const route = {
        "@id": id,
        match: [{ host: [options.host] }],
        handle: [{ handler: "reverse_proxy", upstreams: [{ dial: dialHost + ":" + port }] }],
        terminal: true,
      };

      // PATCH updates the route in place when it already exists (restart, dial-host switch);
      // POST appends it the first time.
      const patchRes = await adminRequest("PATCH", `/id/${id}`, route);
      if (patchRes.ok) return { ok: true, host: options.host, dial: dialHost, port, serverName };

      const routesPath = `/config/apps/http/servers/${encodeURIComponent(serverName)}/routes`;
      const postRes = await adminRequest("POST", routesPath, route);
      if (postRes.ok) return { ok: true, host: options.host, dial: dialHost, port, serverName };

      return {
        ok: false,
        reason: `could not upsert route (PATCH ${patchRes.status} ${patchRes.statusText}, POST ${postRes.status} ${postRes.statusText})`,
      };
    } catch (e) {
      return { ok: false, reason: e.message || String(e) };
    }
  }

  async function unregister() {
    try {
      await adminRequest("DELETE", `/id/${id}`);
    } catch {
      // Caddy may already be gone; nothing to clean up.
    }
  }

  // Sends a request through Caddy's own HTTP listener carrying our Host header, so the answer
  // tells us whether the upstream we registered is reachable from inside Caddy.
  function probe() {
    const first = String(listen[0] || ":80");
    const listenPort = Number(first.slice(first.lastIndexOf(":") + 1)) || 80;
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: adminUrl.hostname,
          port: listenPort,
          method: "GET",
          path: "/",
          headers: { host: options.host },
        },
        (res) => {
          res.resume();
          resolve({ reached: true, status: res.statusCode || 0 });
        }
      );
      req.setTimeout(2000, () => req.destroy(new Error("timeout")));
      req.on("error", () => resolve({ reached: false, status: 0 }));
      req.end();
    });
  }

  // When Caddy runs in Docker, "127.0.0.1" resolves inside the container and the route 502s.
  // Rather than making the user work that out, verify the route once the app is listening and
  // transparently re-point it at host.docker.internal when the first attempt fails.
  async function verifyAndFix(port) {
    if (options.dialHostExplicit || !serverName) return { ok: true, skipped: true, dial: dialHost };

    try {
      const first = await probe();
      if (first.reached && !UPSTREAM_FAILURE_STATUSES.has(first.status)) {
        return { ok: true, dial: dialHost };
      }
      if (dialHost !== DEFAULT_DIAL_HOST) return { ok: false, dial: dialHost };

      dialHost = DOCKER_DIAL_HOST;
      const again = await register(port);
      if (!again.ok) return { ok: false, dial: dialHost, switched: true };

      const second = await probe();
      return {
        ok: second.reached && !UPSTREAM_FAILURE_STATUSES.has(second.status),
        dial: dialHost,
        switched: true,
      };
    } catch {
      return { ok: false, dial: dialHost };
    }
  }

  return {
    id,
    register,
    unregister,
    verifyAndFix,
    get dialHost() {
      return dialHost;
    },
    get serverName() {
      return serverName;
    },
  };
}

/** Resolves once something accepts TCP connections on `port`, or after `timeoutMs`. */
function waitForPort(port, { host = "127.0.0.1", timeoutMs = 60000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      const retry = () => {
        socket.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, intervalMs);
      };
      socket.setTimeout(1000, retry);
      socket.on("error", retry);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
    };
    attempt();
  });
}

/** Reads an explicit port from `next` CLI args (`-p 4000`, `--port=4000`). */
function detectPort(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--port") {
      const value = args[i + 1];
      if (value && /^\d+$/.test(value)) return Number(value);
      continue;
    }
    const match = arg.match(/^(?:-p|--port)=(\d+)$/);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * True when nothing is listening on `port` yet. Binds without a host so it covers every
 * interface, exactly like `next dev` does - a 127.0.0.1-only probe would call a port free that
 * something already holds on `::`, and Next would then fail with EADDRINUSE.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

/** Asks the OS for an unused port by binding to :0 and releasing it again. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close((err) => {
        if (err) reject(err);
        else if (typeof port === "number") resolve(port);
        else reject(new Error("could not determine a free port"));
      });
    });
  });
}

module.exports = {
  resolveOptions,
  createCaddyRoute,
  waitForPort,
  detectPort,
  isPortFree,
  getFreePort,
  DEFAULT_ADMIN,
  DEFAULT_DIAL_HOST,
  DOCKER_DIAL_HOST,
};
