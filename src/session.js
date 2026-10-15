import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { channelFor } from "./channel.js";
import { readJson, send } from "./client.js";
import { PROJECT, RUNNER_SOURCES, derivedDataDir, runnerContainer, stateDir } from "./config.js";
import { run, sleep } from "./exec.js";

const scheme = (device) => (device.platform === "ios" ? "RealTapRunneriOS" : "RealTapRunner");

/** Hash of the runner sources so a changed runner triggers a rebuild. */
export function runnerSourceHash(root = RUNNER_SOURCES) {
  const h = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === "xcuserdata" || name.startsWith(".")) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(swift|pbxproj|xcscheme)$/.test(name)) h.update(name).update(fs.readFileSync(p));
    }
  };
  walk(root);
  return h.digest("hex").slice(0, 16);
}

/** Interpret xcodebuild output for problems an operator can act on. */
export function analyzeLog(text) {
  const hints = [];
  if (/Unlock .* to Continue|device is locked/i.test(text)) hints.push("device is locked: unlock it (a watch: wear it) — the runner waits");
  if (/Developer Mode (is )?(disabled|not enabled)/i.test(text)) hints.push("enable Developer Mode on the device: Settings > Privacy & Security > Developer Mode");
  if (/Timed out while enabling automation mode/i.test(text)) hints.push("iOS device refused UI automation: keep it unlocked with the screen on, and enable Settings > Developer > Enable UI Automation (confirm any prompt on the device)");
  if (/Developer mode is disabled for Apple development tools/i.test(text)) hints.push("one-time on this Mac: sudo DevToolsSecurity -enable (needs an admin password)");
  if (/No profiles for|requires a development team|Signing for .* requires/i.test(text)) hints.push("signing failed: run 'realtap setup --team <TEAMID>'");
  if (/Unable to find a destination|is not available|Timed out waiting for .* to become available|connection to this device could not be established|Failed to establish communication with the test runner/i.test(text)) hints.push("Xcode cannot reach the device: keep it unlocked (USB, or same Wi-Fi as this Mac); disable VPN/TUN proxies");
  const finished = /\*\* TEST (EXECUTE )?(SUCCEEDED|FAILED) \*\*/.exec(text)?.[2] ?? null;
  const errors = [...text.matchAll(/^.*error: .*$/gm)].map((m) => m[0].trim()).slice(-5);
  return { hints, finished, errors };
}

function settings(device, cfg) {
  const s = [`REALTAP_BUNDLE_PREFIX=${cfg.bundlePrefix}`];
  if (device.kind === "device") s.push(`DEVELOPMENT_TEAM=${cfg.team}`);
  return s;
}

function baseArgs(device) {
  return ["-project", PROJECT, "-scheme", scheme(device), "-destination", `id=${device.udid}`, "-derivedDataPath", derivedDataDir(device)];
}

const stampFile = (device) => path.join(derivedDataDir(device), "realtap-stamp.json");
const wantedStamp = (device, cfg) => ({ hash: runnerSourceHash(), bundlePrefix: cfg.bundlePrefix, team: device.kind === "device" ? cfg.team : null });

export function isBuilt(device, cfg) {
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(stampFile(device), "utf8"))) === JSON.stringify(wantedStamp(device, cfg));
  } catch {
    return false;
  }
}

export async function build(device, cfg, { onProgress = () => {} } = {}) {
  if (device.kind === "device" && !cfg.team) {
    throw new Error("a development team is required for a physical device: realtap setup --team <TEAMID>");
  }
  onProgress(`building runner for ${device.name} (${device.kind})…`);
  const args = ["build-for-testing", ...baseArgs(device), ...settings(device, cfg)];
  if (device.kind === "device") args.push("-allowProvisioningUpdates");
  const res = await run("xcodebuild", args, { timeoutMs: 20 * 60_000 });
  const log = res.stdout + res.stderr;
  fs.writeFileSync(path.join(stateDir(device), "build.log"), log);
  if (res.code !== 0) {
    const { hints, errors } = analyzeLog(log);
    throw new Error(["runner build failed", ...errors, ...hints, `log: ${path.join(stateDir(device), "build.log")}`].join("\n"));
  }
  fs.mkdirSync(derivedDataDir(device), { recursive: true });
  fs.writeFileSync(stampFile(device), JSON.stringify(wantedStamp(device, cfg)));
  return { built: true };
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const files = (device) => {
  const dir = stateDir(device);
  return { dir, pid: path.join(dir, "runner.pid"), log: path.join(dir, "runner.log"), session: path.join(dir, "session.json") };
};

function readSession(device) {
  try {
    return JSON.parse(fs.readFileSync(files(device).session, "utf8"));
  } catch {
    return null;
  }
}

export function channel(device, cfg) {
  return channelFor(device, runnerContainer(cfg.bundlePrefix, device.platform));
}

export async function status(device, cfg) {
  const f = files(device);
  const session = readSession(device);
  const running = alive(session?.pid);
  const log = fs.existsSync(f.log) ? fs.readFileSync(f.log, "utf8") : "";
  const out = { device: { name: device.name, platform: device.platform, kind: device.kind, udid: device.udid }, running, session: session?.id ?? null, log: f.log };
  if (running) {
    const ch = channel(device, cfg);
    const ready = await readJson(ch, "Documents/ready.json");
    out.ready = ready?.session === session.id;
    if (out.ready) {
      out.screen = ready.screen;
      out.runner_version = ready.runner_version;
      const beat = await readJson(ch, "Documents/heartbeat.json");
      out.heartbeat_age_s = beat?.at ? Math.round((Date.now() - Date.parse(beat.at)) / 1000) : null;
    }
  }
  const a = analyzeLog(log);
  if (a.hints.length) out.hints = a.hints;
  if (!running && a.errors.length) out.last_errors = a.errors;
  return out;
}

/**
 * Start the runner (building first if needed) and wait until it serves commands.
 * Idempotent: returns the existing session when one is alive and ready.
 */
export async function start(device, cfg, { ttlS = 3600, waitS = 300, rebuild = false, onProgress = () => {} } = {}) {
  const current = await status(device, cfg);
  if (current.running && current.ready) {
    fs.writeFileSync(files(device).session, JSON.stringify({ ...readSession(device), ready: true, screen: current.screen }));
    return { ...current, reused: true };
  }
  if (current.running) await stop(device, cfg);

  if (rebuild || !isBuilt(device, cfg)) await build(device, cfg, { onProgress });

  const f = files(device);
  const id = crypto.randomUUID();
  const logFd = fs.openSync(f.log, "w");
  const args = ["test-without-building", ...baseArgs(device), ...settings(device, cfg), `-only-testing:${scheme(device)}/RunnerTests/testServe`];
  const child = spawn("xcodebuild", args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, TEST_RUNNER_REALTAP_SESSION: id, TEST_RUNNER_REALTAP_TTL: String(ttlS) },
  });
  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(f.session, JSON.stringify({ id, pid: child.pid, started_at: new Date().toISOString(), ttl_s: ttlS }));
  onProgress(`runner starting on ${device.name} (session ${id.slice(0, 8)})…`);

  const ch = channel(device, cfg);
  const deadline = Date.now() + waitS * 1000;
  const shown = new Set();
  while (Date.now() < deadline) {
    const ready = await readJson(ch, "Documents/ready.json");
    if (ready?.session === id) {
      fs.writeFileSync(f.session, JSON.stringify({ ...readSession(device), ready: true, screen: ready.screen }));
      return { ...(await status(device, cfg)), reused: false };
    }
    const log = fs.readFileSync(f.log, "utf8");
    const a = analyzeLog(log);
    for (const h of a.hints) if (!shown.has(h)) (shown.add(h), onProgress(h));
    if (!alive(child.pid)) {
      throw new Error(["runner exited before becoming ready", ...a.errors, ...a.hints, `log: ${f.log}`].join("\n"));
    }
    await sleep(1500);
  }
  throw new Error(`runner not ready after ${waitS}s; see ${f.log}`);
}

export async function stop(device, cfg) {
  const session = readSession(device);
  if (!alive(session?.pid)) return { stopped: false, reason: "not running" };
  await send(channel(device, cfg), { op: "quit" }, { timeoutMs: 8000 });
  for (let i = 0; i < 20 && alive(session.pid); i++) await sleep(500);
  if (alive(session.pid)) {
    try {
      process.kill(-session.pid, "SIGTERM");
    } catch {
      try {
        process.kill(session.pid, "SIGTERM");
      } catch {}
    }
  }
  return { stopped: true };
}

/** Run the gesture self-check against the bundled fixture app (stops a serving runner first). */
export async function selftest(device, cfg, { onProgress = () => {} } = {}) {
  await stop(device, cfg);
  if (!isBuilt(device, cfg)) await build(device, cfg, { onProgress });
  onProgress("running selftest…");
  const res = await run("xcodebuild", ["test-without-building", ...baseArgs(device), ...settings(device, cfg), `-only-testing:${scheme(device)}/RunnerTests/testSelftest`], { timeoutMs: 15 * 60_000 });
  const log = res.stdout + res.stderr;
  fs.writeFileSync(path.join(stateDir(device), "selftest.log"), log);
  const a = analyzeLog(log);
  return { passed: res.code === 0, errors: a.errors, hints: a.hints, log: path.join(stateDir(device), "selftest.log") };
}

/** Send a command, starting the runner first when needed. */
export async function command(device, cfg, cmd, opts = {}) {
  const session = readSession(device);
  if (!(alive(session?.pid) && session.ready)) {
    if (opts.autostart === false) return { ok: false, error: "runner not running: realtap start" };
    await start(device, cfg, { onProgress: opts.onProgress });
  }
  return send(channel(device, cfg), cmd, opts);
}
