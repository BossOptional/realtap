import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePlatform } from "./devices.js";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECT = path.join(PACKAGE_ROOT, "runner", "RealTap.xcodeproj");
export const RUNNER_SOURCES = path.join(PACKAGE_ROOT, "runner");

const CONFIG_DIR = process.env.REALTAP_CONFIG_DIR ?? path.join(os.homedir(), ".config", "realtap");
const CACHE_DIR = process.env.REALTAP_CACHE_DIR ?? path.join(os.homedir(), ".cache", "realtap");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/**
 * Persistent settings:
 *   team          Apple developer team id used for automatic signing (physical watch only)
 *   bundlePrefix  bundle id of the host app; the runner is `<prefix>.runner`
 *   device        default device (CoreDevice id, UDID or name)
 *   platform      default platform when no device is named: watch (default) or ios
 */
export function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {}
  const cfg = {
    team: process.env.REALTAP_TEAM ?? file.team,
    bundlePrefix: process.env.REALTAP_BUNDLE_PREFIX ?? file.bundlePrefix,
    device: process.env.REALTAP_DEVICE ?? file.device,
    platform: normalizePlatform(process.env.REALTAP_PLATFORM ?? file.platform),
  };
  if (!cfg.bundlePrefix) cfg.bundlePrefix = cfg.team ? `dev.realtap.${cfg.team.toLowerCase()}` : "dev.realtap.local";
  return cfg;
}

export function saveConfig(patch) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {}
  const next = { ...file };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n");
  return { file: CONFIG_FILE, config: next };
}

/**
 * The XCUITest runner app's bundle id, which owns the data container we exchange files with.
 * watchOS: <prefix>.runner  ·  iOS: <prefix>.ios.runner (must match runner/generate_project.py).
 */
export const runnerContainer = (bundlePrefix, platform = "watchos") =>
  platform === "ios" ? `${bundlePrefix}.ios.runner.xctrunner` : `${bundlePrefix}.runner.xctrunner`;

export function stateDir(device) {
  const dir = path.join(CACHE_DIR, "devices", device.udid);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function derivedDataDir(device) {
  const sim = device.kind === "simulator";
  const sdk = device.platform === "ios" ? (sim ? "iphonesimulator" : "iphoneos") : sim ? "watchsimulator" : "watchos";
  return path.join(CACHE_DIR, "build", sdk);
}

export function defaultOutDir() {
  return process.env.REALTAP_OUT ?? path.join(process.cwd(), "realtap-out");
}
