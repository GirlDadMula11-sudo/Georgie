// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GeorgieVoiceKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "GeorgieVoiceKit", targets: ["GeorgieVoiceKit"])],
    targets: [
        .target(name: "GeorgieVoiceKit"),
        .testTarget(name: "GeorgieVoiceKitTests", dependencies: ["GeorgieVoiceKit"])
    ]
)
