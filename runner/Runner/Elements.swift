import XCTest

/// Compact, agent-friendly view of the accessibility hierarchy.
enum Elements {
    private static let names: [(String, XCUIElement.ElementType)] = [
        ("any", .any), ("other", .other), ("application", .application), ("window", .window),
        ("button", .button), ("staticText", .staticText), ("image", .image), ("cell", .cell),
        ("table", .table), ("collectionView", .collectionView), ("scrollView", .scrollView),
        ("switch", .switch), ("toggle", .toggle), ("slider", .slider), ("picker", .picker),
        ("pickerWheel", .pickerWheel), ("textField", .textField), ("secureTextField", .secureTextField),
        ("link", .link), ("progressIndicator", .progressIndicator), ("activityIndicator", .activityIndicator),
        ("alert", .alert), ("sheet", .sheet), ("navigationBar", .navigationBar), ("tabBar", .tabBar),
        ("segmentedControl", .segmentedControl), ("map", .map), ("webView", .webView),
        ("group", .group), ("stepper", .stepper), ("menu", .menu), ("menuItem", .menuItem),
    ]

    static func type(named name: String?) -> XCUIElement.ElementType {
        guard let name else { return .any }
        return names.first { $0.0.caseInsensitiveCompare(name) == .orderedSame }?.1 ?? .any
    }

    static func name(of type: XCUIElement.ElementType) -> String {
        names.first { $0.1 == type }?.0 ?? "type\(type.rawValue)"
    }

    static func describe(_ el: XCUIElement) -> [String: Any] {
        entry(type: el.elementType, id: el.identifier, label: el.label,
              value: el.value, frame: el.frame, enabled: el.isEnabled, selected: el.isSelected)
            .merging(["hittable": el.isHittable]) { _, new in new }
    }

    /// Elements that carry an identifier, label or value, plus all interactive
    /// controls, flattened in document order. Frames are in points.
    static func list(of app: XCUIApplication) -> [[String: Any]] {
        guard let root = try? app.snapshot() else { return [] }
        var out: [[String: Any]] = []
        func walk(_ s: XCUIElementSnapshot, depth: Int) {
            let interactive: Set<XCUIElement.ElementType> = [.button, .switch, .toggle, .slider, .cell, .textField, .link, .picker]
            let hasText = !s.identifier.isEmpty || !s.label.isEmpty || (s.value as? String).map { !$0.isEmpty } ?? false
            if hasText || interactive.contains(s.elementType) {
                var e = entry(type: s.elementType, id: s.identifier, label: s.label, value: s.value,
                              frame: s.frame, enabled: s.isEnabled, selected: s.isSelected)
                e["depth"] = depth
                out.append(e)
            }
            s.children.forEach { walk($0, depth: depth + 1) }
        }
        walk(root, depth: 0)
        return out
    }

    private static func entry(type: XCUIElement.ElementType, id: String, label: String, value: Any?,
                              frame: CGRect, enabled: Bool, selected: Bool) -> [String: Any] {
        var e: [String: Any] = [
            "type": name(of: type),
            "frame": [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height].map { Double($0) },
        ]
        if !id.isEmpty { e["id"] = id }
        if !label.isEmpty { e["label"] = label }
        if let v = value as? String, !v.isEmpty { e["value"] = v } else if let v = value as? NSNumber { e["value"] = v }
        if !enabled { e["enabled"] = false }
        if selected { e["selected"] = true }
        return e
    }
}
