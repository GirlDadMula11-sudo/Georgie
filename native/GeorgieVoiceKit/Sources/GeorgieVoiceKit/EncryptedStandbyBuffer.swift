import CryptoKit
import Foundation

/// A bounded rolling buffer whose key exists only for this process lifetime.
/// Old ciphertext is discarded continuously; standby audio has no export API.
public actor EncryptedStandbyBuffer {
    private struct Chunk {
        let sealed: AES.GCM.SealedBox
        let recordedAt: ContinuousClock.Instant
    }

    private let key = SymmetricKey(size: .bits256)
    private let retention: Duration
    private let maximumBytes: Int
    private var chunks: [Chunk] = []
    private var byteCount = 0
    private let clock = ContinuousClock()

    public init(retention: Duration = .seconds(3), maximumBytes: Int = 192_000) {
        self.retention = retention
        self.maximumBytes = maximumBytes
    }

    public func append(_ pcm16: Data) throws {
        guard !pcm16.isEmpty, pcm16.count <= maximumBytes else { return }
        let sealed = try AES.GCM.seal(pcm16, using: key)
        chunks.append(Chunk(sealed: sealed, recordedAt: clock.now))
        byteCount += pcm16.count
        prune()
    }

    func localSnapshotForDetection() throws -> Data {
        prune()
        return try chunks.reduce(into: Data()) { output, chunk in
            output.append(try AES.GCM.open(chunk.sealed, using: key))
        }
    }

    public func discard() {
        chunks.removeAll(keepingCapacity: false)
        byteCount = 0
    }

    public var retainedCiphertextBytes: Int { byteCount }

    private func prune() {
        let cutoff = clock.now - retention
        while let first = chunks.first, first.recordedAt < cutoff || byteCount > maximumBytes {
            byteCount -= (try? AES.GCM.open(first.sealed, using: key).count) ?? 0
            chunks.removeFirst()
        }
    }
}
