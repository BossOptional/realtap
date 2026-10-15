import SwiftUI

/// Minimal host app. XCUITest needs a target application to install the runner
/// next to; it also doubles as a fixture for `realtap selftest` and the e2e suite.
@main
struct RealTapHostApp: App {
    var body: some Scene {
        WindowGroup { FixtureView() }
    }
}

struct FixtureView: View {
    @State private var count = 0
    @State private var typed = ""

    #if os(watchOS)
    private let rows = 20
    #else
    private let rows = 60
    #endif

    var body: some View {
        List {
            Button("Tap me") { count += 1 }
                .accessibilityIdentifier("fixture.tap")
            Text("Tapped \(count)")
                .accessibilityIdentifier("fixture.count")
            #if os(iOS)
            TextField("Type here", text: $typed)
                .accessibilityIdentifier("fixture.input")
            Text("Typed: \(typed)")
                .accessibilityIdentifier("fixture.echo")
            #endif
            ForEach(1...rows, id: \.self) { i in
                Text("Row \(i)").accessibilityIdentifier("fixture.row\(i)")
            }
        }
    }
}
