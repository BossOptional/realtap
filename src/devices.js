import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./exec.js";

/**
 * A target (Apple Watch or iPhone/iPad):
 *   { platform: "watchos"|"ios", kind: "device"|"simulator", id, udid, name, os, connected, developerMode }
 * `id` is what devicectl/simctl address it by; `udid` is the xcodebuild destination id.
 */

export const PLATFORMS = { watchos: "Apple Watch", ios: "iPhone/iPad" };

/** Accepts watch|watchos|ios|iphone|ipad (any case); undefined stays undefined. */
export function normalizePlatform(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const v = String(value).toLowerCase();
  if (["watch", "watchos"].includes(v)) return "watchos";
  if (["ios", "iphone", "ipad", "ipados"].includes(v)) return "ios";
  throw new Error(`unknown platform '${value}' (use watch or ios)`);
}

const PLATFORM_OF = { watchOS: "watchos", iOS: "ios" };

export function parseDevicectl(json) {
  return (json?.result?.devices ?? [])
    .filter((d) => PLATFORM_OF[d.hardwareProperties?.platform])
    .map((d) => ({
      platform: PLATFORM_OF[d.hardwareProperties.platform],
      kind: "device",
      id: d.identifier,
      udid: d.hardwareProperties.udid,
      name: d.deviceProperties?.name ?? d.identifier,
      os: d.deviceProperties?.osVersionNumber,
      model: d.hardwareProperties?.marketingName ?? d.hardwareProperties?.productType,
      connected: d.connectionProperties?.tunnelState === "connected",
      pairing: d.connectionProperties?.pairingState,
      developerMode: d.deviceProperties?.developerModeStatus,
    }));
}

export function parseSimctl(json) {
  const out = [];
  for (const [runtime, devices] of Object.entries(json?.devices ?? {})) {
    const platform = runtime.includes("watchOS") ? "watchos" : runtime.includes(".iOS-") ? "ios" : null;
    if (!platform) continue;
    const osVersion = runtime.split(/(?:watchOS|iOS)-/).pop()?.replace(/-/g, ".");
    for (const d of devices) {
      if (d.isAvailable === false) continue;
      out.push({
        platform,
        kind: "simulator",
        id: d.udid,
        udid: d.udid,
        name: d.name,
        os: osVersion,
        connected: d.state === "Booted",
      });
    }
  }
  return out;
}

export async function listDevices() {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "realtap-")), "devices.json");
  const dc = await run("xcrun", ["devicectl", "list", "devices", "--json-output", tmp, "-q"], { timeoutMs: 30_000 });
  let physical = [];
  if (dc.code === 0) {
    try {
      physical = parseDevicectl(JSON.parse(fs.readFileSync(tmp, "utf8")));
    } catch {}
  }
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });

  const sc = await run("xcrun", ["simctl", "list", "devices", "available", "-j"], { timeoutMs: 30_000 });
  let sims = [];
  if (sc.code === 0) {
    try {
      sims = parseSimctl(JSON.parse(sc.stdout));
    } catch {}
  }
  return [...physical, ...sims];
}

/**
 * Pick a device by id, UDID or (case-insensitive) name; a selector wins over `platform`.
 * Without a selector, prefer a connected physical device of `platform` (default: watchos),
 * or a booted simulator with `simulator: true`.
 */
export function pickDevice(devices, selector, { simulator = false, platform } = {}) {
  if (selector) {
    const s = selector.toLowerCase();
    const hit =
      devices.find((d) => d.id.toLowerCase() === s || d.udid.toLowerCase() === s) ??
      devices.find((d) => d.name.toLowerCase() === s) ??
      devices.find((d) => d.name.toLowerCase().includes(s));
    if (!hit) throw new Error(`no device matches '${selector}'. Run 'realtap devices'.`);
    return hit;
  }
  const want = normalizePlatform(platform) ?? "watchos";
  const label = PLATFORMS[want];
  const flag = want === "ios" ? " --platform ios" : "";
  const pool = devices.filter((d) => d.platform === want && (simulator ? d.kind === "simulator" : d.kind === "device"));
  const hit = pool.find((d) => d.connected) ?? (simulator ? undefined : pool[0]);
  if (!hit) {
    throw new Error(
      simulator
        ? `no booted ${label} simulator. Boot one (xcrun simctl boot <udid>) or pass --device.`
        : `no physical ${label} visible to Xcode. Run 'realtap doctor${flag}'.`,
    );
  }
  return hit;
}

/**
 * Resolve the target from explicit options plus saved config. An explicit `platform`
 * ignores a saved default device (which may belong to the other platform).
 */
export function selectDevice(devices, { device, platform, simulator } = {}, cfg = {}) {
  const selector = device ?? (platform ? undefined : cfg.device);
  return pickDevice(devices, selector, { simulator, platform: platform ?? cfg.platform });
}

export async function resolveDevice(opts, cfg) {
  return selectDevice(await listDevices(), opts, cfg);
}
