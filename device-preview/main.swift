import AppKit
import WebKit
import Network

// MARK: - Device Definitions
//
// Sizes are CSS viewports in points (what `window.innerWidth/innerHeight` report
// on the device at default zoom), covering the common breakpoints:
// 360 / 375 / 402 / 412 / 440 phones, 744 / 820 / 1032 tablets, 1470 / 1920 desktops.
// Frame measurements are in the same points, drawn unscaled and then scaled to fit.

enum FrameKind { case island, homeButton, punchHole, tablet, laptop, monitor }
enum Side { case left, right, top, bottom }
enum UAKind { case iphone, android, ipad, mac }

/// A metal finish: the band's highlight, body and shadow tones.
struct Finish {
    let light: NSColor
    let mid: NSColor
    let dark: NSColor
    init(_ light: UInt32, _ mid: UInt32, _ dark: UInt32) {
        self.light = NSColor(hex: light)
        self.mid = NSColor(hex: mid)
        self.dark = NSColor(hex: dark)
    }
}

/// A hardware button on the portrait body: which edge, where it starts along that edge, how long.
struct HWButton {
    let side: Side
    let start: CGFloat
    let length: CGFloat
}

struct DeviceSpec {
    let id: String
    let name: String
    let short: String
    let width: CGFloat
    let height: CGFloat
    let kind: FrameKind
    let ua: UAKind
    let outerR: CGFloat     // body corner radius
    let band: CGFloat       // metal band width
    let bezel: CGFloat      // black border around the screen
    let top: CGFloat        // portrait strip above the viewport (status bar / forehead / menu bar)
    let bottom: CGFloat     // portrait strip below the viewport (chin)
    let finish: Finish
    let buttons: [HWButton]
    let cameraSide: Side    // tablets: which portrait edge the front camera sits on
    var rotatable: Bool { kind != .laptop && kind != .monitor }
    var group: Int {
        switch kind {
        case .island, .homeButton, .punchHole: return 0
        case .tablet: return 1
        case .laptop, .monitor: return 2
        }
    }
}

let DEVICES: [DeviceSpec] = [
    DeviceSpec(id: "iphone-se", name: "iPhone SE", short: "SE", width: 375, height: 667,
               kind: .homeButton, ua: .iphone, outerR: 58, band: 3, bezel: 16, top: 80, bottom: 80,
               finish: Finish(0x5a5b60, 0x2c2d31, 0x141416),
               buttons: [HWButton(side: .left, start: 62, length: 18), HWButton(side: .left, start: 112, length: 38),
                         HWButton(side: .left, start: 162, length: 38), HWButton(side: .right, start: 118, length: 46)],
               cameraSide: .top),
    DeviceSpec(id: "iphone-17-pro", name: "iPhone 17 Pro", short: "17 Pro", width: 402, height: 874,
               kind: .island, ua: .iphone, outerR: 64, band: 4, bezel: 7, top: 54, bottom: 0,
               finish: Finish(0x6e7179, 0x3b3e45, 0x1c1d21),
               buttons: [HWButton(side: .left, start: 118, length: 26), HWButton(side: .left, start: 172, length: 50),
                         HWButton(side: .left, start: 234, length: 50), HWButton(side: .right, start: 196, length: 78),
                         HWButton(side: .right, start: 404, length: 46)],
               cameraSide: .top),
    DeviceSpec(id: "iphone-17-pro-max", name: "iPhone 17 Pro Max", short: "Pro Max", width: 440, height: 956,
               kind: .island, ua: .iphone, outerR: 66, band: 4, bezel: 7, top: 56, bottom: 0,
               finish: Finish(0xeceef1, 0xbfc2c7, 0x8c8f95),
               buttons: [HWButton(side: .left, start: 126, length: 28), HWButton(side: .left, start: 184, length: 54),
                         HWButton(side: .left, start: 250, length: 54), HWButton(side: .right, start: 210, length: 84),
                         HWButton(side: .right, start: 440, length: 50)],
               cameraSide: .top),
    DeviceSpec(id: "galaxy-s25", name: "Galaxy S25", short: "Galaxy", width: 360, height: 780,
               kind: .punchHole, ua: .android, outerR: 46, band: 3.5, bezel: 6, top: 30, bottom: 0,
               finish: Finish(0x6f7b90, 0x3b4456, 0x1b2029),
               buttons: [HWButton(side: .right, start: 150, length: 70), HWButton(side: .right, start: 236, length: 38)],
               cameraSide: .top),
    DeviceSpec(id: "pixel-8", name: "Pixel 8", short: "Pixel", width: 412, height: 915,
               kind: .punchHole, ua: .android, outerR: 54, band: 4, bezel: 9, top: 32, bottom: 0,
               finish: Finish(0x5d6064, 0x313336, 0x17181a),
               buttons: [HWButton(side: .right, start: 160, length: 40), HWButton(side: .right, start: 220, length: 78)],
               cameraSide: .top),
    DeviceSpec(id: "ipad-mini", name: "iPad mini", short: "mini", width: 744, height: 1133,
               kind: .tablet, ua: .ipad, outerR: 46, band: 3, bezel: 24, top: 24, bottom: 0,
               finish: Finish(0x9a9ca1, 0x66686d, 0x3e4044),
               buttons: [HWButton(side: .top, start: 560, length: 60), HWButton(side: .right, start: 40, length: 48),
                         HWButton(side: .right, start: 100, length: 48)],
               cameraSide: .top),
    DeviceSpec(id: "ipad-air", name: "iPad Air 11″", short: "Air", width: 820, height: 1180,
               kind: .tablet, ua: .ipad, outerR: 48, band: 3, bezel: 22, top: 24, bottom: 0,
               finish: Finish(0xc9cbd0, 0x9a9da2, 0x6a6c71),
               buttons: [HWButton(side: .top, start: 640, length: 64), HWButton(side: .right, start: 46, length: 50),
                         HWButton(side: .right, start: 108, length: 50)],
               cameraSide: .right),
    DeviceSpec(id: "ipad-pro", name: "iPad Pro 13″", short: "Pro 13″", width: 1032, height: 1376,
               kind: .tablet, ua: .ipad, outerR: 44, band: 2.5, bezel: 19, top: 24, bottom: 0,
               finish: Finish(0x55565b, 0x2e2f33, 0x17181a),
               buttons: [HWButton(side: .top, start: 840, length: 70), HWButton(side: .right, start: 52, length: 54),
                         HWButton(side: .right, start: 118, length: 54)],
               cameraSide: .right),
    DeviceSpec(id: "desktop", name: "MacBook Air 13″", short: "MacBook", width: 1470, height: 956,
               kind: .laptop, ua: .mac, outerR: 22, band: 3, bezel: 12, top: 32, bottom: 24,
               finish: Finish(0x5b6272, 0x2f3440, 0x1a1d24),
               buttons: [], cameraSide: .top),
    DeviceSpec(id: "monitor", name: "Desktop 1080p", short: "1080p", width: 1920, height: 1080,
               kind: .monitor, ua: .mac, outerR: 14, band: 4, bezel: 22, top: 0, bottom: 0,
               finish: Finish(0xe4e6e9, 0xbcbfc3, 0x8f9296),
               buttons: [], cameraSide: .top),
]

/// Older ids from saved state and the Herdr popup.
let DEVICE_ALIASES: [String: String] = ["iphone-16": "iphone-17-pro", "iphone": "iphone-17-pro", "macbook": "desktop"]

let IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
let ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
let DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                  blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
}

// MARK: - Frame Geometry (unscaled points, y down)

struct FrameGeometry {
    var canvas: CGSize = .zero
    var body: CGRect = .zero        // the device's outer outline (lid for a laptop, panel for a monitor)
    var glass: CGRect = .zero       // the black front
    var screen: CGRect = .zero      // the web viewport
    var insets: NSEdgeInsets = NSEdgeInsets()   // screen inside glass
    var screenRadius: CGFloat = 0
    var roundedCorners: CACornerMask = []
    var base: CGRect = .zero        // laptop base / monitor foot
    var stand: CGRect = .zero       // monitor neck
}

func frameGeometry(_ d: DeviceSpec, landscape: Bool) -> FrameGeometry {
    var g = FrameGeometry()
    let land = landscape && d.rotatable
    let vpW = land ? d.height : d.width
    let vpH = land ? d.width : d.height
    let bz = d.bezel
    var ins = NSEdgeInsets(top: bz + d.top, left: bz, bottom: bz + d.bottom, right: bz)
    if land {
        switch d.kind {
        case .island:     // status bar hidden; symmetric safe areas, island on the left
            ins = NSEdgeInsets(top: bz, left: bz + d.top, bottom: bz, right: bz + d.top)
        case .punchHole:  // cutout side only
            ins = NSEdgeInsets(top: bz, left: bz + d.top, bottom: bz, right: bz)
        case .homeButton: // the whole phone turned: forehead left, chin right
            ins = NSEdgeInsets(top: bz, left: bz + d.top, bottom: bz, right: bz + d.bottom)
        default:          // tablets keep their status bar on top
            break
        }
    }
    let margin: CGFloat = (d.kind == .laptop || d.kind == .monitor) ? 0 : 3   // room for buttons
    let glassW = ins.left + vpW + ins.right
    let glassH = ins.top + vpH + ins.bottom

    switch d.kind {
    case .laptop:
        let overhang: CGFloat = 46, baseH: CGFloat = 17
        g.body = CGRect(x: overhang, y: 0, width: glassW + 2 * d.band, height: glassH + 2 * d.band)
        g.base = CGRect(x: 0, y: g.body.maxY - 2, width: g.body.width + 2 * overhang, height: baseH)
        g.canvas = CGSize(width: g.base.width, height: g.base.maxY)
    case .monitor:
        g.body = CGRect(x: 0, y: 0, width: glassW + 2 * d.band, height: glassH + 2 * d.band)
        let neckW: CGFloat = 220, neckH: CGFloat = 170, footW: CGFloat = 420, footH: CGFloat = 16
        g.stand = CGRect(x: g.body.midX - neckW / 2, y: g.body.maxY - 4, width: neckW, height: neckH)
        g.base = CGRect(x: g.body.midX - footW / 2, y: g.stand.maxY - 2, width: footW, height: footH)
        g.canvas = CGSize(width: g.body.width, height: g.base.maxY)
    default:
        g.body = CGRect(x: margin, y: margin, width: glassW + 2 * d.band, height: glassH + 2 * d.band)
        g.canvas = CGSize(width: g.body.width + 2 * margin, height: g.body.height + 2 * margin)
    }
    g.glass = g.body.insetBy(dx: d.band, dy: d.band)
    g.insets = ins
    g.screen = CGRect(x: g.glass.minX + ins.left, y: g.glass.minY + ins.top, width: vpW, height: vpH)

    // Screen corners follow the glass where no strip sits between them (concentric radii).
    g.screenRadius = max(0, d.outerR - d.band - bz)
    var mask: CACornerMask = []
    // The screen container is a flipped view, so its layer's MinY is the visual top.
    if ins.top == bz && ins.left == bz { mask.insert(.layerMinXMinYCorner) }
    if ins.top == bz && ins.right == bz { mask.insert(.layerMaxXMinYCorner) }
    if ins.bottom == bz && ins.left == bz { mask.insert(.layerMinXMaxYCorner) }
    if ins.bottom == bz && ins.right == bz { mask.insert(.layerMaxXMaxYCorner) }
    if d.kind == .laptop || d.kind == .monitor { mask = [] }
    g.roundedCorners = mask
    return g
}

/// Where a portrait button lands on the body (body-local coords), turned with the device.
func buttonRect(_ b: HWButton, body: CGRect, depth: CGFloat, landscape: Bool) -> CGRect {
    // Portrait: left/right measured from the top, top/bottom measured from the left.
    // Landscape is the device turned counter-clockwise: top→left, right→top, bottom→right, left→bottom.
    var side = b.side
    if landscape {
        switch b.side {
        case .top: side = .left
        case .right: side = .top
        case .bottom: side = .right
        case .left: side = .bottom
        }
    }
    let alongFromStart: CGFloat
    if landscape && (b.side == .top || b.side == .bottom) {
        alongFromStart = body.height - b.start - b.length   // measured from the landscape top
    } else {
        alongFromStart = b.start
    }
    switch side {
    case .left: return CGRect(x: body.minX - depth, y: body.minY + alongFromStart, width: depth + 2, height: b.length)
    case .right: return CGRect(x: body.maxX - 2, y: body.minY + alongFromStart, width: depth + 2, height: b.length)
    case .top: return CGRect(x: body.minX + alongFromStart, y: body.minY - depth, width: b.length, height: depth + 2)
    case .bottom: return CGRect(x: body.minX + alongFromStart, y: body.maxY - 2, width: b.length, height: depth + 2)
    }
}

// MARK: - Localhost SOCKS5 Proxy (resolves *.localhost -> 127.0.0.1 for WKWebView)

final class LocalhostSocksProxy {
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "dev.herdr.device-preview.proxy", qos: .userInitiated)
    private(set) var port: NWEndpoint.Port?

    func start() {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback
        guard let listener = try? NWListener(using: params, on: .any) else { return }
        self.listener = listener

        let sem = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.port = listener.port
                sem.signal()
            case .failed, .cancelled:
                sem.signal()
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] conn in
            self?.handleClient(conn)
        }
        listener.start(queue: queue)
        _ = sem.wait(timeout: .now() + 2.0)
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handleClient(_ client: NWConnection) {
        client.start(queue: queue)
        // Step 1: Read SOCKS5 greeting
        client.receive(minimumIncompleteLength: 2, maximumLength: 258) { [weak self] data, _, _, err in
            guard let self = self, let data = data, err == nil, data.count >= 2, data[0] == 0x05 else {
                client.cancel()
                return
            }
            // Reply: no authentication required
            client.send(content: Data([0x05, 0x00]), completion: .contentProcessed { err in
                if err != nil {
                    client.cancel()
                    return
                }
                self.readConnectRequest(client)
            })
        }
    }

    private func readConnectRequest(_ client: NWConnection) {
        client.receive(minimumIncompleteLength: 7, maximumLength: 512) { [weak self] data, _, _, err in
            guard let self = self, let data = data, err == nil, data.count >= 7,
                  data[0] == 0x05, data[1] == 0x01 else {
                client.cancel()
                return
            }

            let atyp = data[3]
            var host = ""
            var portOffset = 0

            switch atyp {
            case 0x01: // IPv4
                guard data.count >= 10 else { client.cancel(); return }
                host = "\(data[4]).\(data[5]).\(data[6]).\(data[7])"
                portOffset = 8
            case 0x03: // Domain name
                let len = Int(data[4])
                guard data.count >= 5 + len + 2 else { client.cancel(); return }
                let domainData = data.subdata(in: 5..<(5 + len))
                host = String(data: domainData, encoding: .utf8) ?? ""
                portOffset = 5 + len
            case 0x04: // IPv6
                guard data.count >= 22 else { client.cancel(); return }
                host = "::1"
                portOffset = 20
            default:
                client.cancel()
                return
            }

            let portVal = (UInt16(data[portOffset]) << 8) | UInt16(data[portOffset + 1])
            guard let nwPort = NWEndpoint.Port(rawValue: portVal) else {
                client.cancel()
                return
            }

            let lowered = host.lowercased()
            let targetHost = (lowered == "localhost" || lowered.hasSuffix(".localhost")) ? "127.0.0.1" : host

            let target = NWConnection(host: NWEndpoint.Host(targetHost), port: nwPort, using: .tcp)
            target.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    let reply = Data([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0])
                    client.send(content: reply, completion: .contentProcessed { err in
                        if err != nil {
                            client.cancel()
                            target.cancel()
                            return
                        }
                        self?.relay(from: client, to: target)
                        self?.relay(from: target, to: client)
                    })
                case .failed, .cancelled:
                    client.cancel()
                default:
                    break
                }
            }
            target.start(queue: self.queue)
        }
    }

    private func relay(from src: NWConnection, to dst: NWConnection) {
        src.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, err in
            if let data = data, !data.isEmpty {
                dst.send(content: data, completion: .contentProcessed { sendErr in
                    if sendErr != nil {
                        src.cancel()
                        dst.cancel()
                        return
                    }
                    if isComplete {
                        dst.cancel()
                    } else {
                        self?.relay(from: src, to: dst)
                    }
                })
            } else if isComplete || err != nil {
                src.cancel()
                dst.cancel()
            }
        }
    }
}

// MARK: - Window & Draggable Canvas

final class PreviewWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class DraggableView: NSView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

// MARK: - Device Frame Drawing
//
// Everything is drawn in unscaled device points under a scale transform, so the
// measurements in DEVICES read like the hardware. Hairlines use `px` (one screen pixel).

final class DeviceBezelView: NSView {
    var device: DeviceSpec = DEVICES[1]
    var isLandscape = false
    var scaleFactor: CGFloat = 1.0

    override var isFlipped: Bool { true }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }

    private var px: CGFloat { 1 / max(scaleFactor, 0.01) / (window?.backingScaleFactor ?? 2) }
    private var land: Bool { isLandscape && device.rotatable }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.saveGState()
        ctx.scaleBy(x: scaleFactor, y: scaleFactor)
        let g = frameGeometry(device, landscape: isLandscape)
        switch device.kind {
        case .laptop: drawLaptop(g)
        case .monitor: drawMonitor(g)
        default: drawHandheld(g)
        }
        ctx.restoreGState()
    }

    // MARK: Materials

    /// Brushed-metal band: lighter at the outer edges, a specular line on top, a dark seam inside.
    private func drawMetalBody(_ path: NSBezierPath, finish f: Finish, horizontal: Bool = true) {
        let grad = NSGradient(colorsAndLocations:
            (f.light, 0.0), (f.mid, 0.08), (f.dark, 0.5), (f.mid, 0.92), (f.light, 1.0))
        grad?.draw(in: path, angle: horizontal ? 0 : 90)
        // A soft top-lit sheen over the whole band.
        NSGradient(colors: [NSColor(white: 1, alpha: 0.16), NSColor(white: 1, alpha: 0.0), NSColor(white: 0, alpha: 0.18)])?
            .draw(in: path, angle: 90)
        NSColor(white: 0, alpha: 0.55).setStroke()
        path.lineWidth = px * 1.5
        path.stroke()
    }

    private func strokeInner(_ rect: CGRect, radius: CGFloat, color: NSColor, width: CGFloat) {
        let p = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
        color.setStroke()
        p.lineWidth = width
        p.stroke()
    }

    private func drawButton(_ r: CGRect, finish f: Finish) {
        let vertical = r.height > r.width
        let p = NSBezierPath(roundedRect: r, xRadius: min(r.width, r.height) / 2, yRadius: min(r.width, r.height) / 2)
        NSGradient(colorsAndLocations: (f.dark, 0), (f.light, 0.45), (f.mid, 0.7), (f.dark, 1))?
            .draw(in: p, angle: vertical ? 0 : 90)
        NSColor(white: 0, alpha: 0.5).setStroke()
        p.lineWidth = px
        p.stroke()
    }

    /// Front glass: black, with a faint lit edge and a diagonal reflection over the bezel.
    private func drawGlass(_ glass: CGRect, radius: CGFloat) {
        let p = NSBezierPath(roundedRect: glass, xRadius: radius, yRadius: radius)
        NSColor(hex: 0x050506).setFill()
        p.fill()
        NSGraphicsContext.saveGraphicsState()
        p.addClip()
        NSGradient(colorsAndLocations: (NSColor(white: 1, alpha: 0.075), 0), (NSColor(white: 1, alpha: 0.0), 0.42))?
            .draw(in: glass, angle: -55)
        NSGraphicsContext.restoreGraphicsState()
        strokeInner(glass.insetBy(dx: px, dy: px), radius: radius, color: NSColor(white: 1, alpha: 0.09), width: px * 1.2)
    }

    private func drawLens(center c: CGPoint, diameter d: CGFloat) {
        let r = CGRect(x: c.x - d / 2, y: c.y - d / 2, width: d, height: d)
        NSColor(hex: 0x15171c).setFill()
        NSBezierPath(ovalIn: r).fill()
        let inner = r.insetBy(dx: d * 0.2, dy: d * 0.2)
        NSGradient(colors: [NSColor(hex: 0x2b3f6b), NSColor(hex: 0x0b1020), NSColor(hex: 0x020306)])?
            .draw(in: NSBezierPath(ovalIn: inner), relativeCenterPosition: NSPoint(x: -0.3, y: 0.3))
        NSColor(white: 1, alpha: 0.45).setFill()
        let hl = d * 0.16
        NSBezierPath(ovalIn: CGRect(x: inner.minX + inner.width * 0.25, y: inner.minY + inner.height * 0.22, width: hl, height: hl)).fill()
    }

    // MARK: Status bar

    private func symbol(_ names: [String], size: CGFloat, color: NSColor) -> NSImage? {
        for n in names {
            if let img = NSImage(systemSymbolName: n, accessibilityDescription: nil) {
                let cfg = NSImage.SymbolConfiguration(pointSize: size, weight: .semibold)
                    .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
                return img.withSymbolConfiguration(cfg)
            }
        }
        return nil
    }

    private func drawImage(_ img: NSImage?, centerY: CGFloat, x: CGFloat) -> CGFloat {
        guard let img = img else { return 0 }
        let s = img.size
        img.draw(in: CGRect(x: x, y: centerY - s.height / 2, width: s.width, height: s.height),
                 from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        return s.width
    }

    /// Time on the left, signal / wifi / battery on the right, around a cutout in the middle.
    private func drawStatusBar(in rect: CGRect, cutout: CGFloat, fontSize: CGFloat, tablet: Bool) {
        let fg = NSColor(white: 0.97, alpha: 1)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: fontSize, weight: .semibold), .foregroundColor: fg,
        ]
        let side = (rect.width - cutout) / 2
        let time = NSAttributedString(string: tablet ? "9:41  Tue Sep 9" : "9:41", attributes: attrs)
        let ts = time.size()
        let tx = tablet ? rect.minX + 22 : rect.minX + max(14, (side - ts.width) / 2 + 6)
        time.draw(at: NSPoint(x: tx, y: rect.midY - ts.height / 2))

        let iconSize = fontSize * 0.82
        let icons = tablet
            ? [symbol(["wifi"], size: iconSize, color: fg), symbol(["battery.100percent", "battery.100"], size: iconSize * 1.05, color: fg)]
            : [symbol(["cellularbars"], size: iconSize, color: fg), symbol(["wifi"], size: iconSize, color: fg),
               symbol(["battery.100percent", "battery.100"], size: iconSize * 1.05, color: fg)]
        let widths = icons.map { $0?.size.width ?? 0 }
        let gap: CGFloat = 5
        let total = widths.reduce(0, +) + gap * CGFloat(max(0, icons.count - 1))
        var x = tablet ? rect.maxX - 22 - total : rect.maxX - max(14, (side - total) / 2 + 6) - total
        for img in icons {
            x += drawImage(img, centerY: rect.midY, x: x) + gap
        }
    }

    // MARK: Phones and tablets

    private func drawHandheld(_ g: FrameGeometry) {
        let d = device
        let f = d.finish
        // Buttons sit behind the body, poking out of its edge.
        for b in d.buttons {
            drawButton(buttonRect(b, body: g.body, depth: 3, landscape: land), finish: f)
        }
        let body = NSBezierPath(roundedRect: g.body, xRadius: d.outerR, yRadius: d.outerR)
        drawMetalBody(body, finish: f, horizontal: !land)

        // Antenna bands on phones: short plastic breaks across the metal.
        if d.kind != .tablet {
            let breaks: [CGFloat] = [d.outerR + 26, (land ? g.body.width : g.body.height) - d.outerR - 26]
            NSColor(white: 0.5, alpha: 0.35).setFill()
            for at in breaks {
                if land {
                    NSBezierPath(rect: CGRect(x: g.body.minX + at, y: g.body.minY, width: 2.5, height: d.band)).fill()
                    NSBezierPath(rect: CGRect(x: g.body.minX + at, y: g.body.maxY - d.band, width: 2.5, height: d.band)).fill()
                } else {
                    NSBezierPath(rect: CGRect(x: g.body.minX, y: g.body.minY + at, width: d.band, height: 2.5)).fill()
                    NSBezierPath(rect: CGRect(x: g.body.maxX - d.band, y: g.body.minY + at, width: d.band, height: 2.5)).fill()
                }
            }
        }

        let glassR = max(0, d.outerR - d.band)
        drawGlass(g.glass, radius: glassR)

        let ins = g.insets
        let s = g.screen
        switch d.kind {
        case .island:
            let diLong: CGFloat = 124, diShort: CGFloat = 36
            if !land {
                let strip = CGRect(x: g.glass.minX, y: g.glass.minY + d.bezel, width: g.glass.width, height: d.top)
                let di = CGRect(x: strip.midX - diLong / 2, y: strip.minY + 6, width: diLong, height: diShort)
                drawStatusBar(in: CGRect(x: s.minX, y: di.minY, width: s.width, height: diShort), cutout: diLong + 20, fontSize: 16, tablet: false)
                drawIsland(di)
            } else {
                let strip = CGRect(x: g.glass.minX + d.bezel, y: s.minY, width: ins.left - d.bezel, height: s.height)
                drawIsland(CGRect(x: strip.minX + 6, y: strip.midY - diLong / 2, width: diShort, height: diLong))
            }
        case .punchHole:
            let hole: CGFloat = 13
            if !land {
                let strip = CGRect(x: s.minX, y: g.glass.minY + d.bezel, width: s.width, height: d.top)
                drawStatusBar(in: strip, cutout: hole + 40, fontSize: 13.5, tablet: false)
                drawPunchHole(center: CGPoint(x: strip.midX, y: strip.midY), diameter: hole)
            } else {
                let strip = CGRect(x: g.glass.minX + d.bezel, y: s.minY, width: ins.left - d.bezel, height: s.height)
                drawPunchHole(center: CGPoint(x: strip.midX, y: strip.midY), diameter: hole)
            }
        case .homeButton:
            drawHomeButtonPhone(g)
        case .tablet:
            let strip = CGRect(x: s.minX, y: s.minY - d.top, width: s.width, height: d.top)
            drawStatusBar(in: strip, cutout: 0, fontSize: 13, tablet: true)
            // Front camera in the bezel of its edge (turned with the device).
            var camSide = d.cameraSide
            if land { camSide = camSide == .top ? .left : (camSide == .right ? .top : camSide) }
            let c: CGPoint
            switch camSide {
            case .top: c = CGPoint(x: g.glass.midX, y: g.glass.minY + d.bezel / 2)
            case .left: c = CGPoint(x: g.glass.minX + d.bezel / 2, y: g.glass.midY)
            case .right: c = CGPoint(x: g.glass.maxX - d.bezel / 2, y: g.glass.midY)
            case .bottom: c = CGPoint(x: g.glass.midX, y: g.glass.maxY - d.bezel / 2)
            }
            drawLens(center: c, diameter: 7)
        default:
            break
        }
    }

    private func drawIsland(_ r: CGRect) {
        let rad = min(r.width, r.height) / 2
        NSColor.black.setFill()
        NSBezierPath(roundedRect: r, xRadius: rad, yRadius: rad).fill()
        strokeInner(r, radius: rad, color: NSColor(white: 1, alpha: 0.05), width: px)
        // Front camera at the far end of the pill.
        let d = min(r.width, r.height) * 0.36
        let c = r.width > r.height
            ? CGPoint(x: r.maxX - rad, y: r.midY)
            : CGPoint(x: r.midX, y: r.minY + rad)
        drawLens(center: c, diameter: d)
    }

    private func drawPunchHole(center c: CGPoint, diameter d: CGFloat) {
        NSColor.black.setFill()
        NSBezierPath(ovalIn: CGRect(x: c.x - d / 2, y: c.y - d / 2, width: d, height: d)).fill()
        drawLens(center: c, diameter: d * 0.7)
    }

    private func drawHomeButtonPhone(_ g: FrameGeometry) {
        let d = device
        // Forehead (speaker + camera) and chin (Touch ID), turned with the device.
        let foreheadC: CGPoint, chinC: CGPoint
        if !land {
            foreheadC = CGPoint(x: g.glass.midX, y: g.glass.minY + (d.bezel + d.top) / 2)
            chinC = CGPoint(x: g.glass.midX, y: g.glass.maxY - (d.bezel + d.bottom) / 2)
        } else {
            foreheadC = CGPoint(x: g.glass.minX + (d.bezel + d.top) / 2, y: g.glass.midY)
            chinC = CGPoint(x: g.glass.maxX - (d.bezel + d.bottom) / 2, y: g.glass.midY)
        }
        let spk = land ? CGRect(x: foreheadC.x - 3, y: foreheadC.y - 24, width: 6, height: 48)
                       : CGRect(x: foreheadC.x - 24, y: foreheadC.y - 3, width: 48, height: 6)
        NSColor(hex: 0x1d1e21).setFill()
        NSBezierPath(roundedRect: spk, xRadius: 3, yRadius: 3).fill()
        strokeInner(spk, radius: 3, color: NSColor(white: 1, alpha: 0.07), width: px)
        drawLens(center: land ? CGPoint(x: foreheadC.x, y: foreheadC.y + 40) : CGPoint(x: foreheadC.x - 40, y: foreheadC.y), diameter: 10)

        let hb: CGFloat = 54
        let hr = CGRect(x: chinC.x - hb / 2, y: chinC.y - hb / 2, width: hb, height: hb)
        NSGradient(colors: [NSColor(hex: 0x1a1b1e), NSColor(hex: 0x0a0a0b)])?.draw(in: NSBezierPath(ovalIn: hr), angle: -90)
        let ring = NSBezierPath(ovalIn: hr.insetBy(dx: 1, dy: 1))
        NSGradient(colors: [d.finish.light, d.finish.dark])?.draw(in: ring, angle: -90)
        NSGradient(colors: [NSColor(hex: 0x1a1b1e), NSColor(hex: 0x070708)])?.draw(in: NSBezierPath(ovalIn: hr.insetBy(dx: 3, dy: 3)), angle: -90)
    }

    // MARK: Laptop

    private func drawLaptop(_ g: FrameGeometry) {
        let d = device
        let f = d.finish
        // Lid: thin anodised edge around a black glass panel.
        let lid = NSBezierPath()
        let r = d.outerR
        // Rounded top corners, nearly square bottom where the hinge is.
        lid.appendRoundedRect(g.body, xRadius: r, yRadius: r)
        drawMetalBody(lid, finish: f)
        let glassR = max(0, r - d.band)
        drawGlass(g.glass, radius: glassR)

        // Menu bar strip with the notch, then the chin with nothing on it.
        let s = g.screen
        let menu = CGRect(x: s.minX, y: s.minY - d.top, width: s.width, height: d.top)
        NSColor(hex: 0x1c1d21).setFill()
        NSBezierPath(rect: menu).fill()
        let fg = NSColor(white: 0.93, alpha: 1)
        let font = NSFont.systemFont(ofSize: 14, weight: .regular)
        var x = menu.minX + 18
        if let apple = symbol(["apple.logo"], size: 14, color: fg) { x += drawImage(apple, centerY: menu.midY, x: x) + 20 }
        for (i, item) in ["Safari", "File", "Edit", "View", "History", "Window", "Help"].enumerated() {
            let a = NSAttributedString(string: item, attributes: [
                .font: i == 0 ? NSFont.systemFont(ofSize: 14, weight: .bold) : font, .foregroundColor: fg])
            a.draw(at: NSPoint(x: x, y: menu.midY - a.size().height / 2))
            x += a.size().width + 20
        }
        let clock = NSAttributedString(string: "Tue Sep 9  9:41", attributes: [.font: font, .foregroundColor: fg])
        var rx = menu.maxX - 18 - clock.size().width
        clock.draw(at: NSPoint(x: rx, y: menu.midY - clock.size().height / 2))
        for name in [["battery.100percent", "battery.100"], ["wifi"], ["magnifyingglass"]] {
            if let img = symbol(name, size: 13, color: fg) {
                rx -= img.size.width + 16
                _ = drawImage(img, centerY: menu.midY, x: rx)
            }
        }
        // Notch: drops from the top of the glass into the menu bar.
        let nw: CGFloat = 196, nh: CGFloat = d.top + d.bezel - 1
        let n = CGRect(x: g.glass.midX - nw / 2, y: g.glass.minY, width: nw, height: nh)
        let notch = NSBezierPath()
        let nr: CGFloat = 10
        notch.move(to: NSPoint(x: n.minX - 6, y: n.minY))
        notch.curve(to: NSPoint(x: n.minX, y: n.minY + 6), controlPoint1: NSPoint(x: n.minX - 1, y: n.minY), controlPoint2: NSPoint(x: n.minX, y: n.minY + 1))
        notch.line(to: NSPoint(x: n.minX, y: n.maxY - nr))
        notch.curve(to: NSPoint(x: n.minX + nr, y: n.maxY), controlPoint1: NSPoint(x: n.minX, y: n.maxY - 3), controlPoint2: NSPoint(x: n.minX + 3, y: n.maxY))
        notch.line(to: NSPoint(x: n.maxX - nr, y: n.maxY))
        notch.curve(to: NSPoint(x: n.maxX, y: n.maxY - nr), controlPoint1: NSPoint(x: n.maxX - 3, y: n.maxY), controlPoint2: NSPoint(x: n.maxX, y: n.maxY - 3))
        notch.line(to: NSPoint(x: n.maxX, y: n.minY + 6))
        notch.curve(to: NSPoint(x: n.maxX + 6, y: n.minY), controlPoint1: NSPoint(x: n.maxX, y: n.minY + 1), controlPoint2: NSPoint(x: n.maxX + 1, y: n.minY))
        notch.close()
        NSColor(hex: 0x050506).setFill()
        notch.fill()
        drawLens(center: CGPoint(x: n.midX, y: n.minY + d.bezel / 2 + 8), diameter: 8)

        // Hinge shadow under the lid, then the base with its lip and thumb scoop.
        let base = g.base
        let bp = NSBezierPath()
        let lipR: CGFloat = 10
        bp.move(to: NSPoint(x: base.minX + 4, y: base.minY))
        bp.line(to: NSPoint(x: base.maxX - 4, y: base.minY))
        bp.curve(to: NSPoint(x: base.maxX, y: base.minY + 6), controlPoint1: NSPoint(x: base.maxX - 1, y: base.minY), controlPoint2: NSPoint(x: base.maxX, y: base.minY + 2))
        bp.line(to: NSPoint(x: base.maxX - lipR * 0.6, y: base.maxY - lipR * 0.3))
        bp.curve(to: NSPoint(x: base.maxX - lipR * 2.2, y: base.maxY), controlPoint1: NSPoint(x: base.maxX - lipR, y: base.maxY), controlPoint2: NSPoint(x: base.maxX - lipR * 1.6, y: base.maxY))
        bp.line(to: NSPoint(x: base.minX + lipR * 2.2, y: base.maxY))
        bp.curve(to: NSPoint(x: base.minX + lipR * 0.6, y: base.maxY - lipR * 0.3), controlPoint1: NSPoint(x: base.minX + lipR * 1.6, y: base.maxY), controlPoint2: NSPoint(x: base.minX + lipR, y: base.maxY))
        bp.line(to: NSPoint(x: base.minX, y: base.minY + 6))
        bp.curve(to: NSPoint(x: base.minX + 4, y: base.minY), controlPoint1: NSPoint(x: base.minX, y: base.minY + 2), controlPoint2: NSPoint(x: base.minX + 1, y: base.minY))
        bp.close()
        NSGradient(colorsAndLocations: (f.light, 0), (f.mid, 0.3), (f.dark, 1))?.draw(in: bp, angle: -90)
        NSGradient(colorsAndLocations: (NSColor(white: 0, alpha: 0.35), 0), (NSColor(white: 0, alpha: 0), 0.06),
                   (NSColor(white: 0, alpha: 0), 0.94), (NSColor(white: 0, alpha: 0.35), 1))?.draw(in: bp, angle: 0)
        NSColor(white: 1, alpha: 0.35).setStroke()
        let edge = NSBezierPath()
        edge.move(to: NSPoint(x: base.minX + 6, y: base.minY + 0.5))
        edge.line(to: NSPoint(x: base.maxX - 6, y: base.minY + 0.5))
        edge.lineWidth = px * 1.5
        edge.stroke()
        // Hinge: a dark band where the lid meets the base.
        NSColor(white: 0, alpha: 0.55).setFill()
        NSBezierPath(rect: CGRect(x: g.body.minX + 30, y: base.minY, width: g.body.width - 60, height: 3)).fill()
        // Thumb scoop.
        let sw: CGFloat = 150, sh: CGFloat = 6
        let scoop = CGRect(x: base.midX - sw / 2, y: base.minY + 0.5, width: sw, height: sh)
        NSGradient(colors: [f.dark, f.mid])?.draw(in: NSBezierPath(roundedRect: scoop, xRadius: sh / 2, yRadius: sh / 2), angle: -90)
    }

    // MARK: Monitor

    private func drawMonitor(_ g: FrameGeometry) {
        let d = device
        let f = d.finish
        // Stand behind the panel: neck then foot.
        let neck = NSBezierPath()
        let st = g.stand
        neck.move(to: NSPoint(x: st.minX + 14, y: st.minY))
        neck.line(to: NSPoint(x: st.maxX - 14, y: st.minY))
        neck.line(to: NSPoint(x: st.maxX, y: st.maxY))
        neck.line(to: NSPoint(x: st.minX, y: st.maxY))
        neck.close()
        NSGradient(colorsAndLocations: (f.dark, 0), (f.light, 0.35), (f.mid, 0.7), (f.dark, 1))?.draw(in: neck, angle: 0)
        NSGradient(colors: [NSColor(white: 0, alpha: 0.45), NSColor(white: 0, alpha: 0)])?
            .draw(in: CGRect(x: st.minX, y: st.minY, width: st.width, height: 40), angle: -90)
        let foot = NSBezierPath(roundedRect: g.base, xRadius: 6, yRadius: 6)
        NSGradient(colorsAndLocations: (f.light, 0), (f.mid, 0.5), (f.dark, 1))?.draw(in: foot, angle: -90)
        NSColor(white: 0, alpha: 0.4).setStroke()
        foot.lineWidth = px
        foot.stroke()

        let body = NSBezierPath(roundedRect: g.body, xRadius: d.outerR, yRadius: d.outerR)
        drawMetalBody(body, finish: f)
        drawGlass(g.glass, radius: max(0, d.outerR - d.band))
        drawLens(center: CGPoint(x: g.glass.midX, y: g.glass.minY + d.bezel / 2), diameter: 8)
    }
}

/// Drawn over the web content: the home indicator / gesture handle. Clicks pass through.
final class ScreenOverlayView: NSView {
    var device: DeviceSpec = DEVICES[1]
    var isLandscape = false
    var scaleFactor: CGFloat = 1.0
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        let s = scaleFactor
        let land = isLandscape && device.rotatable
        let w: CGFloat, h: CGFloat, gap: CGFloat
        switch device.kind {
        case .island: (w, h, gap) = (land ? 210 : 140, 5, 8)
        case .punchHole: (w, h, gap) = (108, 4, 10)
        case .tablet: (w, h, gap) = (land ? 320 : 300, 5, 8)
        default: return
        }
        let r = CGRect(x: bounds.midX - w * s / 2, y: bounds.maxY - (gap + h) * s, width: w * s, height: h * s)
        let p = NSBezierPath(roundedRect: r, xRadius: h * s / 2, yRadius: h * s / 2)
        NSColor(white: 0.08, alpha: 0.62).setFill()
        p.fill()
        NSColor(white: 1, alpha: 0.35).setStroke()
        p.lineWidth = 0.5
        p.stroke()
    }
}

// MARK: - App Delegate & Main Controller

final class DevicePreviewController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var urlString: String
    var projectTitle: String
    var deviceIndex: Int
    var isLandscape: Bool
    var snapshotPath: String?

    var window: PreviewWindow!
    var rootView: DraggableView!
    var toolbarView: NSVisualEffectView!
    var bezelView: DeviceBezelView!
    var screenContainer: FlippedView!
    var overlayView: ScreenOverlayView!
    var webView: WKWebView!
    var infoLabel: NSTextField!
    var deviceButtons: [NSButton] = []
    var rotateButton: NSButton!

    let proxy = LocalhostSocksProxy()
    var keyMonitor: Any?

    init(url: String, title: String, deviceId: String, landscape: Bool, snapshot: String?) {
        self.urlString = url
        self.projectTitle = title
        let id = DEVICE_ALIASES[deviceId] ?? deviceId
        self.deviceIndex = DEVICES.firstIndex(where: { $0.id == id }) ?? 1
        self.isLandscape = landscape
        self.snapshotPath = snapshot
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupMenu()
        if snapshotPath == nil { proxy.start() }
        setupWebView()
        setupWindow()
        layoutForCurrentDevice(recenter: true)

        if let path = snapshotPath {
            DispatchQueue.main.async { self.writeSnapshot(to: path) }
            return
        }
        installKeyMonitor()
        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    /// Renders the window's content (frame and toolbar; the page itself stays blank) to a PNG and quits.
    private func writeSnapshot(to path: String) {
        let view = rootView!
        view.layoutSubtreeIfNeeded()
        view.display()
        guard let layer = view.layer else { exit(1) }
        let scale: CGFloat = 2
        let w = Int(view.bounds.width * scale), h = Int(view.bounds.height * scale)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
        ctx.scaleBy(x: scale, y: scale)
        layer.render(in: ctx)
        guard let img = ctx.makeImage() else { exit(1) }
        let rep = NSBitmapImageRep(cgImage: img)
        guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }
        do { try data.write(to: URL(fileURLWithPath: path)) } catch { exit(1) }
        exit(0)
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let m = keyMonitor {
            NSEvent.removeMonitor(m)
        }
        proxy.stop()
        if snapshotPath == nil { activateHerdr() }
    }

    private func activateHerdr() {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "dev.herdr.app")
        if let herdr = apps.first {
            if #available(macOS 14.0, *) {
                herdr.activate()
            } else {
                herdr.activate(options: .activateIgnoringOtherApps)
            }
        } else {
            let task = Process()
            task.launchPath = "/usr/bin/open"
            task.arguments = ["-b", "dev.herdr.app"]
            try? task.run()
        }
    }

    private func setupMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Close", action: #selector(closePreview), keyEquivalent: "w")
        appMenu.addItem(withTitle: "Quit", action: #selector(closePreview), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        let dataStore = WKWebsiteDataStore.default()
        if #available(macOS 14.0, *), let pPort = proxy.port {
            let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: pPort)
            var proxyCfg = ProxyConfiguration(socksv5Proxy: endpoint)
            proxyCfg.matchDomains = ["localhost", ".localhost"]
            dataStore.proxyConfigurations = [proxyCfg]
        }
        config.websiteDataStore = dataStore
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        updateUserAgent()
    }

    private func updateUserAgent() {
        switch DEVICES[deviceIndex].ua {
        case .iphone: webView.customUserAgent = IPHONE_UA
        case .android: webView.customUserAgent = ANDROID_UA
        case .ipad, .mac: webView.customUserAgent = DESKTOP_UA   // iPadOS Safari asks for desktop sites too
        }
    }

    private func separator() -> NSView {
        let sep = NSView()
        sep.wantsLayer = true
        sep.layer?.backgroundColor = NSColor(white: 1.0, alpha: 0.13).cgColor
        sep.widthAnchor.constraint(equalToConstant: 52).isActive = true
        sep.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return sep
    }

    private func setupWindow() {
        window = PreviewWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 900),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .floating
        window.isMovableByWindowBackground = false

        rootView = DraggableView(frame: .zero)
        rootView.wantsLayer = true
        window.contentView = rootView

        // Floating control capsule beside the device.
        toolbarView = NSVisualEffectView(frame: .zero)
        toolbarView.material = .hudWindow
        toolbarView.state = .active
        toolbarView.blendingMode = .behindWindow
        toolbarView.wantsLayer = true
        toolbarView.layer?.cornerRadius = 14
        toolbarView.layer?.borderWidth = 1
        toolbarView.layer?.borderColor = NSColor(white: 1.0, alpha: 0.14).cgColor
        rootView.addSubview(toolbarView)

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 4
        stack.alignment = .centerX
        stack.translatesAutoresizingMaskIntoConstraints = false
        toolbarView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: toolbarView.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: toolbarView.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: toolbarView.topAnchor, constant: 10),
            stack.bottomAnchor.constraint(equalTo: toolbarView.bottomAnchor, constant: -10),
        ])

        // Devices grouped phones / tablets / desktops.
        var lastGroup = DEVICES.first?.group ?? 0
        for (idx, d) in DEVICES.enumerated() {
            if d.group != lastGroup {
                stack.setCustomSpacing(8, after: stack.arrangedSubviews.last!)
                stack.addArrangedSubview(separator())
                stack.setCustomSpacing(8, after: stack.arrangedSubviews.last!)
                lastGroup = d.group
            }
            let btn = makePillButton(title: d.short, tag: idx, action: #selector(selectDevice(_:)), width: 66)
            let key = idx < 9 ? "⌘\(idx + 1)" : (idx == 9 ? "⌘0" : "")
            btn.toolTip = "\(d.name) — \(Int(d.width))×\(Int(d.height)) \(key)"
            deviceButtons.append(btn)
            stack.addArrangedSubview(btn)
        }

        stack.setCustomSpacing(8, after: stack.arrangedSubviews.last!)
        stack.addArrangedSubview(separator())

        let actionRow = NSStackView()
        actionRow.orientation = .horizontal
        actionRow.spacing = 4
        actionRow.alignment = .centerY

        rotateButton = makePillButton(title: "↻", tag: 100, action: #selector(toggleRotate), width: 31)
        rotateButton.toolTip = "Rotate (⌘L)"
        actionRow.addArrangedSubview(rotateButton)

        let reloadBtn = makePillButton(title: "⟳", tag: 101, action: #selector(reloadPage), width: 31)
        reloadBtn.toolTip = "Reload (⌘R)"
        actionRow.addArrangedSubview(reloadBtn)
        stack.addArrangedSubview(actionRow)

        infoLabel = NSTextField(wrappingLabelWithString: "")
        infoLabel.alignment = .center
        infoLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 9.5, weight: .regular)
        infoLabel.textColor = NSColor(white: 0.72, alpha: 1.0)
        infoLabel.preferredMaxLayoutWidth = 70
        stack.addArrangedSubview(infoLabel)

        stack.addArrangedSubview(separator())

        let closeBtn = makePillButton(title: "✕", tag: 102, action: #selector(closePreview), width: 66)
        closeBtn.toolTip = "Close (Esc)"
        stack.addArrangedSubview(closeBtn)

        // Device frame, the screen inside it, and the overlay above the page.
        bezelView = DeviceBezelView(frame: .zero)
        bezelView.wantsLayer = true
        rootView.addSubview(bezelView)

        screenContainer = FlippedView(frame: .zero)
        screenContainer.wantsLayer = true
        screenContainer.layer?.masksToBounds = true
        screenContainer.layer?.backgroundColor = NSColor(hex: snapshotPath == nil ? 0xffffff : 0xeef1f6).cgColor
        bezelView.addSubview(screenContainer)
        screenContainer.addSubview(webView)

        overlayView = ScreenOverlayView(frame: .zero)
        screenContainer.addSubview(overlayView)
    }

    private func makePillButton(title: String, tag: Int, action: Selector, width: CGFloat? = nil) -> NSButton {
        let btn = NSButton(title: title, target: self, action: action)
        btn.tag = tag
        btn.isBordered = false
        btn.wantsLayer = true
        btn.layer?.cornerRadius = 6
        btn.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        btn.contentTintColor = NSColor(white: 0.88, alpha: 1.0)
        btn.heightAnchor.constraint(equalToConstant: 23).isActive = true
        if let w = width {
            btn.widthAnchor.constraint(equalToConstant: w).isActive = true
        }
        return btn
    }

    @objc private func selectDevice(_ sender: NSButton) {
        switchDevice(to: sender.tag)
    }

    private func switchDevice(to index: Int) {
        guard index >= 0 && index < DEVICES.count, index != deviceIndex else { return }
        let uaBefore = DEVICES[deviceIndex].ua
        deviceIndex = index
        if !DEVICES[deviceIndex].rotatable {
            isLandscape = false
        }
        updateUserAgent()
        layoutForCurrentDevice(recenter: false)
        // Only a new user agent needs the page fetched again; the size change reflows by itself.
        if DEVICES[deviceIndex].ua != uaBefore { webView.reload() }
    }

    @objc private func toggleRotate() {
        guard DEVICES[deviceIndex].rotatable else { return }
        isLandscape.toggle()
        layoutForCurrentDevice(recenter: false)
    }

    @objc private func reloadPage() {
        webView.reload()
    }

    @objc private func closePreview() {
        window.orderOut(nil)
        activateHerdr()
        NSApp.terminate(nil)
    }

    private func installKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self else { return event }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let chars = event.charactersIgnoringModifiers?.lowercased() ?? ""

            if event.keyCode == 53 { // Esc
                self.closePreview()
                return nil
            }
            if flags == .command {
                if chars == "w" {
                    self.closePreview()
                    return nil
                }
                if chars == "r" {
                    self.reloadPage()
                    return nil
                }
                if chars == "l" {
                    self.toggleRotate()
                    return nil
                }
                if let n = Int(chars) {
                    let idx = n == 0 ? 9 : n - 1
                    if idx < DEVICES.count {
                        self.switchDevice(to: idx)
                        return nil
                    }
                }
            } else if flags == [.command, .shift] && chars == "r" {
                self.webView.reloadFromOrigin()
                return nil
            }
            return event
        }
    }

    // MARK: - Responsive Geometry & Auto-Scaling

    private func layoutForCurrentDevice(recenter: Bool) {
        let d = DEVICES[deviceIndex]
        let land = isLandscape && d.rotatable
        let g = frameGeometry(d, landscape: land)

        let toolbarGap: CGFloat = 14
        let toolbarW: CGFloat = 82
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)

        let maxAllowedW = screenFrame.width - toolbarW - toolbarGap - 40
        let maxAllowedH = screenFrame.height - 32
        let s = min(1.0, min(maxAllowedW / g.canvas.width, maxAllowedH / g.canvas.height))

        let deviceW = round(g.canvas.width * s)
        let deviceH = round(g.canvas.height * s)

        for (idx, btn) in deviceButtons.enumerated() {
            let active = idx == deviceIndex
            btn.layer?.backgroundColor = active
                ? NSColor(calibratedRed: 0.25, green: 0.52, blue: 0.96, alpha: 0.9).cgColor
                : NSColor(white: 1.0, alpha: 0.06).cgColor
            btn.contentTintColor = active ? .white : NSColor(white: 0.85, alpha: 1.0)
        }
        rotateButton.isEnabled = d.rotatable
        rotateButton.alphaValue = d.rotatable ? 1.0 : 0.35

        let vpW = g.screen.width, vpH = g.screen.height
        let pct = Int(round(s * 100))
        infoLabel.stringValue = "\(Int(vpW))×\(Int(vpH))" + (pct < 100 ? "\n\(pct)%" : "")

        let toolbarH = toolbarView.fittingSize.height
        let winW = deviceW + toolbarGap + toolbarW
        let winH = max(deviceH, toolbarH)

        var newOrigin = NSPoint(x: screenFrame.midX - winW / 2, y: screenFrame.midY - winH / 2)
        if !recenter {
            // Keep the top-left corner where it was, inside the visible screen.
            let oldFrame = window.frame
            newOrigin.x = oldFrame.minX
            newOrigin.y = oldFrame.maxY - winH
            if newOrigin.x + winW > screenFrame.maxX - 10 {
                newOrigin.x = max(screenFrame.minX + 10, screenFrame.maxX - 10 - winW)
            }
            if newOrigin.y < screenFrame.minY + 10 {
                newOrigin.y = screenFrame.minY + 10
            }
            if newOrigin.y + winH > screenFrame.maxY - 6 {
                newOrigin.y = screenFrame.maxY - 6 - winH
            }
        }
        window.setFrame(NSRect(origin: newOrigin, size: NSSize(width: winW, height: winH)), display: true)
        rootView.frame = NSRect(x: 0, y: 0, width: winW, height: winH)

        // AppKit's y=0 is at the bottom for rootView.
        let bezelY = round((winH - deviceH) / 2)
        bezelView.frame = NSRect(x: 0, y: bezelY, width: deviceW, height: deviceH)
        toolbarView.frame = NSRect(x: deviceW + toolbarGap, y: round((winH - toolbarH) / 2), width: toolbarW, height: toolbarH)

        bezelView.device = d
        bezelView.isLandscape = land
        bezelView.scaleFactor = s

        // The screen inside the bezel (bezelView is flipped, y=0 at top).
        let sr = g.screen
        screenContainer.frame = NSRect(x: round(sr.minX * s), y: round(sr.minY * s), width: round(sr.width * s), height: round(sr.height * s))

        // Clip the page to the glass: rounded where no strip sits between screen and glass edge.
        // An empty mask means "all corners" to Core Animation: no rounded corners means radius 0.
        screenContainer.layer?.cornerRadius = g.roundedCorners.isEmpty ? 0 : g.screenRadius * s
        // AppKit flips a flipped view's layer, so MinY here is the visual top.
        screenContainer.layer?.maskedCorners = g.roundedCorners
        if #available(macOS 11.0, *) { screenContainer.layer?.cornerCurve = .continuous }

        webView.frame = screenContainer.bounds
        webView.pageZoom = s
        overlayView.frame = screenContainer.bounds
        overlayView.device = d
        overlayView.isLandscape = land
        overlayView.scaleFactor = s
        overlayView.needsDisplay = true

        bezelView.needsDisplay = true
        window.invalidateShadow()
    }
}

// MARK: - CLI Entry Point

var argURL = ""
var argDevice = "iphone-17-pro"
var argLandscape = false
var argTitle = "Preview"
var argSnapshot: String? = nil

let args = CommandLine.arguments
var i = 1
while i < args.count {
    switch args[i] {
    case "--url":
        if i + 1 < args.count { argURL = args[i + 1]; i += 1 }
    case "--device":
        if i + 1 < args.count { argDevice = args[i + 1]; i += 1 }
    case "--title":
        if i + 1 < args.count { argTitle = args[i + 1]; i += 1 }
    case "--snapshot":
        if i + 1 < args.count { argSnapshot = args[i + 1]; i += 1 }
    case "--landscape":
        argLandscape = true
    case "--list":
        for (n, d) in DEVICES.enumerated() {
            print("\(n < 9 ? String(n + 1) : "0")\t\(d.id)\t\(d.name)\t\(Int(d.width))x\(Int(d.height))")
        }
        exit(0)
    default:
        if argURL.isEmpty && args[i].hasPrefix("http") {
            argURL = args[i]
        }
    }
    i += 1
}

if argURL.isEmpty && argSnapshot == nil {
    fputs("usage: device-preview --url <url> [--device <id>] [--landscape] [--title <title>]\n" +
          "       device-preview --snapshot <out.png> [--device <id>] [--landscape]\n" +
          "       device-preview --list\n", stderr)
    exit(2)
}

let app = NSApplication.shared
let controller = DevicePreviewController(url: argURL, title: argTitle, deviceId: argDevice, landscape: argLandscape, snapshot: argSnapshot)
app.delegate = controller
app.run()
