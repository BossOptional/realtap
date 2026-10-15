import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sleep } from "./exec.js";

let seq = 0;

/** Lexically sortable, unique command id (the runner processes inbox in id order). */
export function newId(now = Date.now()) {
  seq = (seq + 1) % 10000;
  return `${String(now).padStart(13, "0")}-${String(seq).padStart(4, "0")}`;
}

async function retry(fn, tries, delayMs = 400) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    if (i + 1 < tries) await sleep(delayMs);
  }
  return false;
}

/**
 * Send one command to the runner and wait for its result.
 *
 * Screenshots / raw trees are copied into `outDir` and referenced as
 * `result.screenshot` / `result.tree_file`.
 */
export async function send(channel, command, { timeoutMs = 60_000, outDir, pollMs = 250 } = {}) {
  const cmd = { ...command, id: command.id ?? newId() };
  const started = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "realtap-cmd-"));
  try {
    const local = path.join(tmp, `${cmd.id}.json`);
    fs.writeFileSync(local, JSON.stringify(cmd));
    if (!(await retry(() => channel.push(local, `Documents/inbox/${cmd.id}.json`), 4))) {
      return { id: cmd.id, op: cmd.op, ok: false, error: "could not deliver command (runner not installed, watch locked or disconnected)" };
    }

    const resFile = path.join(tmp, "result.json");
    while (Date.now() - started < timeoutMs) {
      if (await channel.pull(`Documents/outbox/${cmd.id}.json`, resFile)) {
        let res;
        try {
          res = JSON.parse(fs.readFileSync(resFile, "utf8"));
        } catch {
          await sleep(pollMs);
          continue;
        }
        const stem = outDir ? path.join(outDir, `${cmd.id}-${cmd.op}`) : null;
        if (stem) fs.mkdirSync(outDir, { recursive: true });
        if (res.has_png && stem && (await retry(() => channel.pull(`Documents/outbox/${cmd.id}.png`, `${stem}.png`), 3))) {
          res.screenshot = `${stem}.png`;
        }
        if (res.has_tree && stem && (await retry(() => channel.pull(`Documents/outbox/${cmd.id}.txt`, `${stem}.txt`), 3))) {
          res.tree_file = `${stem}.txt`;
        }
        delete res.has_png;
        delete res.has_tree;
        res.roundtrip_ms = Date.now() - started;
        return res;
      }
      await sleep(pollMs);
    }
    return { id: cmd.id, op: cmd.op, ok: false, error: `no result within ${Math.round(timeoutMs / 1000)}s (runner stopped or busy)` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Read a small JSON file from the container (ready.json, heartbeat.json). */
export async function readJson(channel, remotePath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "realtap-read-"));
  try {
    const local = path.join(tmp, "f.json");
    if (!(await channel.pull(remotePath, local))) return null;
    return JSON.parse(fs.readFileSync(local, "utf8"));
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
