import XCTest

/// Long-running UI test that turns the watch into a remotely drivable device.
///
/// The Mac side (`realtap`) drops command files into this runner's data container
/// (`Documents/inbox/<id>.json`) and collects results from `Documents/outbox/`.
/// On a physical watch the files move over the CoreDevice tunnel with
/// `devicectl device copy`; on a simulator they are read directly from disk.
/// The runner never opens a network connection, which watchOS blocks for this
/// process on device (NSURLErrorDomain -1009).
final class RunnerTests: XCTestCase {
    static let runnerVersion = "0.1.0"

    private var env: [String: String] { ProcessInfo.processInfo.environment }

    /// While a command runs, XCTest issues (failed launch, missing element after a
    /// gesture, …) become that command's error instead of failing the session.
    private var capturing = false
    private var capturedIssues: [String] = []

    override func setUp() {
        continueAfterFailure = true
    }

    override func record(_ issue: XCTIssue) {
        if capturing {
            capturedIssues.append(issue.compactDescription)
        } else {
            super.record(issue)
        }
    }

    func testServe() throws {
        let ttl = TimeInterval(env["REALTAP_TTL"] ?? "") ?? 3600
        let deadline = Date().addingTimeInterval(ttl)
        let mailbox = try Mailbox()
        let commands = Commands()

        #if os(watchOS)
        let platform = "watchos"
        #else
        let platform = "ios"
        #endif
        let screen = XCUIScreen.main.screenshot().image
        try mailbox.writeReady([
            "platform": platform,
            "session": env["REALTAP_SESSION"] ?? "",
            "runner_version": Self.runnerVersion,
            "started_at": ISO8601DateFormatter().string(from: Date()),
            "screen": [
                "width": screen.size.width,
                "height": screen.size.height,
                "scale": screen.scale,
            ],
            "ttl_s": ttl,
        ])
        NSLog("[realtap] serving from \(mailbox.root.path) for \(Int(ttl))s")

        while Date() < deadline {
            mailbox.heartbeat()
            guard let cmd = mailbox.next() else { continue }
            let id = "\(cmd["id"] ?? "")"
            let op = cmd["op"] as? String ?? ""

            var result: [String: Any] = ["id": id, "op": op, "ok": true]
            if op == "quit" {
                mailbox.send(result, png: nil, tree: nil)
                return
            }

            let started = Date()
            capturing = true
            capturedIssues = []
            do {
                let extra = try commands.perform(op, cmd)
                result.merge(extra) { _, new in new }
            } catch {
                capturedIssues.append("\(error)")
            }
            capturing = false
            if !capturedIssues.isEmpty {
                result["ok"] = false
                result["error"] = capturedIssues.joined(separator: "; ")
            }

            let png = (cmd["screenshot"] as? Bool ?? false)
                ? XCUIScreen.main.screenshot().pngRepresentation : nil
            let tree = (cmd["tree"] as? Bool ?? false) ? commands.app.debugDescription : nil
            if cmd["elements"] as? Bool ?? false {
                result["elements"] = Elements.list(of: commands.app)
            }
            result["app"] = commands.bundleId
            result["elapsed_ms"] = Int(Date().timeIntervalSince(started) * 1000)
            mailbox.send(result, png: png, tree: tree)
        }
    }

    /// Self-check of the gestures against the bundled fixture app. Run with
    /// `realtap selftest`.
    func testSelftest() throws {
        let app = XCUIApplication()
        app.launch()

        let button = app.buttons["fixture.tap"]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "fixture button missing")
        let label = app.staticTexts["fixture.count"]

        button.tap()
        XCTAssertTrue(label.wait(for: \.label, toEqual: "Tapped 1", timeout: 3), "element tap: \(label.label)")

        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: button.frame.midX, dy: button.frame.midY)).tap()
        XCTAssertTrue(label.wait(for: \.label, toEqual: "Tapped 2", timeout: 3), "coordinate tap: \(label.label)")

        #if os(watchOS)
        XCUIDevice.shared.rotateDigitalCrown(delta: 3.0)
        #else
        app.swipeUp()
        app.swipeUp()
        #endif
        let row1 = app.staticTexts["fixture.row1"]
        XCTAssertTrue(row1.wait(for: \.isHittable, toEqual: false, timeout: 3), "scroll did not move the list")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "selftest"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
