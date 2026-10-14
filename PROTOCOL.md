# Runner protocol

The runner is a long-running XCUITest (`RunnerTests/testServe`) installed next to a
tiny host app, built from the same sources for watchOS and iOS. It never opens a
network connection — on a physical watch the test runner process gets
`NSURLErrorDomain -1009` for any request, so one file protocol serves every platform.
The Mac and the runner exchange files inside the runner app's data container —
`<bundlePrefix>.runner.xctrunner` (watchOS) or `<bundlePrefix>.ios.runner.xctrunner` (iOS):

| Path (container-relative)      | Writer | Meaning |
|--------------------------------|--------|---------|
| `Documents/ready.json`         | runner | Written once per session: `platform` (`watchos`/`ios`), `session`, `runner_version`, `screen {width,height,scale}` (points), `ttl_s`. |
| `Documents/heartbeat.json`     | runner | `{"at": ISO8601}` refreshed every ~2 s while serving. |
| `Documents/inbox/<id>.json`    | Mac    | One command. Processed in lexical `<id>` order, then deleted. |
| `Documents/outbox/<id>.png`    | runner | Screenshot, written before the result. |
| `Documents/outbox/<id>.txt`    | runner | Raw `debugDescription` tree, written before the result. |
| `Documents/outbox/<id>.json`   | runner | Result, written last and atomically. Pruned after 10 minutes. |

Transport: physical device (watch or iPhone) → `xcrun devicectl device copy to|from --domain-type
appDataContainer --domain-identifier <container>` (≈0.5 s per copy over the
CoreDevice tunnel); simulator → plain file I/O under
`xcrun simctl get_app_container <udid> <container> data` (every test run reinstalls the
runner and may move that directory, so the Mac side re-resolves it continuously).

Because `devicectl` cannot rename files, the runner ignores an unparsable command
file for up to 3 s (it may still be mid-copy) before reporting it as `invalid`.

## Command

```json
{ "id": "1791883083277-0001", "op": "tap", "target": "settings.button",
  "screenshot": true, "elements": false, "tree": false, "settle": 0.5 }
```

Common fields: `screenshot`, `elements` (compact element list in the result),
`tree` (raw tree file), `settle` (extra seconds after the action).

Selectors (`tap`, `doubleTap`, `longPress`, `swipe`, `waitFor`, `find`):
`target` (accessibility identifier) | `label` | `predicate` (NSPredicate), plus
optional `type` (`button`, `staticText`, `cell`, …), `index`, `timeout` (s, default 5).
Points: `x`/`y` in points from the app's top-left, or `nx`/`ny` normalized 0…1.

| op | fields | notes |
|----|--------|-------|
| `ping` | | |
| `launch` | `bundleId?`, `args?`, `env?` | (Re)launches. No `bundleId` → host fixture app. Launching a bundle that is not installed can stall the runner; `watchqa stop` recovers. |
| `activate` | `bundleId?` | Foreground without relaunch. |
| `terminate` | | |
| `state` | | Result `state`: `foreground` / `background` / `backgroundSuspended` / `notRunning`. |
| `tap`, `doubleTap` | selector or point | |
| `longPress` | selector or point, `duration` (1 s) | |
| `swipe` | `dir` up/down/left/right, optional selector | |
| `crown` | `delta` | watchOS only. Digital Crown rotation; positive scrolls down. |
| `home` | | watchOS: presses the Digital Crown. iOS: Home. |
| `button` | `name` home/volumeUp/volumeDown | iOS only. Volume buttons are unavailable in the Simulator. |
| `type` | `text`, optional selector | iOS only. With a selector, taps that field first; otherwise types into the focused element. |
| `pinch` | `scale` (2), `velocity` (1), optional selector | iOS only. |
| `orientation` | `value` portrait/portraitUpsideDown/landscapeLeft/landscapeRight | iOS only. |
| `wait` | `seconds` | |
| `waitFor` | selector, `timeout` (10 s), `gone?` | Error on timeout. |
| `find` | selector | Result `exists`, `element {type,id,label,value,frame,hittable}`. |
| `screenshot`, `elements`, `tree` | | Capture only. |
| `quit` | | Ends the session. |

## Result

```json
{ "id": "…", "op": "tap", "ok": true, "app": "com.example.app",
  "elapsed_ms": 812, "has_png": true, "elements": [ … ] }
```

On failure `ok` is `false` and `error` explains why (element not found, XCTest
issue text, unknown op, op not available on this platform). Failures never end the session.

`elements` entries: `type`, `id?`, `label?`, `value?`, `frame [x,y,w,h]` (points),
`enabled: false` / `selected: true` when relevant, `depth`.
