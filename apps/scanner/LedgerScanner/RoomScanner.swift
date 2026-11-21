// [Rahim] Apple's live RoomPlan scan UI (RoomCaptureView) wrapped for SwiftUI.
import RoomPlan
import SwiftUI
import UIKit

/// Full-screen scan: Apple's live view plus Cancel / Done.
struct ScanScreen: View {
    let model: ScanModel
    let controller: ScanController

    var body: some View {
        ZStack {
            RoomCaptureRepresentable(controller: controller).ignoresSafeArea()
            VStack {
                HStack {
                    Button("Cancel") { controller.cancel(); model.phase = model.files == nil ? .idle : .ready }
                        .buttonStyle(.bordered)
                    Spacer()
                    Button("Done") { controller.finish() }
                        .buttonStyle(.borderedProminent)
                }
                .padding()
                Spacer()
            }
        }
        .onAppear { controller.start() }
    }
}

/// Owns the RoomCaptureView and is its delegate. The delegate protocol inherits NSCoding, hence the coder stubs.
@MainActor
final class ScanController: NSObject, RoomCaptureViewDelegate {
    let view = RoomCaptureView(frame: .zero)
    var onData: ((CapturedRoomData) -> Void)?
    var onError: ((String) -> Void)?
    private var cancelled = false

    override init() {
        super.init()
        view.delegate = self
    }

    nonisolated required init?(coder: NSCoder) { nil }
    nonisolated func encode(with coder: NSCoder) {}

    func start() {
        view.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    /// Done: stopping the session makes RoomCaptureView call captureView(shouldPresent:error:) with the raw data.
    func finish() {
        view.captureSession.stop()
    }

    func cancel() {
        cancelled = true
        view.captureSession.stop()
    }

    // Raw scan data arrives here after stop(). We return false (skip the view's own processing/preview)
    // and build the CapturedRoom ourselves with RoomBuilder in ScanModel.process.
    nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        MainActor.assumeIsolated {
            if cancelled { return }
            if let error {
                onError?("Scan failed: \(error.localizedDescription)")
            } else {
                onData?(roomDataForProcessing)
            }
        }
        return false
    }

    nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {}
}

struct RoomCaptureRepresentable: UIViewRepresentable {
    let controller: ScanController

    func makeUIView(context: Context) -> RoomCaptureView { controller.view }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}
