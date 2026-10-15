---
name: realtap-setup
description: Get realtap working with a physical or simulated Apple device — first-time setup, `realtap doctor` failures, `realtap start` timeouts, signing, Developer Mode, device not visible, locked device, "Timed out while enabling automation mode". Use before realtap when anything fails to connect or build.
---

# realtap setup and troubleshooting

1. Run `realtap doctor [--platform ios] [--device NAME]`. Fix each failed check (not warnings) in order, then re-run until `ok: true`.
2. Run `realtap start`. On failure read the hints it prints and the build log path.

| Symptom | Fix |
|---|---|
| No physical device visible | Unlock it, trust this Mac, open Xcode > Window > Devices and Simulators. Watch: paired to a trusted iPhone, same Wi-Fi as the Mac. |
| Developer Mode not enabled | Device Settings > Privacy & Security > Developer Mode (user action, device restarts). |
| No signing team / "No profiles for" | `realtap setup --team TEAMID` (ask the user for their team id; do not guess). |
| "Developer mode is disabled for Apple development tools" | User runs `sudo DevToolsSecurity -enable` on the Mac (needs admin password). |
| "Unlock … to Continue" / device locked | Ask the user to unlock it (watch: wear it). `start` continues by itself. |
| "Timed out while enabling automation mode" (iOS) | Keep device unlocked with screen on; Settings > Developer > Enable UI Automation; confirm the prompt on the device. |
| Xcode cannot reach the device | Same Wi-Fi or USB; disable VPN / TUN proxy (doctor warns on a 198.18.x.x interface). |
| Runner stalls after launching an unknown bundle id | `realtap stop`, `realtap start`. |

Notes:
- Physical iPhone/iPad is not yet verified end to end (see README Status); say so if it fails past the steps above.
- Do not change `bundlePrefix` in the user's config: it keeps the already signed runner valid.
- Signing, Developer Mode and passwords are the user's to enter. Tell them what to do; do not attempt it.
- When `doctor` is clean and `start` succeeds, continue with `realtap` (driving) or `realtap-verify`.
