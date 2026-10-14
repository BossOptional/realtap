import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs, toCommand } from "../src/cli.js";
import { newId, send } from "../src/client.js";
import { runnerContainer } from "../src/config.js";
import { normalizePlatform, parseDevicectl, parseSimctl, pickDevice, selectDevice } from "../src/devices.js";
import { analyzeLog } from "../src/session.js";

const cmd = (argv) => {
  const { pos, opt } = parseArgs(argv);
  return toCommand(pos.shift(), pos, opt);
};

test("cli maps verbs and selectors to runner commands", () => {
  assert.deepEqual(cmd(["tap", "--target", "watch.settings", "-s"]), { op: "tap", target: "watch.settings", screenshot: true });
  assert.deepEqual(cmd(["tap", "--x", "104", "--y", "81"]), { op: "tap", x: 104, y: 81 });
  assert.deepEqual(cmd(["long-press", "--label", "Row 1", "--duration", "2"]), { op: "longPress", label: "Row 1", duration: 2 });
  assert.deepEqual(cmd(["swipe", "left", "--elements"]), { op: "swipe", dir: "left", elements: true });
  assert.deepEqual(cmd(["crown", "-1.5"]), { op: "crown", delta: -1.5 });
  assert.deepEqual(cmd(["wait-for", "--target", "x", "--gone", "--timeout", "3"]), { op: "waitFor", target: "x", timeout: 3, gone: true });
  assert.deepEqual(cmd(["launch", "com.example.app", "--arg", "-UITest", "--env", "A=b=c"]), {
    op: "launch", bundleId: "com.example.app", args: ["-UITest"], env: { A: "b=c" },
  });
  assert.deepEqual(cmd(["screenshot", "--no-screenshot"]), { op: "screenshot", screenshot: false });
  assert.deepEqual(cmd(["send", '{"op":"ping"}']), { op: "ping" });
  assert.equal(cmd(["bogus"]), null);
  assert.throws(() => cmd(["swipe", "sideways"]), /direction/);
});

test("cli maps the iOS-only verbs", () => {
  assert.deepEqual(cmd(["type", "hello world", "--target", "fixture.input"]), { op: "type", text: "hello world", target: "fixture.input" });
  assert.deepEqual(cmd(["type", "abc", "-s"]), { op: "type", text: "abc", screenshot: true });
  assert.deepEqual(cmd(["button", "volumeUp"]), { op: "button", name: "volumeUp" });
  assert.deepEqual(cmd(["pinch", "--scale", "0.5", "--target", "map"]), { op: "pinch", target: "map", scale: 0.5 });
  assert.deepEqual(cmd(["orientation", "landscapeLeft"]), { op: "orientation", value: "landscapeLeft" });
  assert.throws(() => cmd(["type"]), /text/);
  assert.throws(() => cmd(["button", "power"]), /name/);
  assert.throws(() => cmd(["orientation", "sideways"]), /portrait/);
});

test("platform names normalize and runner bundles stay platform-specific", () => {
  assert.equal(normalizePlatform("Watch"), "watchos");
  assert.equal(normalizePlatform("iPhone"), "ios");
  assert.equal(normalizePlatform(undefined), undefined);
  assert.throws(() => normalizePlatform("tv"), /unknown platform/);
  assert.equal(runnerContainer("com.example.qa", "watchos"), "com.example.qa.runner.xctrunner");
  assert.equal(runnerContainer("com.example.qa", "ios"), "com.example.qa.ios.runner.xctrunner");
  assert.equal(runnerContainer("com.example.qa"), "com.example.qa.runner.xctrunner");
});

test("command ids sort in send order", () => {
  const ids = [newId(1000), newId(1000), newId(999_999), newId(1_700_000_000_000)];
  assert.deepEqual([...ids].sort(), ids);
});

const devicectlFixture = {
  result: {
    devices: [
      {
        identifier: "PHONE",
        hardwareProperties: { platform: "iOS", udid: "P1" },
        deviceProperties: { name: "Metal", osVersionNumber: "26.6.2", developerModeStatus: "enabled" },
        connectionProperties: { tunnelState: "disconnected", pairingState: "paired" },
      },
      { identifier: "TV", hardwareProperties: { platform: "tvOS", udid: "T1" }, deviceProperties: { name: "Living room" } },
      {
        identifier: "FA9A",
        hardwareProperties: { platform: "watchOS", udid: "00008310-ABC", marketingName: "Apple Watch Series 11" },
        deviceProperties: { name: "Test Watch", osVersionNumber: "26.6", developerModeStatus: "enabled" },
        connectionProperties: { tunnelState: "connected", pairingState: "paired" },
      },
    ],
  },
};
const simctlFixture = {
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
      { udid: "IOS", name: "iPhone 17e", state: "Booted", isAvailable: true },
      { udid: "IOS2", name: "iPhone 17 Pro", state: "Shutdown", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.tvOS-26-0": [{ udid: "TVS", name: "Apple TV", state: "Booted", isAvailable: true }],
    "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
      { udid: "S1", name: "Apple Watch Series 11 (46mm)", state: "Booted", isAvailable: true },
      { udid: "S2", name: "Apple Watch SE 3 (40mm)", state: "Shutdown", isAvailable: true },
    ],
  },
};

test("device discovery keeps watches and iPhones, tagged by platform", () => {
  const devices = [...parseDevicectl(devicectlFixture), ...parseSimctl(simctlFixture)];
  assert.deepEqual(devices.map((d) => `${d.platform}:${d.udid}`), [
    "ios:P1", "watchos:00008310-ABC", "ios:IOS", "ios:IOS2", "watchos:S1", "watchos:S2",
  ]);
  assert.equal(devices.find((d) => d.udid === "00008310-ABC").connected, true);
  assert.equal(devices.find((d) => d.udid === "S1").os, "26.0");
  assert.equal(devices.find((d) => d.udid === "IOS").os, "26.0");

  // default platform stays the watch (backward compatible)
  assert.equal(pickDevice(devices).udid, "00008310-ABC");
  assert.equal(pickDevice(devices, undefined, { simulator: true }).udid, "S1");
  // explicit platform
  assert.equal(pickDevice(devices, undefined, { platform: "ios" }).udid, "P1");
  assert.equal(pickDevice(devices, undefined, { platform: "iphone", simulator: true }).udid, "IOS");
  // selectors win over platform
  assert.equal(pickDevice(devices, "se 3").udid, "S2");
  assert.equal(pickDevice(devices, "metal", { platform: "watch" }).udid, "P1");
  assert.equal(pickDevice(devices, "fa9a").udid, "00008310-ABC");
  assert.throws(() => pickDevice(devices, "nope"), /no device matches/);
  assert.throws(() => pickDevice([], undefined), /Apple Watch.*doctor/);
  assert.throws(() => pickDevice([], undefined, { platform: "ios" }), /iPhone\/iPad.*--platform ios/);
  assert.throws(() => pickDevice([], undefined, { platform: "ios", simulator: true }), /iPhone\/iPad simulator/);
});

test("an explicit platform ignores a saved default device of the other platform", () => {
  const devices = [...parseDevicectl(devicectlFixture), ...parseSimctl(simctlFixture)];
  const cfg = { device: "00008310-ABC", platform: undefined };
  assert.equal(selectDevice(devices, {}, cfg).udid, "00008310-ABC");
  assert.equal(selectDevice(devices, { platform: "ios" }, cfg).udid, "P1");
  assert.equal(selectDevice(devices, { device: "iphone 17e" }, cfg).udid, "IOS");
  assert.equal(selectDevice(devices, {}, { platform: "ios" }).udid, "P1");
});

test("log analysis surfaces actionable hints", () => {
  const locked = analyzeLog('Error Domain=com.apple.dt.deviceprep Code=-3 "Unlock Test Apple Watch to Continue"');
  assert.match(locked.hints[0], /locked/);
  const done = analyzeLog("x.swift:3: error: -[RunnerTests testSelftest] : failed\n** TEST EXECUTE FAILED **\n");
  assert.equal(done.finished, "FAILED");
  assert.equal(done.errors.length, 1);
  const automation = analyzeLog("Testing failed:\n\tRunner encountered an error (The test runner failed to initialize for UI testing. (Underlying Error: Timed out while enabling automation mode.))");
  assert.match(automation.hints[0], /Enable UI Automation/);
  assert.match(analyzeLog("COMMAND_FAILED: Developer mode is disabled for Apple development tools").hints.join(), /DevToolsSecurity/);
  assert.deepEqual(analyzeLog("all good").hints, []);
});

/** In-memory container plus a fake runner that answers commands like the real one. */
class FakeChannel {
  constructor({ dropPushes = 0 } = {}) {
    this.files = new Map();
    this.dropPushes = dropPushes;
    this.pushes = 0;
  }
  async push(local, remote) {
    this.pushes++;
    if (this.dropPushes-- > 0) return false;
    this.files.set(remote, fs.readFileSync(local));
    queueMicrotask(() => this.#runner());
    return true;
  }
  async pull(remote, local) {
    if (!this.files.has(remote)) return false;
    fs.writeFileSync(local, this.files.get(remote));
    return true;
  }
  #runner() {
    for (const [p, data] of this.files) {
      if (!p.startsWith("Documents/inbox/")) continue;
      this.files.delete(p);
      const c = JSON.parse(data);
      const res = { id: c.id, op: c.op, ok: c.op !== "fail", ...(c.op === "fail" && { error: "boom" }) };
      if (c.screenshot) (this.files.set(`Documents/outbox/${c.id}.png`, Buffer.from("PNG")), (res.has_png = true));
      if (c.op !== "hang") this.files.set(`Documents/outbox/${c.id}.json`, Buffer.from(JSON.stringify(res)));
    }
  }
}

test("send delivers a command and collects result + screenshot", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "watchqa-test-"));
  const ch = new FakeChannel({ dropPushes: 1 });
  const res = await send(ch, { op: "tap", target: "a", screenshot: true }, { outDir: out, pollMs: 5 });
  assert.equal(res.ok, true);
  assert.equal(ch.pushes, 2, "retried the dropped push");
  assert.equal(fs.readFileSync(res.screenshot, "utf8"), "PNG");
  assert.equal(res.has_png, undefined);
  assert.equal((await send(ch, { op: "fail" }, { pollMs: 5 })).error, "boom");
});

test("send reports undeliverable commands and timeouts", async () => {
  const dead = await send(new FakeChannel({ dropPushes: 99 }), { op: "ping" }, { pollMs: 5 });
  assert.match(dead.error, /could not deliver/);
  const hung = await send(new FakeChannel(), { op: "hang" }, { timeoutMs: 50, pollMs: 5 });
  assert.match(hung.error, /no result/);
});

test("mcp server exposes the device tools", async () => {
  const { createServer } = await import("../src/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ["device_list", "device_start", "device_tap", "device_crown", "device_type", "device_button", "device_pinch", "device_orientation", "device_screenshot", "device_elements"]) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(names.filter((n) => n.startsWith("watch_")).length, 0, "no leftover watch_* names");
  const tap = tools.find((t) => t.name === "device_tap");
  assert.ok(tap.inputSchema.properties.target);
  assert.ok(tap.inputSchema.properties.platform, "every tool can pick a platform");
  await client.close();
});

test("simulator channel follows the runner's data container when it moves", async () => {
  const { SimulatorChannel } = await import("../src/channel.js");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "watchqa-sim-"));
  const dirs = [path.join(base, "old"), path.join(base, "new")];
  for (const d of dirs) fs.mkdirSync(path.join(d, "Documents"), { recursive: true });
  fs.writeFileSync(path.join(dirs[0], "Documents", "ready.json"), '{"session":"old"}');
  fs.writeFileSync(path.join(dirs[1], "Documents", "ready.json"), '{"session":"new"}');
  let current = 0;
  const exec = async () => ({ code: 0, stdout: dirs[current] + "\n", stderr: "" });
  const ch = new SimulatorChannel({ udid: "U" }, "c", { exec, ttlMs: 0 });
  const out = path.join(base, "out.json");
  assert.equal(await ch.pull("Documents/ready.json", out), true);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).session, "old");
  current = 1; // runner reinstalled: container moved
  assert.equal(await ch.pull("Documents/ready.json", out), true);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).session, "new");
  const src = path.join(base, "cmd.json");
  fs.writeFileSync(src, "{}");
  assert.equal(await ch.push(src, "Documents/inbox/1.json"), true);
  assert.ok(fs.existsSync(path.join(dirs[1], "Documents", "inbox", "1.json")));
  assert.ok(!fs.existsSync(path.join(dirs[1], "Documents", "inbox", "1.json.partial")));
});
