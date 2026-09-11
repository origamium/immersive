// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "AcousticLab", platforms: [.macOS(.v14), .tvOS(.v17)], products: [
    .library(name: "AcousticCore", targets: ["AcousticCore"]),
    .library(name: "AcousticTransport", targets: ["AcousticTransport"]),
    .executable(name: "acoustic-lab", targets: ["AcousticMac"])
], targets: [
    .target(name: "AcousticCore"),
    .target(name: "AcousticTransport"),
    .target(name: "RealtimeState", publicHeadersPath: "include"),
    .executableTarget(name: "AcousticMac", dependencies: ["AcousticCore", "AcousticTransport", "RealtimeState"]),
    .testTarget(name: "AcousticCoreTests", dependencies: ["AcousticCore"])
], swiftLanguageModes: [.v5])
