// [Rahim] Export a CapturedRoom (JSON + USDZ) and upload both to POST <API_BASE>/units/:id/scan.
import Foundation
import RoomPlan

/// The two exported files for one scan, in the app's Documents folder (also visible in the Files app).
struct ScanFiles {
    let json: URL
    let usdz: URL
    let summary: String

    static func export(_ room: CapturedRoom) throws -> ScanFiles {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("scan-\(stamp)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // File names start with a letter: before iOS 17.4 a USD file name must not start with a digit.
        let json = dir.appendingPathComponent("room.json")
        let usdz = dir.appendingPathComponent("room.usdz")

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(room).write(to: json)
        // Parametric = walls, doors, windows and objects as simple boxes, closest to our floor-plan model.
        try room.export(to: usdz, exportOptions: .parametric)

        let summary = "\(room.walls.count) walls · \(room.doors.count) doors · \(room.windows.count) windows · \(room.objects.count) objects"
        return ScanFiles(json: json, usdz: usdz, summary: summary)
    }
}

enum Uploader {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Multipart fields: `room` (room.json, application/json) and `usdz` (room.usdz, model/vnd.usdz+zip).
    /// Returns the unitId from the response (`{ unitId }` or `{ unit: { unitId } }`), else the one we sent.
    static func upload(_ files: ScanFiles, apiBase: String, unitId: String) async throws -> String {
        let id = unitId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? unitId
        guard let url = URL(string: "\(trimmed(apiBase))/units/\(id)/scan") else {
            throw Failure(message: "bad API address \(apiBase)")
        }
        let boundary = "ledger-\(UUID().uuidString)"
        var body = Data()
        for (field, file, mime) in [("room", files.json, "application/json"), ("usdz", files.usdz, "model/vnd.usdz+zip")] {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field)\"; filename=\"\(file.lastPathComponent)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
            body.append(try Data(contentsOf: file))
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"unitId\"\r\n\r\n\(unitId)\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: url, timeoutInterval: 60)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let text = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw Failure(message: "HTTP \(status) \(text)")
        }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let nested = object?["unit"] as? [String: Any]
        return (object?["unitId"] as? String) ?? (nested?["unitId"] as? String) ?? unitId
    }

    /// GET /health, as a one-line status for the connection test.
    static func health(apiBase: String) async -> String {
        guard let url = URL(string: "\(trimmed(apiBase))/health") else { return "Bad address" }
        do {
            let (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 5))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return "HTTP \(status) \(String(data: data, encoding: .utf8) ?? "")"
        } catch {
            return "Can't reach \(url.host() ?? apiBase): \(error.localizedDescription)"
        }
    }

    /// The web app runs on port 3000 of the same laptop.
    static func webURL(apiBase: String, unitId: String) -> String {
        guard var parts = URLComponents(string: trimmed(apiBase)) else { return "/units/\(unitId)" }
        parts.port = 3000
        parts.path = "/units/\(unitId)"
        return parts.string ?? "/units/\(unitId)"
    }

    private static func trimmed(_ base: String) -> String {
        var s = base.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }
}
