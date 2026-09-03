import AVFAudio
import Foundation

public final class AppleAudioCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()

    public init() {}

    public func start(onPCM16: @escaping @Sendable (Data, Double) -> Void) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
            guard let channel = buffer.floatChannelData?.pointee else { return }
            var samples = Data(capacity: Int(buffer.frameLength) * 2)
            for index in 0..<Int(buffer.frameLength) {
                var value = Int16(max(-1, min(1, channel[index])) * Float(Int16.max)).littleEndian
                withUnsafeBytes(of: &value) { samples.append(contentsOf: $0) }
            }
            onPCM16(samples, format.sampleRate)
        }
        engine.prepare()
        try engine.start()
    }

    public func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
