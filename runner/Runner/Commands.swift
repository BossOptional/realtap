import XCTest

struct CommandError: Error, CustomStringConvertible {
    let description: String
}

/// Executes one command against the current target application.
final class Commands {
    private(set) var app = XCUIApplication()
    /// `nil` means the bundled host/fixture app.
    private(set) var bundleId: String?

    func perform(_ op: String, _ cmd: [String: Any]) throws -> [String: Any] {
        var extra: [String: Any] = [:]
        switch op {
        case "ping":
            break

        case "launch":
            select(cmd["bundleId"] as? String)
            if let args = cmd["args"] as? [String] { app.launchArguments = args }
            if let env = cmd["env"] as? [String: String] { app.launchEnvironment = env }
            app.launch()

        case "activate":
            select(cmd["bundleId"] as? String ?? bundleId)
            app.activate()

        case "terminate":
            app.terminate()

        case "state":
            extra["state"] = Self.stateName(app.state)

        case "tap":
            try tap(cmd)

        case "doubleTap":
            if let el = try element(cmd, required: false) { el.doubleTap() } else { try point(cmd).doubleTap() }

        case "longPress":
            let duration = cmd["duration"] as? Double ?? 1.0
            if let el = try element(cmd, required: false) {
                el.press(forDuration: duration)
            } else {
                try point(cmd).press(forDuration: duration)
            }

        case "swipe":
            let target: XCUIElement = try element(cmd, required: false) ?? app
            switch cmd["dir"] as? String {
            case "up": target.swipeUp()
            case "down": target.swipeDown()
            case "left": target.swipeLeft()
            case "right": target.swipeRight()
            default: throw CommandError(description: "swipe needs dir: up|down|left|right")
            }

        case "crown":
            #if os(watchOS)
            XCUIDevice.shared.rotateDigitalCrown(delta: cmd["delta"] as? Double ?? 1.0)
            #else
            throw CommandError(description: "crown is only available on watchOS")
            #endif

        case "home":
            XCUIDevice.shared.press(.home)

        case "button":
            #if os(iOS)
            switch cmd["name"] as? String {
            case "home": XCUIDevice.shared.press(.home)
            case "volumeUp", "volumeDown":
                #if targetEnvironment(simulator)
                throw CommandError(description: "volume buttons are not available in the iOS Simulator")
                #else
                XCUIDevice.shared.press(cmd["name"] as? String == "volumeUp" ? .volumeUp : .volumeDown)
                #endif
            default: throw CommandError(description: "button needs name: home|volumeUp|volumeDown")
            }
            #else
            throw CommandError(description: "button is only available on iOS (use home / crown on watchOS)")
            #endif

        case "type":
            #if os(iOS)
            guard let text = cmd["text"] as? String else { throw CommandError(description: "type needs text") }
            // With a selector: focus that field first. Without: type into the focused element.
            if let el = try element(cmd, required: false) {
                el.tap()
                el.typeText(text)
            } else {
                app.typeText(text)
            }
            #else
            throw CommandError(description: "type is only available on iOS")
            #endif

        case "pinch":
            #if os(iOS)
            let target: XCUIElement = try element(cmd, required: false) ?? app
            target.pinch(withScale: cmd["scale"] as? Double ?? 2.0, velocity: cmd["velocity"] as? Double ?? 1.0)
            #else
            throw CommandError(description: "pinch is only available on iOS")
            #endif

        case "orientation":
            #if os(iOS)
            switch cmd["value"] as? String {
            case "portrait": XCUIDevice.shared.orientation = .portrait
            case "portraitUpsideDown": XCUIDevice.shared.orientation = .portraitUpsideDown
            case "landscapeLeft": XCUIDevice.shared.orientation = .landscapeLeft
            case "landscapeRight": XCUIDevice.shared.orientation = .landscapeRight
            default: throw CommandError(description: "orientation needs value: portrait|portraitUpsideDown|landscapeLeft|landscapeRight")
            }
            #else
            throw CommandError(description: "orientation is only available on iOS")
            #endif

        case "wait":
            Thread.sleep(forTimeInterval: cmd["seconds"] as? Double ?? 1.0)

        case "waitFor":
            let el = try query(cmd)
            let timeout = cmd["timeout"] as? Double ?? 10
            let gone = cmd["gone"] as? Bool ?? false
            let ok = gone ? el.waitForNonExistence(timeout: timeout) : el.waitForExistence(timeout: timeout)
            extra["found"] = !gone && ok
            if !ok { throw CommandError(description: "waitFor timed out after \(timeout)s") }

        case "find":
            let el = try query(cmd)
            extra["exists"] = el.exists
            if el.exists { extra["element"] = Elements.describe(el) }

        case "screenshot", "tree", "elements":
            break

        default:
            throw CommandError(description: "unknown op '\(op)'")
        }
        if let settle = cmd["settle"] as? Double, settle > 0 {
            Thread.sleep(forTimeInterval: settle)
        }
        return extra
    }

    private func select(_ bundle: String?) {
        if bundle != bundleId || bundle == nil {
            app = bundle.map(XCUIApplication.init(bundleIdentifier:)) ?? XCUIApplication()
            bundleId = bundle
        }
    }

    private func tap(_ cmd: [String: Any]) throws {
        if let el = try element(cmd, required: false) {
            el.tap()
        } else {
            try point(cmd).tap()
        }
    }

    /// Element selected by `target` (accessibility identifier), `label`, or
    /// `predicate` (NSPredicate format), optionally narrowed by `type` and `index`.
    private func query(_ cmd: [String: Any]) throws -> XCUIElement {
        let type = Elements.type(named: cmd["type"] as? String)
        var q = app.descendants(matching: type)
        if let id = cmd["target"] as? String {
            q = q.matching(identifier: id)
        } else if let label = cmd["label"] as? String {
            q = q.matching(NSPredicate(format: "label == %@", label))
        } else if let pred = cmd["predicate"] as? String {
            q = q.matching(NSPredicate(format: pred))
        } else {
            throw CommandError(description: "need target, label or predicate")
        }
        let index = cmd["index"] as? Int ?? 0
        return index == 0 ? q.firstMatch : q.element(boundBy: index)
    }

    private func element(_ cmd: [String: Any], required: Bool) throws -> XCUIElement? {
        guard cmd["target"] != nil || cmd["label"] != nil || cmd["predicate"] != nil else {
            if required { throw CommandError(description: "need target, label or predicate") }
            return nil
        }
        let el = try query(cmd)
        let timeout = cmd["timeout"] as? Double ?? 5
        guard el.waitForExistence(timeout: timeout) else {
            let what = cmd["target"] ?? cmd["label"] ?? cmd["predicate"] ?? ""
            throw CommandError(description: "element '\(what)' not found within \(timeout)s")
        }
        return el
    }

    /// Point in app coordinates: `x`/`y` in points, or `nx`/`ny` normalized 0…1.
    private func point(_ cmd: [String: Any]) throws -> XCUICoordinate {
        if let x = cmd["x"] as? Double, let y = cmd["y"] as? Double {
            return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
        }
        if let nx = cmd["nx"] as? Double, let ny = cmd["ny"] as? Double {
            return app.coordinate(withNormalizedOffset: CGVector(dx: nx, dy: ny))
        }
        throw CommandError(description: "need target/label/predicate, x/y or nx/ny")
    }

    static func stateName(_ s: XCUIApplication.State) -> String {
        switch s {
        case .notRunning: return "notRunning"
        case .runningBackgroundSuspended: return "backgroundSuspended"
        case .runningBackground: return "background"
        case .runningForeground: return "foreground"
        default: return "unknown"
        }
    }
}
