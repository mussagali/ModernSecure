// Deterministic asset packaging: preserve the company's existing mark exactly.
// Run from apps/mobile_webview/ios. iOS supplies the outer rounded mask.
import AppKit

let source = URL(fileURLWithPath: "Sources/Assets.xcassets/CompanyMark.imageset/CompanyMark.png")
guard let image = NSImage(contentsOf: source),
      let logo = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
        bytesPerRow: 4096, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("Company mark or RGB graphics context unavailable")
}
context.setFillColor(CGColor(gray: 1, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.interpolationQuality = .high
context.draw(logo, in: CGRect(x: 128, y: 128, width: 768, height: 768))
let result = NSBitmapImageRep(cgImage: context.makeImage()!)
let output = "Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
try result.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
print(output)
