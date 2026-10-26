// swift-tools-version:5.10
// Mustard 컴퓨터 사용 도우미(#1189) — 접근성(AX)으로 앱을 읽고 조작, ScreenCaptureKit으로 창 스크린샷.
import PackageDescription

let package = Package(
  name: "MustardComputerUse",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "MustardComputerUse",
      path: "Sources/MustardComputerUse",
      linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("ApplicationServices"), .linkedFramework("ScreenCaptureKit")]
    ),
  ]
)
