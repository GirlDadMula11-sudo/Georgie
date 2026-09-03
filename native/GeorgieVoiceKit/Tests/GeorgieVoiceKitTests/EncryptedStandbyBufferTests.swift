import XCTest
@testable import GeorgieVoiceKit

final class EncryptedStandbyBufferTests: XCTestCase {
    func testBufferIsBoundedAndDiscardable() async throws {
        let buffer = EncryptedStandbyBuffer(retention: .seconds(3), maximumBytes: 2_048)
        try await buffer.append(Data(repeating: 1, count: 1_500))
        try await buffer.append(Data(repeating: 2, count: 1_500))
        let retained = await buffer.retainedCiphertextBytes
        XCTAssertLessThanOrEqual(retained, 2_048)
        await buffer.discard()
        let empty = await buffer.retainedCiphertextBytes
        XCTAssertEqual(empty, 0)
    }
}
