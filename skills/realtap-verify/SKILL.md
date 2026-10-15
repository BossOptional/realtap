---
name: realtap-verify
description: Verify a UI change or reproduce a device-only bug on a real Apple Watch, iPhone or iPad with realtap, and produce a pass/fail report with screenshot evidence. Use for "test this on the device", "verify my change on the watch", "reproduce on hardware", "QA report".
---

# realtap verify

Needs a working runner (`realtap start`); if it fails use `realtap-setup`. Command reference: `realtap` skill.

1. **Scope.** Read the diff (`git diff`) and list 3–8 cases: what to open, what to do, what must be visible. Include one regression case near the change. Ask the user for the bundle id and any build/install step if not obvious. Install the app build yourself only if the user asked.
2. **Plan around safety.** Mark cases that send, delete, record or purchase. Skip them unless the user approved that action.
3. **Run.** Per case: `realtap launch <id> --elements -s` then actions with `-s --elements`. Save evidence to `realtap-out/<YYYY-MM-DD>/<case>/` (use `--out`). Prefer `wait-for` over fixed waits.
4. **Judge from evidence.** Look at the screenshot and element list; do not infer a pass from `ok: true` alone. A step that fails twice is a fail: record the error, take a screenshot, move on.
5. **Report.** Table of case, result (pass / fail / skipped + reason), evidence path. For failures add: steps to reproduce, expected vs actual, device name + OS. State what was not tested.
6. `realtap stop` when done.

If connection fails mid-run (device locked, runner lost) stop and use `realtap-setup`; report it as blocked, not failed.
