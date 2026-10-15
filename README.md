# realtap

Drive an **Apple Watch or an iPhone/iPad — physical or simulator** from the command
line or an AI agent: tap, long-press, swipe, type, Digital Crown, launch apps by bundle
id, and read back screenshots and the accessibility tree. One tool, one command set,
two platforms.

There is no off-the-shelf way to automate a *physical* Apple Watch: Appium's XCUITest
driver and most MCP servers are simulator-only for watchOS, and iPhone "Apple Watch
Mirroring" yields screenshots but not input. `realtap` installs a small XCUITest
runner on the device and talks to it through files moved over the CoreDevice tunnel
(on a watch the runner process cannot use the network at all), so it works on real
hardware — and the same mechanism drives iPhones, so you do not need a second stack
(agent-device, WebDriverAgent) for the phone.

```
Mac                                         Apple Watch / iPhone / simulator
realtap CLI / MCP ── devicectl copy ──▶ Documents/inbox/<id>.json
                                         RunnerTests.testServe (XCUITest)
                  ◀─ devicectl copy ── Documents/outbox/<id>.{json,png,txt}
```

## Status

| Target | Verified |
|--------|----------|
| Apple Watch Series 11, watchOS 26.6 (physical) | ✅ end to end (`npm run e2e:device`) |
| watchOS simulator | ✅ end to end (`npm run e2e:sim`) |
| iOS simulator (iPhone 17e, iOS 26) | ✅ end to end (`npm run e2e:ios-sim`) |
| iPhone / iPad (physical) | ⚠️ runner builds, signs and installs; the first end-to-end run stopped at iOS's *Timed out while enabling automation mode* (enable Settings › Developer › Enable UI Automation and keep the device unlocked). Not yet verified end to end. |

## Requirements

- macOS with Xcode 15+ (tested with Xcode 26.6, watchOS 26.6, iOS 26.6), Node.js 20+
- For a physical device: an Apple developer team for automatic signing, **Developer
  Mode** on the device, the device trusted by this Mac and visible in Xcode ›
  Devices and Simulators. A watch must also be paired to an iPhone this Mac trusts.
- The device stays **unlocked** during a session (a watch: wear it)

## Install

```bash
npm install -g realtap        # or: npx realtap …
# installs two commands: `realtap` (CLI) and `realtap-mcp` (MCP server)
```

From a checkout: `git clone https://github.com/BossOptional/realtap && cd realtap && npm install && npm link`.

## Quick start

```bash
realtap doctor                        # what is missing and how to fix it (add --platform ios)
realtap setup --team ABCDE12345       # signing team (physical devices only)
realtap start                         # build + install + launch runner (first time: minutes)
realtap launch com.example.watchapp --elements -s
realtap tap --target settings.button -s
realtap crown 1.5
realtap stop

# iPhone / iPad: same commands, add --platform ios
realtap launch com.example.app --platform ios --elements -s
realtap type "hello" --target search.field --platform ios
```

Platform selection: `--platform watch|ios` (default `watch`; `realtap setup --platform ios`
changes the default). Naming a device with `--device NAME|ID` picks its platform
automatically. Simulators: add `--simulator` (a booted one of that platform).
Screenshots and trees go to `./realtap-out` (`--out` to change).

Full command list: `realtap --help`. Wire format: [PROTOCOL.md](PROTOCOL.md).

| Gesture | watchOS | iOS |
|---------|:-------:|:---:|
| launch / activate / terminate / state, tap, double-tap, long-press, swipe, wait-for, find, screenshot, elements, tree | ✓ | ✓ |
| `home` | Digital Crown press | Home |
| `crown DELTA` | ✓ | — |
| `type TEXT`, `pinch`, `orientation`, `button volumeUp/volumeDown` | — | ✓ (volume: physical devices only) |

## MCP server

```json
{ "mcpServers": { "realtap": { "command": "npx", "args": ["-y", "--package=realtap", "realtap-mcp"] } } }
```

Claude Code: `claude mcp add realtap -- npx -y --package=realtap realtap-mcp`.

As a Claude Code plugin (skills + MCP server together; run `npm install` in the checkout first): `claude --plugin-dir /path/to/realtap`.

Tools: `device_list`, `device_start`, `device_status`, `device_stop`,
`device_launch`, `device_activate`, `device_terminate`, `device_tap` (tap / doubleTap /
longPress), `device_swipe`, `device_home`, `device_wait_for`, `device_find`,
`device_screenshot` (returns the image), `device_elements`, `device_tree`,
`device_app_state`; watchOS: `device_crown`; iOS: `device_type`, `device_button`,
`device_pinch`, `device_orientation`. Every tool takes `platform` / `device` /
`simulator` to choose the target. Action tools accept `screenshot` / `elements` to
return the post-action state in the same call.

An agent skill describing the workflow lives in [`skills/realtap/SKILL.md`](skills/realtap/SKILL.md).

## Configuration

| Setting | CLI | Env | Default |
|---------|-----|-----|---------|
| Signing team | `setup --team` | `REALTAP_TEAM` | — (required for physical devices) |
| Bundle prefix | `setup --bundle-prefix` | `REALTAP_BUNDLE_PREFIX` | `dev.realtap.<team>` |
| Default platform | `setup --platform`, `--platform` | `REALTAP_PLATFORM` | `watch` |
| Default device | `setup --device`, `--device` | `REALTAP_DEVICE` | connected physical device of the platform |
| Output dir | `--out` | `REALTAP_OUT` | `./realtap-out` |

Config lives in `~/.config/realtap/config.json`; builds, logs and session state in
`~/.cache/realtap/`. The runner is rebuilt automatically when its sources, the
bundle prefix or the team change.

Bundle ids registered under your team (automatic signing creates them on first build):
`<prefix>` and `<prefix>.runner` for watchOS, `<prefix>.ios` and `<prefix>.ios.runner`
for iOS. The runner project is generated by `runner/generate_project.py`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Watch missing from `realtap devices` | Same Wi-Fi as the Mac, unlocked, near its iPhone; open Xcode › Devices and Simulators; disable VPN/TUN proxies (Clash/Surge enhanced mode); enable Developer Mode on the watch. |
| iPhone missing / "not connected" | Connect by USB or Wi-Fi, unlock, trust this Mac, enable Developer Mode; open Xcode › Devices and Simulators. |
| `Developer mode is disabled for Apple development tools` | One-time on the Mac: `sudo DevToolsSecurity -enable` (needs an admin password). |
| `start` waits with "device is locked" | Unlock the device (a watch: wear it); the run continues. |
| "connection to this device could not be established" | Wake and unlock the device, then `realtap start` again. |
| Taps do nothing, screenshot shows passcode | Locked mid-session. Wear/unlock it; consider a longer auto-lock. |
| iOS swipe types letters instead of scrolling | The keyboard is open; the swipe landed on the keys. Scroll first, or dismiss the keyboard. |
| A command never returns after `launch` of an unknown bundle | `realtap stop && realtap start`. |
| Simulator runs get killed | Another process (e.g. CI) uses the same simulator; pick another with `--device`. |

## Performance

Physical watch (Series 11, watchOS 26.6): ~0.5 s per file copy; typical command
round trip 1–4 s, `crown` / `launch` up to ~10 s because XCTest waits for the app
to idle. Simulators (watchOS and iOS): 0.3–5 s per command.

## Development

```bash
npm test                 # unit tests (no device needed)
npm run e2e:sim          # end-to-end against a booted watchOS simulator
npm run e2e:device       # end-to-end against the physical watch (wear it)
npm run e2e:ios-sim      # end-to-end against a booted iOS simulator
npm run e2e:ios-device   # end-to-end against a physical iPhone/iPad
realtap selftest         # gesture self-check inside XCTest (add --platform ios)
python3 runner/generate_project.py   # regenerate the Xcode project after adding runner files
```
