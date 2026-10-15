# Platform differences

## watchOS only
- `realtap crown DELTA --elements` rotates the Digital Crown (positive = scroll down). Latency up to ~10 s.
- The watch must be worn and unlocked, or gestures land on the passcode screen.

## iOS / iPadOS only
- `realtap type "text" --target field.id` taps the field first, then types.
- `realtap button home|volumeUp|volumeDown` (volume: physical device only).
- `realtap pinch --scale 2`, `realtap orientation landscapeLeft`.
- With the keyboard open a swipe lands on the keys and types letters: scroll before typing, or dismiss the keyboard first.

## System dialogs (permissions)
They belong to another app. `realtap launch com.apple.springboard`, tap the button by `--label`, then `realtap activate <your bundle id>`.
