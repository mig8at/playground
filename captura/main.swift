// captura — una captura de pantalla por arrastre.
//
// Se abre, oscurece todas las pantallas, arrastrás un rectángulo y suelta: la imagen queda en
// captura/shots/ (o en OUT=…), en el portapapeles, y su ruta sale por stdout (para que un agente la
// lea). Esc cancela y sale con 1.
//
// Por qué AppKit y no un webview: la pieza es una ventana transparente sin bordes por ENCIMA de todo,
// en cada monitor, que se trague el mouse. Eso es nativo en AppKit; en un webview es pelearle al marco.
// La captura en sí la hace /usr/sbin/screencapture -R (el mismo motor de Cmd+Shift+4), así que no
// usamos APIs de captura que Apple va deprecando de versión en versión.
//
// Permiso: macOS da «Grabación de pantalla» a la app RESPONSABLE del proceso. Corrido desde una
// terminal, esa es la terminal (Antigravity, iTerm, Claude…), y cada una lo pide aparte. Por eso
// `make captura` arma Captura.app y la abre con `open`: así la responsable es ella y el permiso se da
// una sola vez. Como `open` no devuelve stdout ni el código de salida, el resultado va a --result.
//
//   captura --out <carpeta> [--result <archivo>] [--no-clip]
//   --result recibe UNA línea: «ok <ruta>», «cancel» o «error <mensaje>».

import AppKit

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}
let outDir = arg("--out") ?? (NSHomeDirectory() + "/Pictures/captura")
let resultFile = arg("--result")
let noClipboard = CommandLine.arguments.contains("--no-clip")

func report(_ line: String) {
    if let f = resultFile { try? (line + "\n").write(toFile: f, atomically: true, encoding: .utf8) }
    if line.hasPrefix("ok ") { print(String(line.dropFirst(3))) }
    else if line != "cancel" { FileHandle.standardError.write("captura: \(line)\n".data(using: .utf8)!) }
}

final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class SelectionView: NSView {
    var start: NSPoint?
    var current: NSPoint?
    var onDone: ((NSRect) -> Void)?
    var onCancel: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

    var selection: NSRect? {
        guard let s = start, let c = current else { return nil }
        return NSRect(x: min(s.x, c.x), y: min(s.y, c.y), width: abs(s.x - c.x), height: abs(s.y - c.y))
    }

    override func mouseDown(with e: NSEvent) { start = convert(e.locationInWindow, from: nil); current = start; needsDisplay = true }
    override func mouseDragged(with e: NSEvent) { current = convert(e.locationInWindow, from: nil); needsDisplay = true }
    override func mouseUp(with e: NSEvent) {
        current = convert(e.locationInWindow, from: nil)
        guard let r = selection, r.width >= 3, r.height >= 3 else { start = nil; current = nil; needsDisplay = true; return }
        onDone?(r)
    }
    override func keyDown(with e: NSEvent) { if e.keyCode == 53 { onCancel?() } } // Esc

    override func draw(_ dirty: NSRect) {
        let path = NSBezierPath(rect: bounds)
        if let r = selection { path.append(NSBezierPath(rect: r)); path.windingRule = .evenOdd }
        NSColor.black.withAlphaComponent(0.35).setFill()
        path.fill()
        guard let r = selection else { return }
        NSColor.white.setStroke()
        let border = NSBezierPath(rect: r.insetBy(dx: -0.5, dy: -0.5)); border.lineWidth = 1; border.stroke()
        // el tamaño, en puntos, arriba a la izquierda del recuadro
        let label = "\(Int(r.width)) × \(Int(r.height))" as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .medium), .foregroundColor: NSColor.white]
        let size = label.size(withAttributes: attrs)
        var p = NSPoint(x: r.minX, y: r.maxY + 4)
        if p.y + size.height + 4 > bounds.maxY { p.y = r.maxY - size.height - 6; p.x += 4 }
        let bg = NSRect(x: p.x - 3, y: p.y - 1, width: size.width + 6, height: size.height + 2)
        NSColor.black.withAlphaComponent(0.7).setFill(); NSBezierPath(roundedRect: bg, xRadius: 3, yRadius: 3).fill()
        label.draw(at: p, withAttributes: attrs)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var windows: [OverlayWindow] = []

    func applicationDidFinishLaunching(_ n: Notification) {
        for screen in NSScreen.screens {
            let w = OverlayWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = .screenSaver
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.ignoresMouseEvents = false
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            let v = SelectionView(frame: NSRect(origin: .zero, size: screen.frame.size))
            v.onCancel = { [weak self] in report("cancel"); self?.finish(code: 1) }
            v.onDone = { [weak self, weak w] r in
                guard let w else { return }
                self?.capture(local: r, in: w)
            }
            w.contentView = v
            w.setFrame(screen.frame, display: true)
            w.makeKeyAndOrderFront(nil)
            windows.append(w)
        }
        NSApp.activate(ignoringOtherApps: true)
        // la ventana bajo el mouse arranca con el foco, para que Esc funcione sin un clic previo
        let mouse = NSEvent.mouseLocation
        let first = windows.first { $0.frame.contains(mouse) } ?? windows.first
        first?.makeKeyAndOrderFront(nil)
        first?.makeFirstResponder(first?.contentView)
        NSCursor.crosshair.set()
    }

    func capture(local r: NSRect, in w: NSWindow) {
        // Cocoa: origen abajo-izquierda de la pantalla principal. screencapture -R: arriba-izquierda.
        let global = NSRect(x: w.frame.minX + r.minX, y: w.frame.minY + r.minY, width: r.width, height: r.height)
        let mainH = NSScreen.screens[0].frame.height
        let x = Int(global.minX.rounded()), y = Int((mainH - global.maxY).rounded())
        let wd = Int(global.width.rounded()), ht = Int(global.height.rounded())

        windows.forEach { $0.orderOut(nil) }
        // un respiro para que el compositor saque el velo antes de fotografiar
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'_'HH-mm-ss"
            let file = (outDir as NSString).appendingPathComponent("captura_\(f.string(from: Date())).png")
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-t", "png", "-R", "\(x),\(y),\(wd),\(ht)", file]
            do { try p.run(); p.waitUntilExit() } catch {
                report("error no corrió screencapture: \(error)")
                self.finish(code: 2); return
            }
            guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: file) else {
                report("error screencapture salió con \(p.terminationStatus): falta el permiso de Grabación de pantalla para Captura (Ajustes → Privacidad y seguridad)")
                self.finish(code: 2); return
            }
            if !noClipboard, let img = NSImage(contentsOfFile: file) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.writeObjects([img])
            }
            report("ok \(file)")
            self.finish(code: 0)
        }
    }

    func finish(code: Int32) { exit(code) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // sin ícono en el Dock
let delegate = AppDelegate()
app.delegate = delegate
app.run()
