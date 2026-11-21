// [Rahim] LEDGER Scan: scan a room with RoomPlan, export JSON + USDZ, upload to the LEDGER API.
import RoomPlan
import SwiftUI

@main
struct LedgerScannerApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

/// App state for one scan: idle → scanning → processing → ready → uploading → uploaded.
@MainActor @Observable
final class ScanModel {
    enum Phase: Equatable {
        case idle, scanning, processing, ready, uploading, uploaded(unitId: String)
    }

    var phase: Phase = .idle
    var files: ScanFiles?
    var error: String?
    var health: String?
    /// One controller (and RoomCaptureView) per scan, created when the user taps Scan.
    var scanner: ScanController?

    func startScan() {
        let controller = ScanController()
        controller.onData = { [weak self] data in self?.process(data) }
        controller.onError = { [weak self] message in self?.fail(message) }
        scanner = controller
        error = nil
        phase = .scanning
    }

    var apiBase: String = UserDefaults.standard.string(forKey: "apiBase") ?? "http://192.168.1.100:3001" {
        didSet { UserDefaults.standard.set(apiBase, forKey: "apiBase") }
    }
    var unitId: String = UserDefaults.standard.string(forKey: "unitId") ?? "" {
        didSet { UserDefaults.standard.set(unitId, forKey: "unitId") }
    }

    /// Called by the scanner once the user taps Done and RoomCaptureView hands over the raw data.
    func process(_ data: CapturedRoomData) {
        phase = .processing
        Task {
            do {
                let room = try await RoomBuilder(options: [.beautifyObjects]).capturedRoom(from: data)
                files = try ScanFiles.export(room)
                phase = .ready
            } catch {
                fail("Processing failed: \(error.localizedDescription)")
            }
        }
    }

    func upload() {
        guard let files else { return }
        let id = unitId.trimmingCharacters(in: .whitespaces).isEmpty ? "scan-\(UUID().uuidString.prefix(8).lowercased())" : unitId
        phase = .uploading
        error = nil
        Task {
            do {
                let returned = try await Uploader.upload(files, apiBase: apiBase, unitId: id)
                unitId = returned
                phase = .uploaded(unitId: returned)
            } catch {
                phase = .ready
                self.error = "Upload failed: \(error.localizedDescription). Use Share → AirDrop instead."
            }
        }
    }

    func checkHealth() {
        health = "Checking…"
        Task { health = await Uploader.health(apiBase: apiBase) }
    }

    func fail(_ message: String) {
        error = message
        phase = files == nil ? .idle : .ready
    }

    func reset() {
        files = nil
        error = nil
        phase = .idle
    }
}

struct ContentView: View {
    @State private var model = ScanModel()

    var body: some View {
        NavigationStack {
            Form {
                if !RoomCaptureSession.isSupported {
                    Section {
                        Label("This device can't run RoomPlan. It needs an iPhone or iPad with a LiDAR Scanner (iPhone 12 Pro or later Pro models).",
                              systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }

                Section("1 · Scan") {
                    Button(action: model.startScan) {
                        Label(model.files == nil ? "Scan room" : "Scan again", systemImage: "camera.viewfinder")
                            .font(.headline)
                    }
                    .disabled(!RoomCaptureSession.isSupported || model.phase == .processing || model.phase == .uploading)

                    if model.phase == .processing {
                        HStack { ProgressView(); Text("Building the room model…") }
                    }
                    if let files = model.files {
                        LabeledContent("Room", value: files.summary)
                    }
                }

                Section {
                    TextField("http://<mac-ip>:3001", text: $model.apiBase)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Unit ID (blank = new)", text: $model.unitId)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Test connection", action: model.checkHealth)
                    if let health = model.health { Text(health).font(.footnote).foregroundStyle(.secondary) }
                } header: {
                    Text("2 · Laptop")
                } footer: {
                    Text("Same Wi-Fi as the laptop. On the Mac, `ipconfig getifaddr en0` prints its IP; the API listens on PORT (default 3001).")
                }

                Section("3 · Send") {
                    Button {
                        model.upload()
                    } label: {
                        HStack {
                            Label("Upload to laptop", systemImage: "arrow.up.circle.fill")
                            if model.phase == .uploading { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(model.files == nil || model.phase == .uploading)

                    if let files = model.files {
                        ShareLink(items: [files.json, files.usdz]) {
                            Label("Share (AirDrop)", systemImage: "square.and.arrow.up")
                        }
                    }
                }

                if case .uploaded(let id) = model.phase {
                    Section("Uploaded") {
                        LabeledContent("Unit ID", value: id).textSelection(.enabled)
                        Text("Open on laptop: \(Uploader.webURL(apiBase: model.apiBase, unitId: id))")
                            .font(.footnote).textSelection(.enabled)
                    }
                }

                if let error = model.error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("LEDGER Scan")
        }
        .fullScreenCover(isPresented: Binding(get: { model.phase == .scanning },
                                              set: { if !$0 && model.phase == .scanning { model.phase = model.files == nil ? .idle : .ready } })) {
            if let scanner = model.scanner { ScanScreen(model: model, controller: scanner) }
        }
    }
}
