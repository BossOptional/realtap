import fs from "node:fs";
import path from "node:path";
import { run } from "./exec.js";

/**
 * File access to the runner's data container. Paths are relative to the
 * container root, e.g. "Documents/inbox/<id>.json".
 *
 * push(localFile, remotePath) / pull(remotePath, localFile) resolve to true/false.
 */

/** Physical watch: files travel over the CoreDevice tunnel. */
export class DeviceChannel {
  constructor(device, container, { exec = run } = {}) {
    this.device = device;
    this.container = container;
    this.exec = exec;
  }

  async #copy(direction, source, destination) {
    const res = await this.exec(
      "xcrun",
      [
        "devicectl", "device", "copy", direction,
        "--device", this.device.id,
        "--domain-type", "appDataContainer",
        "--domain-identifier", this.container,
        "--source", source,
        "--destination", destination,
        "-q",
      ],
      { timeoutMs: 30_000 },
    );
    return res.code === 0;
  }

  push(localFile, remotePath) {
    return this.#copy("to", localFile, remotePath);
  }

  pull(remotePath, localFile) {
    return this.#copy("from", remotePath, localFile);
  }
}

/**
 * Simulator: the container is a directory on this Mac. Every test run reinstalls the
 * runner and may move its data container, so the path is only cached very briefly.
 */
export class SimulatorChannel {
  constructor(device, container, { exec = run, ttlMs = 1000 } = {}) {
    this.device = device;
    this.container = container;
    this.exec = exec;
    this.ttlMs = ttlMs;
    this.root = null;
    this.resolvedAt = 0;
  }

  async #root() {
    if (this.root && Date.now() - this.resolvedAt < this.ttlMs) return this.root;
    const res = await this.exec("xcrun", ["simctl", "get_app_container", this.device.udid, this.container, "data"]);
    this.root = res.code === 0 ? res.stdout.trim() : null;
    this.resolvedAt = Date.now();
    return this.root;
  }

  async push(localFile, remotePath) {
    const root = await this.#root();
    if (!root) return false;
    const dest = path.join(root, remotePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Write-then-rename so the runner never sees a partial command.
    fs.copyFileSync(localFile, dest + ".partial");
    fs.renameSync(dest + ".partial", dest);
    return true;
  }

  async pull(remotePath, localFile) {
    const root = await this.#root();
    if (!root) return false;
    try {
      fs.copyFileSync(path.join(root, remotePath), localFile);
      return true;
    } catch {
      return false;
    }
  }
}

export function channelFor(device, container, opts) {
  return device.kind === "simulator" ? new SimulatorChannel(device, container, opts) : new DeviceChannel(device, container, opts);
}
