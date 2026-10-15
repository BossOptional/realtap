import os from "node:os";
import { defaultOutDir, loadConfig, saveConfig } from "./config.js";
import { PLATFORMS, listDevices, normalizePlatform, selectDevice } from "./devices.js";
import { run } from "./exec.js";
import * as session from "./session.js";

const USAGE = `realtap — drive an Apple Watch or iPhone/iPad (physical or simulator) via an XCUITest runner

Setup
  realtap devices                       list watches and iPhones/iPads visible to Xcode
  realtap doctor                        check prerequisites and explain what is missing
  realtap setup --team TEAMID [--bundle-prefix com.example.realtap] [--device NAME|ID] [--platform watch|ios]
  realtap build | start [--ttl 3600] [--rebuild] | stop | status | selftest

Commands (auto-start the runner)
  realtap launch [BUNDLE_ID] [--arg A]... [--env K=V]...
  realtap activate [BUNDLE_ID] | terminate | state | home
  realtap tap        SELECTOR | --x X --y Y | --nx 0.5 --ny 0.5
  realtap double-tap SELECTOR | point
  realtap long-press SELECTOR | point [--duration 1]
  realtap swipe up|down|left|right [SELECTOR]
  realtap wait SECONDS
  realtap wait-for SELECTOR [--timeout 10] [--gone]
  realtap find SELECTOR
  realtap screenshot | elements | tree
  realtap send '{"op":"tap","target":"id"}'
  watchOS only:  realtap crown DELTA            rotate the Digital Crown (positive scrolls down)
  iOS only:      realtap type TEXT [SELECTOR]   type (taps the field first when a selector is given)
                 realtap button home|volumeUp|volumeDown
                 realtap pinch [SELECTOR] [--scale 2] [--velocity 1]
                 realtap orientation portrait|portraitUpsideDown|landscapeLeft|landscapeRight

  SELECTOR: --target ACCESSIBILITY_ID | --label TEXT | --predicate 'label BEGINSWITH "Hi"'
            [--type button] [--index N] [--timeout S]

Options
  --platform watch|ios pick the kind of device (default: watch, or the saved default)
  --device NAME|ID     pick a device by name, CoreDevice id or UDID (implies its platform)
  --simulator          use a booted simulator of that platform
  -s, --screenshot     attach a screenshot to the result (saved under --out)
  --elements           attach a compact element list
  --tree               attach the raw accessibility tree (saved under --out)
  --settle S           extra wait after the action
  --out DIR            where screenshots/trees go (default ./realtap-out)
`;

const BOOL = new Set(["simulator", "screenshot", "elements", "tree", "gone", "rebuild", "json", "help"]);
const NUM = new Set(["x", "y", "nx", "ny", "index", "timeout", "duration", "settle", "ttl", "delta", "seconds", "scale", "velocity"]);
const MULTI = new Set(["arg", "env"]);
const ALIAS = { s: "screenshot", h: "help" };

export function parseArgs(argv) {
  const pos = [];
  const opt = { arg: [], env: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-") || /^-\d/.test(a)) {
      pos.push(a);
      continue;
    }
    let [key, val] = a.replace(/^--?/, "").split(/=(.*)/s, 2);
    key = ALIAS[key] ?? key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key.startsWith("no") && BOOL.has(key[2]?.toLowerCase() + key.slice(3))) {
      opt[key[2].toLowerCase() + key.slice(3)] = false;
      continue;
    }
    if (BOOL.has(key)) {
      opt[key] = val === undefined ? true : val !== "false";
      continue;
    }
    if (val === undefined) val = argv[++i];
    if (val === undefined) throw new Error(`--${key} needs a value`);
    if (MULTI.has(key)) opt[key].push(val);
    else opt[key] = NUM.has(key) ? Number(val) : val;
  }
  return { pos, opt };
}

const SELECTOR_KEYS = ["target", "label", "predicate", "type", "index", "timeout", "x", "y", "nx", "ny"];

/** Translate CLI words into a runner command (see PROTOCOL.md). */
export function toCommand(verb, pos, opt) {
  const pick = (keys) => Object.fromEntries(keys.filter((k) => opt[k] !== undefined).map((k) => [k, opt[k]]));
  const sel = pick(SELECTOR_KEYS);
  let cmd;
  switch (verb) {
    case "launch":
    case "activate":
      cmd = { op: verb, ...(pos[0] && { bundleId: pos[0] }) };
      if (verb === "launch" && opt.arg.length) cmd.args = opt.arg;
      if (verb === "launch" && opt.env.length) cmd.env = Object.fromEntries(opt.env.map((kv) => kv.split(/=(.*)/s, 2)));
      break;
    case "terminate":
    case "state":
    case "home":
    case "ping":
      cmd = { op: verb };
      break;
    case "tap":
    case "find":
      cmd = { op: verb, ...sel };
      break;
    case "double-tap":
      cmd = { op: "doubleTap", ...sel };
      break;
    case "long-press":
      cmd = { op: "longPress", ...sel, ...pick(["duration"]) };
      break;
    case "swipe":
      if (!["up", "down", "left", "right"].includes(pos[0])) throw new Error("swipe needs a direction: up|down|left|right");
      cmd = { op: "swipe", dir: pos[0], ...sel };
      break;
    case "crown":
      cmd = { op: "crown", delta: Number(pos[0] ?? opt.delta ?? 1) };
      break;
    case "type":
      if (pos[0] === undefined) throw new Error("type needs the text to enter");
      cmd = { op: "type", text: pos[0], ...sel };
      break;
    case "button":
      if (!["home", "volumeUp", "volumeDown"].includes(pos[0])) throw new Error("button needs a name: home|volumeUp|volumeDown");
      cmd = { op: "button", name: pos[0] };
      break;
    case "pinch":
      cmd = { op: "pinch", ...sel, ...pick(["scale", "velocity"]) };
      break;
    case "orientation":
      if (!["portrait", "portraitUpsideDown", "landscapeLeft", "landscapeRight"].includes(pos[0])) {
        throw new Error("orientation needs: portrait|portraitUpsideDown|landscapeLeft|landscapeRight");
      }
      cmd = { op: "orientation", value: pos[0] };
      break;
    case "wait":
      cmd = { op: "wait", seconds: Number(pos[0] ?? opt.seconds ?? 1) };
      break;
    case "wait-for":
      cmd = { op: "waitFor", ...sel, ...(opt.gone && { gone: true }) };
      break;
    case "screenshot":
      cmd = { op: "screenshot", screenshot: true };
      break;
    case "elements":
      cmd = { op: "elements", elements: true };
      break;
    case "tree":
      cmd = { op: "tree", tree: true };
      break;
    case "send":
      cmd = JSON.parse(pos[0] ?? "{}");
      break;
    default:
      return null;
  }
  if (opt.screenshot !== undefined) cmd.screenshot = opt.screenshot;
  if (opt.elements !== undefined) cmd.elements = opt.elements;
  if (opt.tree !== undefined) cmd.tree = opt.tree;
  if (opt.settle !== undefined) cmd.settle = opt.settle;
  return cmd;
}

const print = (obj) => console.log(JSON.stringify(obj, null, 2));
const progress = (msg) => console.error(`realtap: ${msg}`);

async function doctor(cfg, opt) {
  const checks = [];
  const add = (ok, what, fix, { warn = false } = {}) =>
    checks.push({ ok, what, ...(warn && !ok && { level: "warning" }), ...(fix && !ok && { fix }) });
  const xc = await run("xcodebuild", ["-version"]);
  add(xc.code === 0, xc.code === 0 ? xc.stdout.split("\n")[0] : "Xcode command line tools", "install Xcode and run xcode-select -s /Applications/Xcode.app");
  const devices = await listDevices();
  const platform = normalizePlatform(opt.platform) ?? cfg.platform ?? "watchos";
  const label = PLATFORMS[platform];
  const physical = devices.filter((d) => d.kind === "device" && d.platform === platform);
  add(physical.length > 0, `physical ${label} devices visible to Xcode: ${physical.map((w) => w.name).join(", ") || "none"}`,
    platform === "watchos"
      ? "pair the watch with an iPhone connected to this Mac, open Xcode > Window > Devices and Simulators, keep the watch unlocked on the same Wi-Fi"
      : "connect the device by USB (or Wi-Fi), unlock it, trust this Mac, and open Xcode > Window > Devices and Simulators",
    { warn: Boolean(opt.simulator) });
  let device;
  try {
    device = selectDevice(devices, { device: opt.device, platform: opt.platform, simulator: opt.simulator }, cfg);
  } catch (e) {
    add(false, "target device", e.message);
  }
  if (device) {
    add(true, `target: ${device.name} (${device.platform} ${device.kind}, OS ${device.os ?? "?"})`);
    if (device.kind === "device") {
      add(device.pairing === "paired", `paired with this Mac: ${device.pairing ?? "unknown"}`, "open Xcode > Window > Devices and Simulators with the device unlocked and trust this Mac");
      add(device.connected, `CoreDevice tunnel: ${device.connected ? "connected" : "idle (connects on demand)"}`,
        "if commands fail to deliver: unlock the device, keep it connected (a watch: near its iPhone, same Wi-Fi as the Mac)", { warn: true });
      add(device.developerMode === "enabled", `Developer Mode: ${device.developerMode ?? "unknown"}`, "device Settings > Privacy & Security > Developer Mode");
      add(Boolean(cfg.team), `signing team: ${cfg.team ?? "not set"}`, "realtap setup --team <TEAMID>");
    }
    add(session.isBuilt(device, cfg), "runner built for current sources", "realtap build");
  }
  const tun = Object.values(os.networkInterfaces()).flat().some((i) => i?.address?.startsWith("198.18."));
  if (tun) add(false, "a TUN/proxy interface (198.18.x.x) is active", "if the device is not discovered, disable the proxy's TUN/enhanced mode", { warn: true });
  return { ok: checks.every((c) => c.ok || c.level === "warning"), bundlePrefix: cfg.bundlePrefix, checks };
}

export async function main(argv) {
  const { pos, opt } = parseArgs(argv);
  const verb = pos.shift();
  if (!verb || opt.help || verb === "help") {
    console.log(USAGE);
    return 0;
  }
  const cfg = loadConfig();
  if (verb === "setup") {
    const res = saveConfig({ team: opt.team, bundlePrefix: opt.bundlePrefix, device: opt.device, platform: normalizePlatform(opt.platform) });
    print({ ...res, effective: loadConfig() });
    return 0;
  }
  if (verb === "devices") {
    print(await listDevices());
    return 0;
  }
  if (verb === "doctor") {
    const res = await doctor(cfg, opt);
    print(res);
    return res.ok ? 0 : 1;
  }

  const device = selectDevice(await listDevices(), { device: opt.device, platform: opt.platform, simulator: opt.simulator }, cfg);
  const outDir = opt.out ?? defaultOutDir();
  switch (verb) {
    case "build":
      print(await session.build(device, cfg, { onProgress: progress }));
      return 0;
    case "start":
      print(await session.start(device, cfg, { ttlS: opt.ttl ?? 3600, rebuild: opt.rebuild, onProgress: progress }));
      return 0;
    case "stop":
      print(await session.stop(device, cfg));
      return 0;
    case "status":
      print(await session.status(device, cfg));
      return 0;
    case "selftest": {
      const res = await session.selftest(device, cfg, { onProgress: progress });
      print(res);
      return res.passed ? 0 : 1;
    }
  }
  const cmd = toCommand(verb, pos, opt);
  if (!cmd) {
    console.error(`unknown command '${verb}'\n\n${USAGE}`);
    return 2;
  }
  const res = await session.command(device, cfg, cmd, { outDir, onProgress: progress, timeoutMs: (opt.timeout ?? 0) * 1000 + 60_000 });
  print(res);
  return res.ok ? 0 : 1;
}

