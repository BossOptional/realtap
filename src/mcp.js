import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { defaultOutDir, loadConfig } from "./config.js";
import { listDevices, selectDevice } from "./devices.js";
import * as session from "./session.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const target = {
  platform: z.enum(["watch", "ios"]).optional().describe("Which kind of device when none is named: Apple Watch (default) or an iPhone/iPad."),
  device: z.string().optional().describe("Device name, CoreDevice id or UDID (see device_list). Default: the connected physical device of `platform` (or REALTAP_DEVICE)."),
  simulator: z.boolean().optional().describe("Use a booted simulator instead of a physical device."),
};
const selector = {
  target: z.string().optional().describe("Accessibility identifier (preferred)."),
  label: z.string().optional().describe("Exact accessibility label."),
  predicate: z.string().optional().describe('NSPredicate, e.g. label BEGINSWITH "Hi"'),
  type: z.string().optional().describe("Element type filter: button, staticText, cell, switch, …"),
  index: z.number().int().optional().describe("Pick the Nth match (0-based)."),
  timeout: z.number().optional().describe("Seconds to wait for the element (default 5)."),
};
const point = {
  x: z.number().optional().describe("X in points from the app's top-left (use with y)."),
  y: z.number().optional(),
  nx: z.number().optional().describe("Normalized X 0..1 (use with ny)."),
  ny: z.number().optional(),
};
const attach = {
  screenshot: z.boolean().optional().describe("Return a screenshot taken after the action."),
  elements: z.boolean().optional().describe("Return the compact element list after the action."),
  settle: z.number().optional().describe("Extra seconds to wait after the action before capturing."),
};

let deviceCache = { at: 0, devices: [] };
async function resolve(args) {
  if (Date.now() - deviceCache.at > 30_000) deviceCache = { at: Date.now(), devices: await listDevices() };
  const cfg = loadConfig();
  return { cfg, device: selectDevice(deviceCache.devices, args, cfg) };
}

function strip(args, keys) {
  const out = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined && !keys.includes(k)) out[k] = v;
  return out;
}

function reply(result) {
  const content = [];
  const { screenshot, ...rest } = result;
  content.push({ type: "text", text: JSON.stringify(rest, null, 2) });
  if (screenshot && fs.existsSync(screenshot)) {
    content.push({ type: "image", data: fs.readFileSync(screenshot).toString("base64"), mimeType: "image/png" });
    content.push({ type: "text", text: `screenshot saved: ${screenshot}` });
  }
  return { content, isError: result.ok === false };
}

const fail = (err) => ({ content: [{ type: "text", text: String(err?.message ?? err) }], isError: true });

function tool(server, name, description, shape, toCmd) {
  server.registerTool(name, { description, inputSchema: { ...target, ...shape } }, async (args) => {
    try {
      const { cfg, device } = await resolve(args);
      const cmd = toCmd(strip(args, ["device", "simulator", "platform"]));
      const timeoutMs = ((cmd.timeout ?? 0) + (cmd.seconds ?? 0)) * 1000 + 60_000;
      return reply(await session.command(device, cfg, cmd, { outDir: defaultOutDir(), timeoutMs }));
    } catch (err) {
      return fail(err);
    }
  });
}

export function createServer() {
  const server = new McpServer({ name: "realtap", version: pkg.version });

  server.registerTool("device_list", { description: "List Apple Watches and iPhones/iPads (physical and simulators) visible to Xcode.", inputSchema: {} }, async () => {
    try {
      deviceCache = { at: Date.now(), devices: await listDevices() };
      return { content: [{ type: "text", text: JSON.stringify(deviceCache.devices, null, 2) }] };
    } catch (err) {
      return fail(err);
    }
  });

  server.registerTool(
    "device_start",
    {
      description: "Build (if needed) and start the on-device runner. Other tools auto-start it, but call this first to surface setup problems (locked device, signing). The device must stay unlocked (a watch: worn).",
      inputSchema: { ...target, rebuild: z.boolean().optional(), ttl: z.number().optional().describe("Runner lifetime in seconds (default 3600).") },
    },
    async (args) => {
      try {
        const { cfg, device } = await resolve(args);
        const notes = [];
        const res = await session.start(device, cfg, { ttlS: args.ttl ?? 3600, rebuild: args.rebuild, onProgress: (m) => notes.push(m) });
        return { content: [{ type: "text", text: JSON.stringify({ ...res, notes }, null, 2) }] };
      } catch (err) {
        return fail(err);
      }
    },
  );

  for (const [name, fn, description] of [
    ["device_status", session.status, "Runner state: running, ready, screen size (points), heartbeat, setup hints."],
    ["device_stop", session.stop, "Stop the on-device runner."],
  ]) {
    server.registerTool(name, { description, inputSchema: target }, async (args) => {
      try {
        const { cfg, device } = await resolve(args);
        return { content: [{ type: "text", text: JSON.stringify(await fn(device, cfg), null, 2) }] };
      } catch (err) {
        return fail(err);
      }
    });
  }

  tool(server, "device_launch", "Launch (restart) an app by bundle id; omit bundleId for the bundled fixture app.",
    { bundleId: z.string().optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), ...attach },
    (a) => ({ op: "launch", ...a }));
  tool(server, "device_activate", "Bring an app to the foreground without relaunching it.",
    { bundleId: z.string().optional(), ...attach }, (a) => ({ op: "activate", ...a }));
  tool(server, "device_terminate", "Terminate the current target app.", {}, () => ({ op: "terminate" }));
  tool(server, "device_tap", "Tap an element (by identifier/label/predicate) or a point. gesture: tap | doubleTap | longPress.",
    { ...selector, ...point, gesture: z.enum(["tap", "doubleTap", "longPress"]).optional(), duration: z.number().optional().describe("longPress seconds"), ...attach },
    ({ gesture, ...a }) => ({ op: gesture ?? "tap", ...a }));
  tool(server, "device_swipe", "Swipe on the app (or on a selected element).",
    { dir: z.enum(["up", "down", "left", "right"]), ...selector, ...attach }, (a) => ({ op: "swipe", ...a }));
  tool(server, "device_crown", "watchOS only: rotate the Digital Crown. Positive delta scrolls content down / next page.",
    { delta: z.number().describe("Rotation amount, ~1.0 per notch group; try 0.5–3."), ...attach }, (a) => ({ op: "crown", ...a }));
  tool(server, "device_home", "Go to the home screen (watch: press the Digital Crown; iPhone: Home).", attach, (a) => ({ op: "home", ...a }));
  tool(server, "device_type", "iOS only: type text. With a selector, taps that field first; without, types into the focused element.",
    { text: z.string(), ...selector, ...attach }, (a) => ({ op: "type", ...a }));
  tool(server, "device_button", "iOS only: press a hardware button.",
    { name: z.enum(["home", "volumeUp", "volumeDown"]), ...attach }, (a) => ({ op: "button", ...a }));
  tool(server, "device_pinch", "iOS only: pinch the app or an element (scale > 1 zooms in, < 1 zooms out).",
    { scale: z.number().optional(), velocity: z.number().optional(), ...selector, ...attach }, (a) => ({ op: "pinch", ...a }));
  tool(server, "device_orientation", "iOS only: rotate the device.",
    { value: z.enum(["portrait", "portraitUpsideDown", "landscapeLeft", "landscapeRight"]), ...attach }, (a) => ({ op: "orientation", ...a }));
  tool(server, "device_wait_for", "Wait until an element exists (or is gone).",
    { ...selector, gone: z.boolean().optional(), ...attach }, (a) => ({ op: "waitFor", ...a }));
  tool(server, "device_find", "Check whether an element exists and return its frame/label.", selector, (a) => ({ op: "find", ...a }));
  tool(server, "device_screenshot", "Capture the device screen.", {}, () => ({ op: "screenshot", screenshot: true }));
  tool(server, "device_elements", "Compact list of accessible elements (type, id, label, value, frame in points).", { screenshot: attach.screenshot },
    (a) => ({ op: "elements", elements: true, ...a }));
  tool(server, "device_tree", "Raw XCUITest accessibility tree (saved to a file; path returned).", {}, () => ({ op: "tree", tree: true }));
  tool(server, "device_app_state", "State of the current target app (foreground/background/notRunning).", {}, () => ({ op: "state" }));

  return server;
}

export async function serve() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
