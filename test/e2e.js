#!/usr/bin/env node
// End-to-end check against a real runner using the bundled fixture app.
//   node test/e2e.js --simulator                    booted watchOS simulator
//   node test/e2e.js                                physical watch (wear it, keep it unlocked)
//   node test/e2e.js --platform ios --simulator     booted iOS simulator
//   node test/e2e.js --platform ios                 physical iPhone/iPad (unlocked)
//   add --device NAME|UDID to pick a specific one
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { resolveDevice } from "../src/devices.js";
import * as session from "../src/session.js";

const { opt } = parseArgs(process.argv.slice(2));
const cfg = loadConfig();
const device = await resolveDevice({ device: opt.device, platform: opt.platform, simulator: opt.simulator }, cfg);
const outDir = opt.out ?? path.resolve("realtap-out", "e2e", `${device.platform}-${device.kind}`);
fs.rmSync(outDir, { recursive: true, force: true });
const log = (...a) => console.log("[e2e]", ...a);
const ios = device.platform === "ios";

log(`target ${device.name} (${device.platform} ${device.kind})`);
const started = await session.start(device, cfg, { ttlS: 900, onProgress: (m) => log(m) });
log("runner ready", JSON.stringify(started.screen));

const timings = {};
async function step(name, cmd, check, { expectError = false } = {}) {
  const res = await session.command(device, cfg, cmd, { outDir, autostart: false });
  timings[name] = res.roundtrip_ms;
  const status = res.ok !== expectError ? "ok  " : "FAIL";
  log(`${status} ${name} ${res.roundtrip_ms ?? "-"}ms${res.error ? ` (${expectError ? "expected: " : ""}${res.error})` : ""}`);
  if (check) check(res);
  return res;
}
const expectLabel = (id, text) =>
  step(`expect ${text}`, { op: "waitFor", predicate: `identifier == "${id}" AND label == "${text}"`, timeout: 3 }, (r) => assert.ok(r.ok, r.error));
const expectCount = (text) => expectLabel("fixture.count", text);

try {
  await step("ping", { op: "ping" }, (r) => assert.ok(r.ok));
  await step("launch fixture", { op: "launch", screenshot: true }, (r) => {
    assert.ok(r.ok, r.error);
    assert.ok(fs.statSync(r.screenshot).size > 1000, "screenshot is a real PNG");
  });
  await step("tap by id", { op: "tap", target: "fixture.tap" }, (r) => assert.ok(r.ok, r.error));
  await expectCount("Tapped 1");
  const found = await step("find button", { op: "find", target: "fixture.tap" }, (r) => assert.equal(r.exists, true));
  const [x, y, w, h] = found.element.frame;
  await step("tap by point", { op: "tap", x: x + w / 2, y: y + h / 2 }, (r) => assert.ok(r.ok, r.error));
  await expectCount("Tapped 2");
  await step("tap by label", { op: "tap", label: "Tap me" }, (r) => assert.ok(r.ok, r.error));
  await expectCount("Tapped 3");

  if (ios) {
    // Scroll before typing: with the keyboard up a swipe lands on the keys, not the list.
    await step("swipe up", { op: "swipe", dir: "up" }, (r) => assert.ok(r.ok, r.error));
    await step("swipe up again", { op: "swipe", dir: "up" }, (r) => assert.ok(r.ok, r.error));
    await step("list scrolled", { op: "find", target: "fixture.row1" }, (r) => assert.equal(r.element?.hittable ?? false, false, "row1 scrolled out of view"));
    await step("swipe down", { op: "swipe", dir: "down" }, (r) => assert.ok(r.ok, r.error));
    await step("swipe down again", { op: "swipe", dir: "down" }, (r) => assert.ok(r.ok, r.error));
    await step("type into field", { op: "type", text: "hello", target: "fixture.input" }, (r) => assert.ok(r.ok, r.error));
    await expectLabel("fixture.echo", "Typed: hello");
    await step("crown is rejected on iOS", { op: "crown", delta: 1 }, (r) => assert.match(r.error, /only available on watchOS/), { expectError: true });
    await step("landscape", { op: "orientation", value: "landscapeLeft", screenshot: true, settle: 1 }, (r) => assert.ok(r.ok, r.error));
    await step("portrait", { op: "orientation", value: "portrait", settle: 1 }, (r) => assert.ok(r.ok, r.error));
    await step("elements", { op: "elements", elements: true }, (r) => assert.ok(r.elements.some((e) => /^fixture\.row\d+$/.test(e.id ?? ""))));
  } else {
    await step("crown", { op: "crown", delta: 3, settle: 0.5 }, (r) => assert.ok(r.ok, r.error));
    await step("elements", { op: "elements", elements: true }, (r) => {
      assert.ok(r.elements.some((e) => e.id === "fixture.row20"), "row20 present after crown");
    });
    await step("swipe down", { op: "swipe", dir: "down" }, (r) => assert.ok(r.ok, r.error));
    await step("type is rejected on watchOS", { op: "type", text: "x" }, (r) => assert.match(r.error, /only available on iOS/), { expectError: true });
  }

  await step("missing element is an error, runner survives", { op: "tap", target: "nope", timeout: 1 }, (r) => {
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  }, { expectError: true });
  await step("tree", { op: "tree", tree: true }, (r) => assert.match(fs.readFileSync(r.tree_file, "utf8"), /fixture\.row/));
  await step("state", { op: "state" }, (r) => assert.equal(r.state, "foreground"));
  await step("home", { op: "home", screenshot: true, settle: 1 }, (r) => assert.ok(r.ok, r.error));
  log("PASS", JSON.stringify(timings));
} finally {
  await session.stop(device, cfg);
}
