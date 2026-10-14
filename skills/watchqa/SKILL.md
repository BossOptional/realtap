---
name: watchqa
description: Drive and inspect an app on a physical Apple Watch, iPhone or iPad, or on a watchOS/iOS simulator — tap, swipe, type, Digital Crown, screenshots, accessibility tree. Use for device QA, verifying a UI change on real hardware, reproducing device-only bugs, or capturing screenshots as evidence.
---

# watchqa

`watchqa` installs an XCUITest runner on the device and lets you send it commands.
Prefer the MCP tools (`device_*`) when the `watchqa` MCP server is connected;
otherwise use the CLI (`npx watchqa …` or `watchqa …`). Every CLI command prints JSON.

Pick the target with `--platform watch|ios` (default `watch`), `--device NAME|ID`
(implies the platform) and `--simulator`. Check `watchqa devices` first when unsure.

## First run

1. `watchqa doctor [--platform ios]` — fix every non-warning check it reports.
   Typical blockers: device not visible to Xcode (a watch: same Wi-Fi as the Mac,
   unlocked, Developer Mode on, no VPN/TUN proxy), missing signing team
   (`watchqa setup --team TEAMID`), Mac developer tools not authorized
   (`sudo DevToolsSecurity -enable`, run by the user).
2. `watchqa start` — builds the runner when sources/config changed (first build and
   install take minutes), then waits until it serves. If it reports the device is
   locked, ask the user to unlock it (a watch: wear it); it continues automatically.
3. `watchqa selftest` checks taps/scrolling/screenshots against the bundled fixture app.

The device must stay unlocked for the whole session. If it locks, gestures land on
the passcode screen: take a screenshot when in doubt.

## Driving an app

```
watchqa launch com.example.app --elements -s        # launch, list elements, screenshot
watchqa tap --target settings.button -s
watchqa tap --label "Done"
watchqa swipe left
watchqa wait-for --target detail.title --timeout 10
watchqa find --target record.button                 # exists + frame, no gesture
watchqa screenshot                                  # PNG saved under ./watchqa-out
watchqa stop
```

watchOS only: `watchqa crown 1.5 --elements` scrolls / pages (positive = down).
iOS only: `watchqa type "text" --target field.id` (taps the field first),
`watchqa button home|volumeUp|volumeDown` (volume: physical device only),
`watchqa pinch --scale 2`, `watchqa orientation landscapeLeft`. Dialogs from the
system (permissions) belong to another app: `watchqa launch com.apple.springboard`
then tap the button by `--label`, or `activate` your app afterwards.

- Locate elements with `elements` (compact JSON: type, id, label, frame in points)
  and tap by `--target` (accessibility identifier) first, `--label` second, points
  (`--x/--y`, from the app's top-left in points) last.
- Read screenshots to confirm state; they are full-resolution PNGs.
- A failed command returns `"ok": false` with `error`; the runner keeps serving.
- Latency is ~1–5 s per command (watch crown/launch up to ~10 s, XCTest waits for
  the app to go idle). Batch observation flags (`-s --elements`) onto the action
  instead of sending separate commands.
- iOS: with the keyboard open a swipe lands on the keys and types letters. Scroll
  before typing, or dismiss the keyboard first.

## Safety

Commands act on the real app with real data. Do not trigger destructive or
side-effecting controls (recording, sending, deleting, purchases) unless the user
asked for that specific action. Launching a bundle id that is not installed can
stall the runner — `watchqa stop` then `watchqa start` recovers. Only one runner per
device: stop other automation (agent-device, WebDriverAgent) on the same device first.
