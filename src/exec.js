import { spawn } from "node:child_process";

/** Run a command to completion. Never rejects; inspect `code`. */
export function run(cmd, args, { timeoutMs = 120_000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: env ?? process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
