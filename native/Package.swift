// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "AcousticLab", platforms: [.macOS(.v14), .tvOS(.v17)], products: [
    .library(name: "AcousticCore", targets: ["AcousticCore"]),
    .library(name: "AcousticTransport", targets: ["AcousticTransport"]),
    .executable(name: "acoustic-lab", targets: ["AcousticMac"])
], dependencies: [.package(path: "Vendor/HAP"), .package(url: "https://github.com/apple/swift-nio.git", exact: "2.102.0")], targets: [
    .target(name: "DenonControl", resources: [.process("Resources")]),
    .target(name: "AcousticCore"),
    .target(name: "AcousticTransport"),
    .target(name: "RealtimeState", publicHeadersPath: "include"),
    .executableTarget(name: "AcousticMac", dependencies: ["AcousticCore", "AcousticTransport", "RealtimeState", "DenonControl", .product(name: "NIO", package: "swift-nio"), .product(name: "NIOHTTP1", package: "swift-nio"), .product(name: "HAP", package: "HAP", condition: .when(platforms: [.macOS]))]),
    .testTarget(name: "AcousticCoreTests", dependencies: ["AcousticCore"]),
    .testTarget(name: "DenonControlTests", dependencies: ["DenonControl"], resources: [.copy("Fixtures")])
], swiftLanguageModes: [.v5])
