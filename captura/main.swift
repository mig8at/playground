// captura — una captura de pantalla por arrastre o señalando.
//
// Se abre y oscurece todas las pantallas. Dos formas de elegir qué capturar:
//   · SEÑALAR: al pasar el mouse se ilumina lo que está debajo y un CLIC lo captura. Con el permiso de
//     Accesibilidad lo iluminado es la sección de la app (un panel, una barra, un botón) y la RUEDA
//     sube a la que la contiene o baja a una más chica; sin ese permiso, la ventana entera.
//   · ARRASTRAR: un rectángulo cualquiera.
// La imagen queda en --out, en el portapapeles, y su ruta en --result. Esc cancela.
//
// Por qué AppKit y no un webview: la pieza es una ventana transparente sin bordes por ENCIMA de todo,
// en cada monitor, que se trague el mouse. Eso es nativo en AppKit; en un webview es pelearle al marco.
// La captura en sí la hace /usr/sbin/screencapture -R (el mismo motor de Cmd+Shift+4), así que no
// usamos APIs de captura que Apple va deprecando de versión en versión.
//
// Coordenadas: hay DOS sistemas. Cocoa (NSWindow, NSEvent) tiene el origen abajo a la izquierda de la
// pantalla principal; CGWindowList, Accesibilidad y screencapture -R, arriba a la izquierda. Todo lo que
// se ilumina se guarda en el segundo («top-left global») y se pasa a Cocoa sólo para dibujar.
//
// Permisos: macOS los da a la app RESPONSABLE del proceso. Corrido desde una terminal, esa es la
// terminal (Antigravity, iTerm, Claude…), y cada una lo pide aparte. Por eso `make captura` arma
// Captura.app y la abre con `open`: así la responsable es ella. Como `open` no devuelve stdout ni el
// código de salida, el resultado va a --result.
//
//   captura --out <carpeta> [--result <archivo>] [--no-clip]
//   --result recibe UNA línea: «ok <ruta>», «cancel» o «error <mensaje>».

import AppKit
import ApplicationServices

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}
let outDir = arg("--out") ?? (NSHomeDirectory() + "/Pictures/captura")
let resultFile = arg("--result")
let noClipboard = CommandLine.arguments.contains("--no-clip")
let ownPID = ProcessInfo.processInfo.processIdentifier

// --debug <carpeta>: un log de lo que ve (permisos, ventanas, qué hay bajo el mouse) y una foto de la
// pantalla ENTERA por segundo durante 7 s, velo y cursor incluidos; a los 8 s se cierra sola. Las fotos
// las saca Captura porque es la que tiene el permiso de pantalla; la terminal que la lanza, no siempre.
let debugDir = arg("--debug")
let debugStart = Date()
func dlog(_ s: @autoclosure () -> String) {
    guard let d = debugDir else { return }
    let line = String(format: "%6.3f ", Date().timeIntervalSince(debugStart)) + s() + "\n"
    let path = (d as NSString).appendingPathComponent("debug.log")
    if let h = FileHandle(forWritingAtPath: path) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); h.closeFile() }
    else { try? line.write(toFile: path, atomically: true, encoding: .utf8) }
}

func report(_ line: String) {
    dlog("report: \(line)")
    if let f = resultFile { try? (line + "\n").write(toFile: f, atomically: true, encoding: .utf8) }
    if line.hasPrefix("ok ") { print(String(line.dropFirst(3))) }
    else if line != "cancel" { FileHandle.standardError.write("captura: \(line)\n".data(using: .utf8)!) }
}

// ── qué hay debajo del mouse ──────────────────────────────────────────────────────────────────────

/// Un candidato a capturar, en coordenadas top-left globales.
struct Target: Equatable {
    var rect: CGRect
    var label: String
}

/// Las ventanas de nivel protector de pantalla o más arriba son velos (el nuestro, el de otra copia de
/// Captura, el de otra herramienta de capturas): taparían toda la pantalla como si fueran «la ventana».
let overlayLevel = Int(CGWindowLevelForKey(.screenSaverWindow))

/// Las pantallas en top-left global, el sistema de CGWindowList.
let screenRectsTL: [CGRect] = {
    let h = NSScreen.screens[0].frame.height
    return NSScreen.screens.map { CGRect(x: $0.frame.minX, y: h - $0.frame.maxY, width: $0.frame.width, height: $0.frame.height) }
}()

/// La ventana de otra app que está más adelante bajo el punto (top-left global).
func windowUnder(_ p: CGPoint) -> (rect: CGRect, pid: pid_t, label: String)? {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return nil }
    for w in list { // vienen de adelante hacia atrás
        guard let pid = w[kCGWindowOwnerPID as String] as? pid_t, pid != ownPID,
              let layer = w[kCGWindowLayer as String] as? Int, layer < overlayLevel,
              let alpha = w[kCGWindowAlpha as String] as? Double, alpha > 0,
              let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              let x = b["X"], let y = b["Y"], let wd = b["Width"], let ht = b["Height"],
              wd >= 8, ht >= 8 else { continue }
        let r = CGRect(x: x, y: y, width: wd, height: ht)
        guard r.contains(p) else { continue }
        // Una ventana de sistema (capa ≠ 0) que tapa una pantalla entera es un lienzo invisible, no algo
        // que capturar: el Dock tiene una en la capa 20, delante de todas las apps (medido con DEBUG=1 el
        // 2026-11-10: 109 de 109 sondeos dieron «Dock 1512×982» y el hover no se veía).
        if layer != 0, screenRectsTL.contains(where: { r.contains($0) }) { continue }
        let owner = w[kCGWindowOwnerName as String] as? String ?? "ventana"
        let name = w[kCGWindowName as String] as? String ?? ""
        return (r, pid, name.isEmpty ? owner : "\(owner) · \(name)")
    }
    return nil
}

func axAttr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func axFrame(_ el: AXUIElement) -> CGRect? {
    guard let pv = axAttr(el, kAXPositionAttribute), let sv = axAttr(el, kAXSizeAttribute),
          CFGetTypeID(pv) == AXValueGetTypeID(), CFGetTypeID(sv) == AXValueGetTypeID() else { return nil }
    var p = CGPoint.zero, s = CGSize.zero
    AXValueGetValue(pv as! AXValue, .cgPoint, &p)
    AXValueGetValue(sv as! AXValue, .cgSize, &s)
    return s.width >= 4 && s.height >= 4 ? CGRect(origin: p, size: s) : nil
}

func axLabel(_ el: AXUIElement) -> String {
    let role = (axAttr(el, kAXRoleDescriptionAttribute) as? String) ?? (axAttr(el, kAXRoleAttribute) as? String) ?? "elemento"
    let title = (axAttr(el, kAXTitleAttribute) as? String) ?? (axAttr(el, kAXDescriptionAttribute) as? String) ?? ""
    let t = title.count > 40 ? String(title.prefix(40)) + "…" : title
    return t.isEmpty ? role : "\(role) · \(t)"
}

/// Las apps de Chromium no arman su árbol de Accesibilidad hasta que se lo piden: sin esto, Claude,
/// Slack o VS Code (Electron) devuelven UN nivel, la ventana entera (medido con DEBUG=1 el 2026-11-10
/// sobre Claude: «área de desplazamiento 1512×884», 1 nivel). Electron lo enciende con
/// AXManualAccessibility; Chrome, con AXEnhancedUserInterface, que se pide sólo a navegadores Chromium
/// porque en otras apps cambia cómo animan sus ventanas. Se pide una vez por app y la primera respuesta
/// puede llegar vacía: el árbol aparece en los sondeos siguientes.
var awakened = Set<pid_t>()
let chromiumBrowsers: Set<String> = ["com.google.Chrome", "com.google.Chrome.canary", "com.brave.Browser",
                                     "com.microsoft.edgemac", "company.thebrowser.Browser", "org.chromium.Chromium"]
func wakeAccessibility(_ app: AXUIElement, pid: pid_t) {
    guard !awakened.contains(pid) else { return }
    awakened.insert(pid)
    let manual = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    var enhanced: AXError? = nil
    if let id = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier, chromiumBrowsers.contains(id) {
        enhanced = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    }
    dlog("despertar AX pid=\(pid): AXManualAccessibility=\(manual.rawValue)" + (enhanced.map { " AXEnhancedUserInterface=\($0.rawValue)" } ?? ""))
}

/// La cadena de secciones bajo el punto, de la más chica a la ventana, sin repetir recuadros.
/// Se le pregunta a la APP dueña de la ventana y no al sistema: el sistema contestaría con nuestro velo,
/// que está encima de todo; un elemento de aplicación limita la búsqueda a esa app.
func chainUnder(_ p: CGPoint) -> [Target] {
    guard let win = windowUnder(p) else { return [] }
    let windowTarget = Target(rect: win.rect, label: win.label)
    guard AXIsProcessTrusted() else { return [windowTarget] }
    let app = AXUIElementCreateApplication(win.pid)
    AXUIElementSetMessagingTimeout(app, 0.15) // una app colgada no congela el velo
    wakeAccessibility(app, pid: win.pid)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(app, Float(p.x), Float(p.y), &hit) == .success, var el = hit else {
        return [windowTarget]
    }
    var chain: [Target] = []
    for _ in 0..<40 {
        // recortada a la ventana (una lista con scroll declara su alto entero) y sin repetir recuadros:
        // un grupo que ocupa lo mismo que su hijo no es un nivel más para la rueda
        // y sólo hacia afuera: hay padres que miden MENOS que su hijo (en Claude, «930×876 ⊂ 824×755»)
        // y la rueda tiene que agrandar siempre
        if let r = axFrame(el)?.intersection(win.rect), !r.isNull, r.width >= 4, r.height >= 4,
           chain.last?.rect != r, chain.last.map({ r.insetBy(dx: -1, dy: -1).contains($0.rect) }) ?? true {
            chain.append(Target(rect: r, label: axLabel(el)))
        }
        if (axAttr(el, kAXRoleAttribute) as? String) == kAXWindowRole { break }
        guard let parent = axAttr(el, kAXParentAttribute) else { break }
        el = parent as! AXUIElement
    }
    if chain.last?.rect != win.rect { chain.append(windowTarget) }
    return chain
}

// ── el velo ───────────────────────────────────────────────────────────────────────────────────────

final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

let mainHeight = NSScreen.screens[0].frame.height

/// top-left global → coordenadas locales de la vista (Cocoa)
func toLocal(_ r: CGRect, in w: NSWindow) -> NSRect {
    NSRect(x: r.minX - w.frame.minX, y: (mainHeight - r.maxY) - w.frame.minY, width: r.width, height: r.height)
}
/// punto local de la vista (Cocoa) → top-left global
func toGlobal(_ p: NSPoint, in w: NSWindow) -> CGPoint {
    CGPoint(x: w.frame.minX + p.x, y: mainHeight - (w.frame.minY + p.y))
}

final class Picker {
    var views: [SelectionView] = []
    var chain: [Target] = []
    var level = 0
    var dragging: (start: CGPoint, current: CGPoint)?
    var lastProbe = CGPoint(x: -1, y: -1)
    var lastProbeAt = Date.distantPast
    var onCapture: ((CGRect) -> Void)?

    var hovered: Target? { chain.isEmpty ? nil : chain[min(level, chain.count - 1)] }

    /// lo que se está mostrando: el arrastre si hay uno, si no lo señalado
    var shown: Target? {
        if let d = dragging {
            let r = CGRect(x: min(d.start.x, d.current.x), y: min(d.start.y, d.current.y),
                           width: abs(d.start.x - d.current.x), height: abs(d.start.y - d.current.y))
            return Target(rect: r, label: "\(Int(r.width)) × \(Int(r.height))")
        }
        return hovered.map { Target(rect: $0.rect, label: "\($0.label)  \(Int($0.rect.width)) × \(Int($0.rect.height))") }
    }

    func redraw() { views.forEach { $0.needsDisplay = true } }

    func probe(_ p: CGPoint) {
        // también con el mouse quieto cada 0,3 s: Electron arma su árbol DESPUÉS del primer pedido, y el
        // primer sondeo de una app recién despertada devuelve un solo nivel
        let moved = hypot(p.x - lastProbe.x, p.y - lastProbe.y) >= 1
        guard dragging == nil, moved || Date().timeIntervalSince(lastProbeAt) >= 0.3 else { return }
        lastProbe = p
        lastProbeAt = Date()
        let t0 = Date()
        let next = chainUnder(p)
        dlog(String(format: "probe (%.0f,%.0f) %.0fms → %d niveles", p.x, p.y, Date().timeIntervalSince(t0) * 1000, next.count)
             + (next.first.map { String(format: " · [%.0f,%.0f %.0f×%.0f] %@", $0.rect.minX, $0.rect.minY, $0.rect.width, $0.rect.height, $0.label) } ?? " · nada"))
        // si la sección más chica sigue siendo la misma, se respeta el nivel que eligió la rueda
        if next.first != chain.first { level = 0 }
        chain = next
        level = min(level, max(chain.count - 1, 0))
        redraw()
    }

    func scroll(_ dy: CGFloat) {
        guard !chain.isEmpty, dy != 0 else { return }
        level = max(0, min(chain.count - 1, level + (dy > 0 ? 1 : -1)))
        redraw()
    }

    func down(_ p: CGPoint) { dragging = (p, p); redraw() }
    func drag(_ p: CGPoint) { dragging?.current = p; redraw() }
    func up(_ p: CGPoint) {
        guard let d = dragging else { return }
        dragging = nil
        let moved = hypot(p.x - d.start.x, p.y - d.start.y)
        if moved >= 4 {
            let r = CGRect(x: min(d.start.x, p.x), y: min(d.start.y, p.y), width: abs(d.start.x - p.x), height: abs(d.start.y - p.y))
            if r.width >= 3, r.height >= 3 { onCapture?(r); return }
        } else if let h = hovered {
            onCapture?(h.rect); return
        }
        redraw()
    }
}

final class SelectionView: NSView {
    unowned let picker: Picker
    var onCancel: (() -> Void)?

    init(frame: NSRect, picker: Picker) { self.picker = picker; super.init(frame: frame) }
    required init?(coder: NSCoder) { fatalError() }

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

    func global(_ e: NSEvent) -> CGPoint { toGlobal(convert(e.locationInWindow, from: nil), in: window!) }

    override func mouseDown(with e: NSEvent) { picker.down(global(e)) }
    override func mouseDragged(with e: NSEvent) { picker.drag(global(e)) }
    override func mouseUp(with e: NSEvent) { picker.up(global(e)) }
    override func scrollWheel(with e: NSEvent) {
        // rueda hacia arriba = sección más grande; se acumula para que un trackpad no salte diez niveles
        acc += e.scrollingDeltaY
        let step: CGFloat = e.hasPreciseScrollingDeltas ? 18 : 1
        while abs(acc) >= step { picker.scroll(acc > 0 ? 1 : -1); acc -= acc > 0 ? step : -step }
    }
    var acc: CGFloat = 0
    override func keyDown(with e: NSEvent) { if e.keyCode == 53 { onCancel?() } } // Esc

    override func draw(_ dirty: NSRect) {
        let shown = picker.shown
        let local = shown.map { toLocal($0.rect, in: window!) }
        let path = NSBezierPath(rect: bounds)
        if let r = local { path.append(NSBezierPath(rect: r)); path.windingRule = .evenOdd }
        NSColor.black.withAlphaComponent(0.35).setFill()
        path.fill()
        guard let r = local, let t = shown, r.intersects(bounds) else { return }
        (picker.dragging == nil ? NSColor.systemBlue : NSColor.white).setStroke()
        let border = NSBezierPath(rect: r.insetBy(dx: -1, dy: -1)); border.lineWidth = 2; border.stroke()

        var label = t.label
        if picker.dragging == nil, picker.chain.count > 1 { label += "   ↕ \(picker.level + 1)/\(picker.chain.count)" }
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .medium), .foregroundColor: NSColor.white]
        let text = label as NSString
        let size = text.size(withAttributes: attrs)
        var p = NSPoint(x: max(r.minX, 4), y: r.maxY + 6)
        if p.y + size.height + 4 > bounds.maxY { p = NSPoint(x: max(r.minX, 4) + 6, y: r.maxY - size.height - 8) }
        p.x = min(p.x, bounds.maxX - size.width - 8)
        let bg = NSRect(x: p.x - 4, y: p.y - 2, width: size.width + 8, height: size.height + 4)
        NSColor.black.withAlphaComponent(0.75).setFill(); NSBezierPath(roundedRect: bg, xRadius: 4, yRadius: 4).fill()
        text.draw(at: p, withAttributes: attrs)
    }
}

// ── la app ────────────────────────────────────────────────────────────────────────────────────────

final class AppDelegate: NSObject, NSApplicationDelegate {
    var windows: [OverlayWindow] = []
    let picker = Picker()

    func applicationDidFinishLaunching(_ n: Notification) {
        // Una sola copia: Ctrl-C sobre `make captura` corta el `open`, no la app, y el 2026-11-10 se
        // juntaron 12 velos apilados. La nueva cierra a las anteriores.
        if let id = Bundle.main.bundleIdentifier {
            for other in NSRunningApplication.runningApplications(withBundleIdentifier: id) where other.processIdentifier != ownPID {
                other.forceTerminate()
            }
        }
        // pide Accesibilidad una vez (abre el aviso del sistema); sin ella se señalan ventanas enteras
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
        // sobre el elemento de sistema fija el tope de TODAS las consultas (el de fábrica es 6 s)
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15)

        picker.onCapture = { [weak self] r in self?.capture(r) }
        for screen in NSScreen.screens {
            let w = OverlayWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = .screenSaver
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.acceptsMouseMovedEvents = true
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            let v = SelectionView(frame: NSRect(origin: .zero, size: screen.frame.size), picker: picker)
            v.onCancel = { [weak self] in report("cancel"); self?.finish(code: 1) }
            w.contentView = v
            w.setFrame(screen.frame, display: true)
            w.makeKeyAndOrderFront(nil)
            windows.append(w)
            picker.views.append(v)
        }
        NSApp.activate(ignoringOtherApps: true)
        // la ventana bajo el mouse arranca con el foco, para que Esc funcione sin un clic previo
        let mouse = NSEvent.mouseLocation
        let first = windows.first { $0.frame.contains(mouse) } ?? windows.first
        first?.makeKeyAndOrderFront(nil)
        first?.makeFirstResponder(first?.contentView)
        NSCursor.crosshair.set()
        // El hover se SONDEA y no se espera de mouseMoved: macOS sólo manda ese evento a la ventana
        // activa, y abierta con `open` una app sin Dock no siempre queda activa (medido 2026-11-10: el
        // velo salía, el recuadro inicial también, y al mover el mouse no cambiaba nada). probe() ya
        // descarta los ticks en que el mouse no se movió.
        let tick = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            let m = NSEvent.mouseLocation // Cocoa global: origen abajo a la izquierda
            self?.picker.probe(CGPoint(x: m.x, y: mainHeight - m.y))
        }
        RunLoop.main.add(tick, forMode: .common)
        if debugDir != nil { startDebug() }
    }

    func startDebug() {
        guard let d = debugDir else { return }
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
        dlog("pid \(ownPID) · bundle \(Bundle.main.bundleIdentifier ?? "-") · AXIsProcessTrusted=\(AXIsProcessTrusted()) · CGPreflightScreenCaptureAccess=\(CGPreflightScreenCaptureAccess())")
        for (i, s) in NSScreen.screens.enumerated() { dlog("pantalla \(i): frame=\(s.frame) escala=\(s.backingScaleFactor)") }
        for w in windows { dlog("velo: frame=\(w.frame) key=\(w.isKeyWindow) visible=\(w.isVisible) nivel=\(w.level.rawValue)") }
        dlog("app activa=\(NSApp.isActive) · nivel de velo para filtrar=\(overlayLevel)")
        if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            dlog("CGWindowList: \(list.count) ventanas (las 25 de adelante):")
            for w in list.prefix(25) {
                dlog("  pid=\(w[kCGWindowOwnerPID as String] ?? "-") \(w[kCGWindowOwnerName as String] ?? "-") capa=\(w[kCGWindowLayer as String] ?? "-") alfa=\(w[kCGWindowAlpha as String] ?? "-") bounds=\(w[kCGWindowBounds as String] ?? "-") nombre=\(w[kCGWindowName as String] ?? "")")
            }
        }
        // un barrido de la pantalla sin mover el mouse: qué se señalaría en una grilla de 6×4 puntos
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            for s in screenRectsTL {
                for row in 0..<4 { for col in 0..<6 {
                    let p = CGPoint(x: s.minX + s.width * (CGFloat(col) + 0.5) / 6, y: s.minY + s.height * (CGFloat(row) + 0.5) / 4)
                    let c = chainUnder(p)
                    dlog(String(format: "grilla (%.0f,%.0f): %d niveles · ", p.x, p.y, c.count)
                         + c.map { String(format: "%@ %.0f×%.0f", $0.label, $0.rect.width, $0.rect.height) }.joined(separator: " ⊂ "))
                }}
            }
        }
        for i in 1...7 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i)) {
                let m = NSEvent.mouseLocation
                dlog("foto \(i): mouse cocoa=(\(Int(m.x)),\(Int(m.y))) · señalado=\(self.picker.hovered.map { "\($0.rect) \($0.label)" } ?? "nada") · niveles=\(self.picker.chain.count) · activa=\(NSApp.isActive)")
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                p.arguments = ["-x", "-C", "-t", "jpg", (d as NSString).appendingPathComponent("foto_\(i).jpg")]
                try? p.run() // sin esperar: el velo tiene que seguir respondiendo mientras tanto
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.5) { report("cancel"); self.finish(code: 1) }
    }

    /// r en top-left global, que es lo que espera screencapture -R
    func capture(_ r: CGRect) {
        let x = Int(r.minX.rounded()), y = Int(r.minY.rounded())
        let wd = Int(r.width.rounded()), ht = Int(r.height.rounded())

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
