// Rebuild from the iOS directory: swift scripts/generate-app-icon.swift
// Source: the project's shield/check paths in components/Brand.tsx.
// The green field is deliberately square; iOS applies its own app icon mask.
import AppKit

let size = 1024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                        bytesPerRow: size * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(red: 23 / 255, green: 107 / 255, blue: 91 / 255, alpha: 1)
context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.translateBy(x: 224, y: 836)
context.scaleBy(x: 24, y: -24)
context.move(to: CGPoint(x: 12, y: 2))
context.addLine(to: CGPoint(x: 3, y: 6))
context.addLine(to: CGPoint(x: 3, y: 14))
context.addCurve(to: CGPoint(x: 12, y: 25), control1: CGPoint(x: 3, y: 20), control2: CGPoint(x: 12, y: 25))
context.addCurve(to: CGPoint(x: 21, y: 14), control1: CGPoint(x: 12, y: 25), control2: CGPoint(x: 21, y: 20))
context.addLine(to: CGPoint(x: 21, y: 6))
context.closePath()
context.move(to: CGPoint(x: 8, y: 13))
context.addLine(to: CGPoint(x: 11, y: 16))
context.addLine(to: CGPoint(x: 16, y: 10))
context.setLineWidth(1.8)
context.setLineCap(.round)
context.setLineJoin(.round)
context.setStrokeColor(CGColor(gray: 1, alpha: 1))
context.strokePath()
let image = NSBitmapImageRep(cgImage: context.makeImage()!)
let output = CommandLine.arguments.dropFirst().first ?? "Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
print(output)
