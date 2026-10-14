import Foundation

/// File protocol shared with the Mac side (see PROTOCOL.md):
///
///   Documents/ready.json          written once per session after startup
///   Documents/heartbeat.json      refreshed every ~2s while serving
///   Documents/inbox/<id>.json     command, consumed in lexical id order
///   Documents/outbox/<id>.png     optional screenshot   (written first)
///   Documents/outbox/<id>.txt     optional raw tree     (written first)
///   Documents/outbox/<id>.json    result               (written last, atomically)
final class Mailbox {
    let root: URL
    private let inbox: URL
    private let outbox: URL
    private var lastBeat = Date.distantPast

    init() throws {
        let fm = FileManager.default
        root = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        inbox = root.appendingPathComponent("inbox")
        outbox = root.appendingPathComponent("outbox")
        for name in ["ready.json", "heartbeat.json"] {
            try? fm.removeItem(at: root.appendingPathComponent(name))
        }
        for dir in [inbox, outbox] {
            try? fm.removeItem(at: dir)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    func writeReady(_ info: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: info)
        try data.write(to: root.appendingPathComponent("ready.json"), options: .atomic)
    }

    func heartbeat() {
        guard Date().timeIntervalSince(lastBeat) > 2 else { return }
        lastBeat = Date()
        let beat = ["at": ISO8601DateFormatter().string(from: lastBeat)]
        if let data = try? JSONSerialization.data(withJSONObject: beat) {
            try? data.write(to: root.appendingPathComponent("heartbeat.json"), options: .atomic)
        }
        pruneOutbox(olderThan: 600)
    }

    /// The Mac side cannot delete files on device, so stale results expire here.
    private func pruneOutbox(olderThan age: TimeInterval) {
        let fm = FileManager.default
        let files = (try? fm.contentsOfDirectory(at: outbox, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        for file in files {
            let date = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let date, Date().timeIntervalSince(date) > age { try? fm.removeItem(at: file) }
        }
    }

    /// Next command, or nil after a short idle sleep.
    func next() -> [String: Any]? {
        let files = (try? FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil)) ?? []
        guard let file = files.filter({ $0.pathExtension == "json" })
            .min(by: { $0.lastPathComponent < $1.lastPathComponent }) else {
            Thread.sleep(forTimeInterval: 0.15)
            return nil
        }
        guard let data = try? Data(contentsOf: file),
              var cmd = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // devicectl cannot rename remotely, so a command may still be mid-copy.
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let modified, Date().timeIntervalSince(modified) < 3 {
                Thread.sleep(forTimeInterval: 0.15)
                return nil
            }
            try? FileManager.default.removeItem(at: file)
            return ["id": file.deletingPathExtension().lastPathComponent, "op": "invalid"]
        }
        try? FileManager.default.removeItem(at: file)
        if cmd["id"] == nil { cmd["id"] = file.deletingPathExtension().lastPathComponent }
        return cmd
    }

    func send(_ result: [String: Any], png: Data?, tree: String?) {
        let id = "\(result["id"] ?? "unknown")"
        var meta = result
        if let png, (try? png.write(to: outbox.appendingPathComponent("\(id).png"), options: .atomic)) != nil {
            meta["has_png"] = true
        }
        if let tree, (try? Data(tree.utf8).write(to: outbox.appendingPathComponent("\(id).txt"), options: .atomic)) != nil {
            meta["has_tree"] = true
        }
        let data = (try? JSONSerialization.data(withJSONObject: meta))
            ?? Data("{\"id\":\"\(id)\",\"ok\":false,\"error\":\"result not serializable\"}".utf8)
        try? data.write(to: outbox.appendingPathComponent("\(id).json"), options: .atomic)
    }
}
