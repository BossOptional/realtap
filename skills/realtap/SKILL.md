---
name: realtap
description: Send commands to an app on an Apple Watch, iPhone or iPad (physical or simulator) that is already connected — tap, swipe, type, Digital Crown, screenshots, element list. Use once `realtap start` works. For connection or build failures use realtap-setup; for verifying a change end to end use realtap-verify.
---

# realtap

Prefer the MCP tools (`device_*`) when the `realtap` server is connected; otherwise the CLI (`npx realtap …`). Every CLI command prints JSON.
Target: `--platform watch|ios` (default `watch`), `--device NAME|ID`, `--simulator`. Run `realtap devices` when unsure.

## Start

`realtap start` builds and installs the runner (first time: minutes) and waits until it serves. Any error, or "device is locked": follow `realtap-setup`. The device must stay unlocked for the whole session; screenshot when in doubt.

## Drive

```
realtap launch com.example.app --elements -s    # launch, list elements, screenshot
realtap tap --target settings.button -s
realtap swipe left
realtap wait-for --target detail.title --timeout 10
realtap find --target record.button             # exists + frame, no gesture
realtap stop
```

- Select by `--target` (accessibility id) first, `--label` second, points (`--x/--y`) last. Get ids from `elements`.
- Attach observation to the action (`-s --elements`) instead of sending separate commands; each command costs 1–5 s.
- A failed command returns `"ok": false` with `error`; the runner keeps serving.
- watchOS crown, iOS typing/buttons/pinch/orientation, system dialogs: `references/platforms.md`.

## Safety

Commands act on the real app with real data. Do not trigger destructive or side-effecting controls (recording, sending, deleting, purchases) unless the user asked for that action. Launching a bundle id that is not installed can stall the runner: `realtap stop` then `realtap start`. One runner per device: stop other automation (agent-device, WebDriverAgent) first.
