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
let noSound = CommandLine.arguments.contains("--no-sound")
/// --watch <pid>: el proceso que la lanzó (la shell de `make`). Abierta con `open`, Captura no es hija de
/// la terminal y Ctrl-C no le llega: corta el `open` y el velo quedaba prendido. Si ese pid muere, se cierra.
let watchPID = arg("--watch").flatMap { pid_t($0) }

// el mismo obturador que Cmd+Shift+4; si una versión de macOS lo mueve, la captura sigue en silencio
let shutter: NSSound? = noSound ? nil : NSSound(contentsOfFile:
    "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif",
    byReference: true)
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
    /// El área elegida: un clic o un arrastre la FIJAN (no capturan); la captura sale del botón Copiar.
    var selected: CGRect?
    var mouse = CGPoint.zero
    enum ToolbarButton { case copy, close }
    var pressing: ToolbarButton?
    var onCopy: ((CGRect) -> Void)?
    var onCancel: (() -> Void)?

    var hovered: Target? { chain.isEmpty ? nil : chain[min(level, chain.count - 1)] }

    /// lo que se está mostrando: el arrastre, si no lo elegido, si no lo señalado
    var shown: Target? {
        if let d = dragging {
            let r = CGRect(x: min(d.start.x, d.current.x), y: min(d.start.y, d.current.y),
                           width: abs(d.start.x - d.current.x), height: abs(d.start.y - d.current.y))
            return Target(rect: r, label: "\(Int(r.width)) × \(Int(r.height))")
        }
        if let s = selected { return Target(rect: s, label: "\(Int(s.width)) × \(Int(s.height))") }
        return hovered.map { Target(rect: $0.rect, label: "\($0.label)  \(Int($0.rect.width)) × \(Int($0.rect.height))") }
    }

    /// La barra con Copiar y la X, en top-left global: debajo del área, alineada a su derecha; si no
    /// entra en la pantalla, adentro del área, abajo a la derecha.
    var toolbar: CGRect? {
        guard let s = selected, dragging == nil else { return nil }
        let size = CGSize(width: 140, height: 34)
        let screen = screenRectsTL.first { $0.intersects(s) } ?? screenRectsTL[0]
        var r = CGRect(x: s.maxX - size.width, y: s.maxY + 8, width: size.width, height: size.height)
        if r.maxY > screen.maxY - 4 { r.origin.y = s.maxY - size.height - 8 }
        r.origin.x = max(screen.minX + 8, min(r.origin.x, screen.maxX - size.width - 8))
        r.origin.y = max(screen.minY + 8, r.origin.y)
        return r
    }
    var copyButton: CGRect? { toolbar.map { CGRect(x: $0.minX + 4, y: $0.minY + 4, width: 100, height: $0.height - 8) } }
    var closeButton: CGRect? { toolbar.map { CGRect(x: $0.maxX - 32, y: $0.minY + 4, width: 28, height: $0.height - 8) } }
    func button(at p: CGPoint) -> ToolbarButton? {
        if copyButton?.contains(p) == true { return .copy }
        if closeButton?.contains(p) == true { return .close }
        return nil
    }
    var hoverButton: ToolbarButton? { button(at: mouse) }

    func redraw() { views.forEach { $0.needsDisplay = true } }

    func probe(_ p: CGPoint) {
        if selected != nil {
            // con un área elegida no se señala nada: el mouse va libre hasta el botón
            let was = hoverButton
            mouse = p
            if was != hoverButton { redraw() }
            (hoverButton != nil ? NSCursor.pointingHand : NSCursor.arrow).set()
            return
        }
        mouse = p
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
        guard selected == nil, !chain.isEmpty, dy != 0 else { return }
        level = max(0, min(chain.count - 1, level + (dy > 0 ? 1 : -1)))
        redraw()
    }

    func down(_ p: CGPoint) {
        mouse = p
        if let b = button(at: p) { pressing = b; redraw(); return }
        if toolbar?.contains(p) == true { return } // el borde de la barra, entre botones: nada
        if let s = selected {
            // con un área elegida: un clic FUERA cancela la captura; adentro, empieza otra selección
            guard s.contains(p) else { dlog("clic fuera del área: cancelo"); onCancel?(); return }
            dlog("selección descartada"); selected = nil; lastProbeAt = .distantPast
        }
        dragging = (p, p)
        redraw()
    }
    func drag(_ p: CGPoint) { mouse = p; if pressing == nil { dragging?.current = p; redraw() } }
    func up(_ p: CGPoint) {
        mouse = p
        if let b = pressing {
            pressing = nil
            // se dispara sólo si se suelta sobre el MISMO botón, como un botón de verdad
            switch (b, button(at: p), selected) {
            case (.copy, .copy, let s?): dlog("copiar \(s)"); onCopy?(s)
            case (.close, .close, _): dlog("cerrar (X)"); onCancel?()
            default: redraw()
            }
            return
        }
        guard let d = dragging else { return }
        dragging = nil
        let moved = hypot(p.x - d.start.x, p.y - d.start.y)
        if moved >= 4 {
            let r = CGRect(x: min(d.start.x, p.x), y: min(d.start.y, p.y), width: abs(d.start.x - p.x), height: abs(d.start.y - p.y))
            if r.width >= 3, r.height >= 3 { selected = r }
        } else if let h = hovered {
            selected = h.rect
        }
        if let s = selected { dlog("seleccionado \(s)") }
        redraw()
    }

    func copySelected() { if let s = selected { dlog("copiar (teclado) \(s)"); onCopy?(s) } }
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
    override func keyDown(with e: NSEvent) {
        switch e.keyCode {
        case 53: onCancel?()                                            // Esc
        case 36, 76: picker.copySelected()                              // Enter
        case 8 where e.modifierFlags.contains(.command): picker.copySelected() // ⌘C
        default: break
        }
    }

    static let closeIcon: NSImage? = {
        let cfg = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        return NSImage(systemSymbolName: "xmark", accessibilityDescription: "Cerrar")?.withSymbolConfiguration(cfg)
    }()
    static let copyIcon: NSImage? = {
        let cfg = NSImage.SymbolConfiguration(pointSize: 13, weight: .medium)
        return NSImage(systemSymbolName: "doc.on.doc", accessibilityDescription: "Copiar")?.withSymbolConfiguration(cfg)
    }()

    override func draw(_ dirty: NSRect) {
        // Una capa casi invisible sobre TODO, también dentro del recuadro: macOS deja pasar los clics por
        // donde una ventana transparente no pinta nada, y sin esto el recuadro era un hueco por el que el
        // clic seleccionaba texto en la app de abajo.
        NSColor.black.withAlphaComponent(0.01).setFill()
        bounds.fill()

        let shown = picker.shown
        let local = shown.map { toLocal($0.rect, in: window!) }
        let path = NSBezierPath(rect: bounds)
        if let r = local { path.append(NSBezierPath(rect: r)); path.windingRule = .evenOdd }
        NSColor.black.withAlphaComponent(0.35).setFill()
        path.fill()
        guard let r = local, let t = shown else { return }
        if r.intersects(bounds) {
            let color: NSColor = picker.dragging != nil ? .white : picker.selected != nil ? .systemBlue : NSColor.systemBlue.withAlphaComponent(0.75)
            color.setStroke()
            let border = NSBezierPath(rect: r.insetBy(dx: -1, dy: -1)); border.lineWidth = picker.selected != nil ? 2.5 : 2; border.stroke()

            var label = t.label
            if picker.dragging == nil, picker.selected == nil, picker.chain.count > 1 { label += "   ↕ \(picker.level + 1)/\(picker.chain.count)" }
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
        if let tb = picker.toolbar { drawToolbar(toLocal(tb, in: window!)) }
    }

    func drawToolbar(_ r: NSRect) {
        guard r.intersects(bounds) else { return }
        NSColor(calibratedWhite: 0.12, alpha: 0.95).setFill()
        NSBezierPath(roundedRect: r, xRadius: 8, yRadius: 8).fill()
        NSColor(calibratedWhite: 1, alpha: 0.15).setStroke()
        let edge = NSBezierPath(roundedRect: r.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8); edge.lineWidth = 1; edge.stroke()
        guard let copyTL = picker.copyButton, let closeTL = picker.closeButton else { return }
        let copy = toLocal(copyTL, in: window!), close = toLocal(closeTL, in: window!)
        for (b, rect) in [(Picker.ToolbarButton.copy, copy), (.close, close)] where picker.hoverButton == b {
            (picker.pressing == b ? NSColor.systemBlue : NSColor(calibratedWhite: 1, alpha: 0.14)).setFill()
            NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5).fill()
        }
        // separador entre Copiar y la X
        NSColor(calibratedWhite: 1, alpha: 0.18).setFill()
        NSRect(x: close.minX - 4, y: r.minY + 8, width: 1, height: r.height - 16).fill()

        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.white]
        let text = "Copiar" as NSString
        let ts = text.size(withAttributes: attrs)
        let iconSize = NSSize(width: 16, height: 16)
        var x = copy.midX - (iconSize.width + 6 + ts.width) / 2
        SelectionView.white(SelectionView.copyIcon)?.draw(in: NSRect(x: x, y: copy.midY - iconSize.height / 2, width: iconSize.width, height: iconSize.height))
        x += iconSize.width + 6
        text.draw(at: NSPoint(x: x, y: copy.midY - ts.height / 2), withAttributes: attrs)
        let xs = NSSize(width: 12, height: 12)
        SelectionView.white(SelectionView.closeIcon)?.draw(in: NSRect(x: close.midX - xs.width / 2, y: close.midY - xs.height / 2, width: xs.width, height: xs.height))
    }

    /// Los SF Symbols vienen negros: se pintan de blanco para la barra oscura.
    static func white(_ icon: NSImage?) -> NSImage? {
        guard let icon else { return nil }
        return NSImage(size: icon.size, flipped: false) { rect in
            icon.draw(in: rect); NSColor.white.set(); rect.fill(using: .sourceAtop); return true
        }
    }
}

// ── el panel flotante ─────────────────────────────────────────────────────────────────────────────

/// --panel: en vez de abrir el selector y salir, deja una ventanita flotante (siempre encima, se mueve
/// arrastrándola, recuerda dónde quedó) con Capturar, Carpeta y ✕. Capturar esconde el panel, abre el
/// selector de siempre y al terminar el panel vuelve.
let panelMode = CommandLine.arguments.contains("--panel")
/// El pid del panel que está corriendo: un `make captura` suelto no lo tiene que cerrar.
let panelPIDFile = (NSTemporaryDirectory() as NSString).appendingPathComponent("captura-panel.pid")

/// Un panel sin bordes no puede ser ventana clave; los botones igual andan con acceptsFirstMouse.
final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { false }
}

/// La agarradera de la izquierda: arrastrarla mueve el panel (los botones se quedan con su clic).
final class GripView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override var intrinsicContentSize: NSSize { NSSize(width: 14, height: 28) }
    override func draw(_ dirty: NSRect) {
        NSColor(calibratedWhite: 1, alpha: 0.45).setFill()
        for row in 0..<3 { for col in 0..<2 {
            let c = NSPoint(x: bounds.midX - 3 + CGFloat(col) * 6, y: bounds.midY - 6 + CGFloat(row) * 6)
            NSBezierPath(ovalIn: NSRect(x: c.x - 1.25, y: c.y - 1.25, width: 2.5, height: 2.5)).fill()
        }}
    }
}

final class PanelButton: NSButton {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
}

func makePanelButton(symbol: String, tip: String, target: AnyObject, action: Selector) -> NSButton {
    let b = PanelButton()
    let cfg = NSImage.SymbolConfiguration(pointSize: 15, weight: .medium)
    b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: tip)?.withSymbolConfiguration(cfg)
    b.isBordered = false
    b.bezelStyle = .regularSquare
    b.contentTintColor = .white
    b.toolTip = tip
    b.target = target
    b.action = action
    b.translatesAutoresizingMaskIntoConstraints = false
    b.widthAnchor.constraint(equalToConstant: 32).isActive = true
    b.heightAnchor.constraint(equalToConstant: 30).isActive = true
    return b
}

// ── la app ────────────────────────────────────────────────────────────────────────────────────────

final class AppDelegate: NSObject, NSApplicationDelegate {
    var windows: [OverlayWindow] = []
    let picker = Picker()
    var tick: Timer?
    var panel: FloatingPanel?
    var selecting = false

    func applicationDidFinishLaunching(_ n: Notification) {
        // Una sola copia: Ctrl-C sobre `make captura` corta el `open`, no la app, y el 2026-11-10 se
        // juntaron 12 velos apilados. La nueva cierra a las anteriores, salvo al panel que esté corriendo
        // (un panel nuevo sí cierra al viejo).
        let runningPanel = (try? String(contentsOfFile: panelPIDFile, encoding: .utf8)).flatMap { pid_t($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        if let id = Bundle.main.bundleIdentifier {
            for other in NSRunningApplication.runningApplications(withBundleIdentifier: id) where other.processIdentifier != ownPID {
                if !panelMode, other.processIdentifier == runningPanel { continue }
                other.forceTerminate()
            }
        }
        // pide Accesibilidad una vez (abre el aviso del sistema); sin ella se señalan ventanas enteras
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
        // sobre el elemento de sistema fija el tope de TODAS las consultas (el de fábrica es 6 s)
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.15)

        picker.onCopy = { [weak self] r in self?.capture(r) }
        picker.onCancel = { [weak self] in self?.endSelection(code: 1, result: "cancel") }
        if let parent = watchPID {
            Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
                // kill(pid, 0) no manda nada: sólo pregunta si existe
                if kill(parent, 0) != 0 && errno == ESRCH { dlog("murió el pid \(parent): me cierro"); report("cancel"); self?.finish(code: 1) }
            }
        }
        if panelMode {
            try? "\(ownPID)\n".write(toFile: panelPIDFile, atomically: true, encoding: .utf8)
            showPanel()
            if debugDir != nil { startPanelDebug() }
        } else {
            startSelection()
        }
    }

    // ── el panel ──

    func showPanel() {
        if panel == nil {
            let p = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 140, height: 44),
                                  styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.level = .floating
            p.isOpaque = false
            p.backgroundColor = .clear
            p.hasShadow = true
            p.isMovableByWindowBackground = true
            p.hidesOnDeactivate = false
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

            let bg = NSVisualEffectView()
            bg.material = .hudWindow
            bg.blendingMode = .behindWindow
            bg.state = .active
            bg.appearance = NSAppearance(named: .vibrantDark)
            bg.wantsLayer = true
            bg.layer?.cornerRadius = 12
            bg.layer?.masksToBounds = true

            let stack = NSStackView(views: [
                GripView(),
                makePanelButton(symbol: "camera.viewfinder", tip: "Capturar (señalar o arrastrar)", target: self, action: #selector(onCaptureButton)),
                makePanelButton(symbol: "folder", tip: "Abrir la carpeta de capturas", target: self, action: #selector(onFolderButton)),
                makePanelButton(symbol: "xmark", tip: "Cerrar el panel", target: self, action: #selector(onQuitButton)),
            ])
            stack.orientation = .horizontal
            stack.spacing = 2
            stack.edgeInsets = NSEdgeInsets(top: 7, left: 6, bottom: 7, right: 6)
            stack.translatesAutoresizingMaskIntoConstraints = false
            bg.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: bg.leadingAnchor), stack.trailingAnchor.constraint(equalTo: bg.trailingAnchor),
                stack.topAnchor.constraint(equalTo: bg.topAnchor), stack.bottomAnchor.constraint(equalTo: bg.bottomAnchor),
            ])
            p.contentView = bg
            p.setContentSize(stack.fittingSize)
            // dónde quedó la última vez; la primera, arriba a la derecha de la pantalla principal
            if !p.setFrameUsingName("CapturaPanel"), let s = NSScreen.main?.visibleFrame {
                p.setFrameOrigin(NSPoint(x: s.maxX - p.frame.width - 24, y: s.maxY - p.frame.height - 24))
            }
            p.setFrameAutosaveName("CapturaPanel")
            panel = p
        }
        panel?.orderFrontRegardless()
    }

    @objc func onCaptureButton() {
        guard !selecting else { return }
        dlog("panel: capturar")
        panel?.orderOut(nil) // que el panel no salga en la foto ni tape lo que se quiere señalar
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { self.startSelection() }
    }
    @objc func onFolderButton() {
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        NSWorkspace.shared.open(URL(fileURLWithPath: outDir))
    }
    @objc func onQuitButton() {
        if (try? String(contentsOfFile: panelPIDFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) == "\(ownPID)" {
            try? FileManager.default.removeItem(atPath: panelPIDFile)
        }
        exit(0)
    }

    // ── el selector ──

    func startSelection() {
        selecting = true
        picker.chain = []; picker.level = 0; picker.selected = nil; picker.dragging = nil; picker.pressing = nil
        picker.lastProbe = CGPoint(x: -1, y: -1); picker.lastProbeAt = .distantPast
        picker.views = []
        for screen in NSScreen.screens {
            let w = OverlayWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = .screenSaver
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.acceptsMouseMovedEvents = true
            w.isReleasedWhenClosed = false
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            let v = SelectionView(frame: NSRect(origin: .zero, size: screen.frame.size), picker: picker)
            v.onCancel = { [weak self] in self?.endSelection(code: 1, result: "cancel") }
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
        let t = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            let m = NSEvent.mouseLocation // Cocoa global: origen abajo a la izquierda
            self?.picker.probe(CGPoint(x: m.x, y: mainHeight - m.y))
        }
        RunLoop.main.add(t, forMode: .common)
        tick = t
        if debugDir != nil, !panelMode { startDebug() }
    }

    /// Fin de una selección: sin panel, la app sale; con panel, se desarma el velo y el panel vuelve.
    func endSelection(code: Int32, result: String) {
        guard panelMode else { report(result); finish(code: code); return }
        dlog("panel: fin de la selección (\(result))")
        tick?.invalidate(); tick = nil
        windows.forEach { $0.orderOut(nil); $0.close() }
        windows = []
        picker.views = []
        selecting = false
        NSCursor.arrow.set()
        showPanel()
    }

    func startPanelDebug() {
        guard let d = debugDir else { return }
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
        dlog("panel: pid \(ownPID) · frame=\(panel?.frame ?? .zero) · AX=\(AXIsProcessTrusted()) · pantalla=\(CGPreflightScreenCaptureAccess())")
        for i in 1...3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i)) {
                dlog("foto \(i): panel visible=\(self.panel?.isVisible ?? false) frame=\(self.panel?.frame ?? .zero)")
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                p.arguments = ["-x", "-C", "-t", "jpg", (d as NSString).appendingPathComponent("foto_\(i).jpg")]
                try? p.run()
            }
        }
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
        // a los 2,5 s elige sola lo señalado, para que las fotos muestren también la barra con Copiar
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            if self.picker.selected == nil, let h = self.picker.hovered {
                self.picker.selected = h.rect; self.picker.redraw(); dlog("debug: elijo lo señalado \(h.rect) · barra \(self.picker.toolbar.map { "\($0)" } ?? "-")")
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
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.5) { self.endSelection(code: 1, result: "cancel") }
    }

    /// r en top-left global, que es lo que espera screencapture -R
    func capture(_ r: CGRect) {
        let x = Int(r.minX.rounded()), y = Int(r.minY.rounded())
        let wd = Int(r.width.rounded()), ht = Int(r.height.rounded())

        windows.forEach { $0.orderOut(nil) }
        shutter?.play()
        // un respiro para que el compositor saque el velo antes de fotografiar
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'_'HH-mm-ss"
            let file = (outDir as NSString).appendingPathComponent("captura_\(f.string(from: Date())).png")
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-t", "png", "-R", "\(x),\(y),\(wd),\(ht)", file]
            do { try p.run(); p.waitUntilExit() } catch {
                self.endSelection(code: 2, result: "error no corrió screencapture: \(error)"); return
            }
            guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: file) else {
                self.endSelection(code: 2, result: "error screencapture salió con \(p.terminationStatus): falta el permiso de Grabación de pantalla para Captura (Ajustes → Privacidad y seguridad)"); return
            }
            if !noClipboard, let img = NSImage(contentsOfFile: file) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.writeObjects([img])
            }
            self.endSelection(code: 0, result: "ok \(file)")
        }
    }

    /// Sale cuando el obturador terminó de sonar (exit lo cortaría a la mitad), con un tope de 1,5 s.
    func finish(code: Int32) {
        guard let s = shutter, s.isPlaying else { exit(code) }
        let deadline = Date().addingTimeInterval(1.5)
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            if !s.isPlaying || Date() > deadline { exit(code) }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // sin ícono en el Dock
let delegate = AppDelegate()
app.delegate = delegate
app.run()
