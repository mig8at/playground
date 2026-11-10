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
    /// el elemento de Accesibilidad (nil para la ventana entera o un arrastre): de él sale el texto
    var element: AXUIElement? = nil
    var pid: pid_t = 0
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
    let windowTarget = Target(rect: win.rect, label: win.label, pid: win.pid)
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
            chain.append(Target(rect: r, label: axLabel(el), element: el, pid: win.pid))
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

// ── marcas ────────────────────────────────────────────────────────────────────────────────────────
//
// Con un área elegida, arrastrar ADENTRO dibuja un recuadro punteado con una flecha en una esquina. Al
// copiar se pintan en la imagen, a la resolución real (las marcas viven en top-left global y se pasan a
// cada lienzo con su `map`).

/// Un recuadro punteado y su flecha, en top-left global.
struct Mark { var box: CGRect; var tail: CGPoint; var tip: CGPoint }

/// La flecha va a la esquina del recuadro que mira al centro del área (ahí suele haber lugar) y sale
/// hacia ese centro; si el recuadro tapa el centro, entra en diagonal desde afuera de esa esquina.
func makeMark(_ box: CGRect, in area: CGRect) -> Mark {
    let center = CGPoint(x: area.midX, y: area.midY)
    let corners = [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY),
                   CGPoint(x: box.minX, y: box.maxY), CGPoint(x: box.maxX, y: box.maxY)]
    let corner = corners.min { hypot($0.x - center.x, $0.y - center.y) < hypot($1.x - center.x, $1.y - center.y) }!
    var dx = center.x - corner.x, dy = center.y - corner.y
    if box.insetBy(dx: -1, dy: -1).contains(center) || hypot(dx, dy) < 1 {
        dx = corner.x == box.minX ? -1 : 1; dy = corner.y == box.minY ? -1 : 1
    }
    let n = max(hypot(dx, dy), 0.001)
    dx /= n; dy /= n
    let tip = CGPoint(x: corner.x + dx * 5, y: corner.y + dy * 5)
    let inner = area.insetBy(dx: 8, dy: 8)
    let tail = CGPoint(x: min(max(corner.x + dx * 70, inner.minX), inner.maxX), y: min(max(corner.y + dy * 70, inner.minY), inner.maxY))
    return Mark(box: box, tail: tail, tip: tip)
}

/// Dibuja una marca en el contexto actual. `map` lleva de top-left global al lienzo; `scale` agranda los
/// trazos (1 en pantalla, la densidad de la pantalla en la imagen). Un halo blanco debajo la hace visible
/// también sobre fondos rojos u oscuros.
func drawMark(_ m: Mark, map: (CGPoint) -> CGPoint, scale: CGFloat, arrow: Bool = true) {
    let a = map(CGPoint(x: m.box.minX, y: m.box.minY)), b = map(CGPoint(x: m.box.maxX, y: m.box.maxY))
    let rect = NSRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y))
    for (color, extra) in [(NSColor.white.withAlphaComponent(0.9), CGFloat(2.5)), (NSColor.systemRed, 0)] {
        color.setStroke(); color.setFill()
        let box = NSBezierPath(rect: rect)
        box.lineWidth = (3 + extra) * scale
        var dash: [CGFloat] = [9 * scale, 6 * scale]
        box.setLineDash(&dash, count: 2, phase: 0)
        box.stroke()
        guard arrow else { continue }
        let t = map(m.tail), h = map(m.tip)
        let ang = atan2(h.y - t.y, h.x - t.x)
        let head = 15 * scale
        let base = CGPoint(x: h.x - cos(ang) * head, y: h.y - sin(ang) * head)
        let shaft = NSBezierPath()
        shaft.move(to: t); shaft.line(to: base)
        shaft.lineWidth = (3.5 + extra) * scale
        shaft.lineCapStyle = .round
        shaft.stroke()
        let w = head * 0.6
        let tri = NSBezierPath()
        tri.move(to: h)
        tri.line(to: CGPoint(x: base.x + cos(ang + .pi / 2) * w, y: base.y + sin(ang + .pi / 2) * w))
        tri.line(to: CGPoint(x: base.x + cos(ang - .pi / 2) * w, y: base.y + sin(ang - .pi / 2) * w))
        tri.close()
        tri.fill()
        if extra > 0 { tri.lineWidth = extra * scale; tri.lineJoinStyle = .round; tri.stroke() }
    }
}

/// Pinta las marcas sobre el PNG de la captura (r: lo capturado, en top-left global).
func paintMarks(_ marks: [Mark], onto file: String, area r: CGRect) {
    guard !marks.isEmpty, let img = NSImage(contentsOfFile: file),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: cg.width, pixelsHigh: cg.height, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                     bytesPerRow: 0, bitsPerPixel: 0),
          let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return }
    let s = CGFloat(cg.width) / r.width
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    ctx.cgContext.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
    for m in marks { drawMark(m, map: { CGPoint(x: ($0.x - r.minX) * s, y: (r.maxY - $0.y) * s) }, scale: s) }
    NSGraphicsContext.restoreGraphicsState()
    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: file))
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
    enum ToolbarButton { case copy, undo, close }
    /// los recuadros con flecha que se dibujan adentro del área elegida
    var marks: [Mark] = []
    var marking: (start: CGPoint, current: CGPoint)?
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
        if let s = selected {
            let hint = marks.isEmpty ? "arrastrá adentro para marcar" : "\(marks.count) marca\(marks.count == 1 ? "" : "s") · ⌘Z deshace"
            return Target(rect: s, label: "\(Int(s.width)) × \(Int(s.height)) · \(hint)")
        }
        return hovered.map { Target(rect: $0.rect, label: "\($0.label)  \(Int($0.rect.width)) × \(Int($0.rect.height))") }
    }

    /// La barra con Copiar y la X, en top-left global: debajo del área, alineada a su derecha; si no
    /// entra en la pantalla, adentro del área, abajo a la derecha.
    var toolbar: CGRect? {
        guard let s = selected, dragging == nil else { return nil }
        let size = CGSize(width: marks.isEmpty ? 140 : 172, height: 34)
        let screen = screenRectsTL.first { $0.intersects(s) } ?? screenRectsTL[0]
        var r = CGRect(x: s.maxX - size.width, y: s.maxY + 8, width: size.width, height: size.height)
        if r.maxY > screen.maxY - 4 { r.origin.y = s.maxY - size.height - 8 }
        r.origin.x = max(screen.minX + 8, min(r.origin.x, screen.maxX - size.width - 8))
        r.origin.y = max(screen.minY + 8, r.origin.y)
        return r
    }
    var copyButton: CGRect? { toolbar.map { CGRect(x: $0.minX + 4, y: $0.minY + 4, width: $0.width - (marks.isEmpty ? 40 : 72), height: $0.height - 8) } }
    var undoButton: CGRect? { marks.isEmpty ? nil : toolbar.map { CGRect(x: $0.maxX - 64, y: $0.minY + 4, width: 28, height: $0.height - 8) } }
    var closeButton: CGRect? { toolbar.map { CGRect(x: $0.maxX - 32, y: $0.minY + 4, width: 28, height: $0.height - 8) } }
    func button(at p: CGPoint) -> ToolbarButton? {
        if copyButton?.contains(p) == true { return .copy }
        if undoButton?.contains(p) == true { return .undo }
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
            if hoverButton != nil { NSCursor.pointingHand.set() }
            else if selected?.contains(p) == true, toolbar?.contains(p) != true { NSCursor.crosshair.set() }
            else { NSCursor.arrow.set() }
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
            // con un área elegida: un clic FUERA cancela la captura; adentro, arrastrar dibuja una marca
            guard s.contains(p) else { dlog("clic fuera del área: cancelo"); onCancel?(); return }
            marking = (p, p)
            redraw()
            return
        }
        dragging = (p, p)
        redraw()
    }
    func drag(_ p: CGPoint) {
        mouse = p
        if marking != nil, let s = selected {
            // la marca no se sale del área: afuera no se vería en la imagen
            marking?.current = CGPoint(x: min(max(p.x, s.minX), s.maxX), y: min(max(p.y, s.minY), s.maxY))
            redraw(); return
        }
        if pressing == nil { dragging?.current = p; redraw() }
    }
    /// el recuadro que se está dibujando
    var markingBox: CGRect? {
        marking.map { CGRect(x: min($0.start.x, $0.current.x), y: min($0.start.y, $0.current.y),
                             width: abs($0.start.x - $0.current.x), height: abs($0.start.y - $0.current.y)) }
    }
    func undo() { if !marks.isEmpty { marks.removeLast(); dlog("marca deshecha, quedan \(marks.count)"); redraw() } }
    func up(_ p: CGPoint) {
        mouse = p
        if let b = pressing {
            pressing = nil
            // se dispara sólo si se suelta sobre el MISMO botón, como un botón de verdad
            switch (b, button(at: p), selected) {
            case (.copy, .copy, let s?): dlog("copiar \(s)"); onCopy?(s)
            case (.undo, .undo, _): undo()
            case (.close, .close, _): dlog("cerrar (X)"); onCancel?()
            default: redraw()
            }
            return
        }
        if marking != nil, let box = markingBox, let s = selected {
            marking = nil
            if box.width >= 6, box.height >= 6 { marks.append(makeMark(box, in: s)); dlog("marca \(box)") }
            redraw(); return
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
        case 6 where e.modifierFlags.contains(.command): picker.undo()         // ⌘Z
        default: break
        }
    }

    static let closeIcon: NSImage? = {
        let cfg = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        return NSImage(systemSymbolName: "xmark", accessibilityDescription: "Cerrar")?.withSymbolConfiguration(cfg)
    }()
    static let undoIcon: NSImage? = {
        let cfg = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        return NSImage(systemSymbolName: "arrow.uturn.backward", accessibilityDescription: "Deshacer")?.withSymbolConfiguration(cfg)
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
        // las marcas y la que se está dibujando (ésta sin flecha: la flecha se calcula al soltar)
        let w = window!
        let map: (CGPoint) -> CGPoint = { CGPoint(x: $0.x - w.frame.minX, y: (mainHeight - $0.y) - w.frame.minY) }
        for m in picker.marks { drawMark(m, map: map, scale: 1) }
        if let b = picker.markingBox { drawMark(Mark(box: b, tail: .zero, tip: .zero), map: map, scale: 1, arrow: false) }
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
        let undo = picker.undoButton.map { toLocal($0, in: window!) }
        for (b, rect) in [(Picker.ToolbarButton.copy, copy), (.undo, undo ?? .zero), (.close, close)] where picker.hoverButton == b {
            (picker.pressing == b ? NSColor.systemBlue : NSColor(calibratedWhite: 1, alpha: 0.14)).setFill()
            NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5).fill()
        }
        // separador entre Copiar y la X
        NSColor(calibratedWhite: 1, alpha: 0.18).setFill()
        NSRect(x: (undo ?? close).minX - 4, y: r.minY + 8, width: 1, height: r.height - 16).fill()
        if let u = undo {
            let us = NSSize(width: 14, height: 14)
            SelectionView.white(SelectionView.undoIcon)?.draw(in: NSRect(x: u.midX - us.width / 2, y: u.midY - us.height / 2, width: us.width, height: us.height))
        }

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

// ── ortografía ────────────────────────────────────────────────────────────────────────────────────
//
// Se activa (Abc del panel o SPELL=1), se SELECCIONA el texto como siempre en cualquier app y al soltar
// aparece junto al cursor un botón «Corregir». Lo corrige Haiku (ortografía + redacción), el texto
// corregido queda en el portapapeles y las palabras mal escritas se suman a una lista, sin repetir y sin
// preguntar: esa lista es para otra funcionalidad (practicar). Esc cancela.

/// La lista de palabras mal escritas: una línea JSON por palabra, sin repetidas (--spell-log).
let spellLog = arg("--spell-log") ?? (NSHomeDirectory() + "/Library/Application Support/Captura/errores.jsonl")
/// El modelo que corrige: el más barato de los que acepta Claude Code (--spell-model para otro).
let spellModel = arg("--spell-model") ?? "haiku"

/// `claude` en esta máquina: los mismos lugares que mira el chat (chat/server/servers.go, lookTool).
func claudePath() -> String? {
    let home = NSHomeDirectory()
    return ["/opt/homebrew/bin", "/usr/local/bin", home + "/.local/bin", home + "/.claude/local"]
        .map { $0 + "/claude" }.first { FileManager.default.isExecutableFile(atPath: $0) }
}

let spellPrompt = """
Mirá este texto: validá la ortografía y mejorá la redacción (claridad, concordancia, puntuación), sin \
cambiar el sentido ni el tono. Conservá los saltos de línea, los nombres propios, las marcas, los términos \
técnicos, el código y las palabras en otro idioma. Devolvé SOLO un JSON, sin texto alrededor ni bloque de \
código: {"corrected":"<el texto corregido con las mejoras que consideres>","misspelled":[{"word":"<la \
palabra mal escrita tal cual aparece>","correction":"<cómo se escribe>","context":"<la frase donde aparece>"}]}. \
En "misspelled" van SÓLO los errores de ortografía (tildes, letras cambiadas, homófonos como ha/a o \
hay/ahí), no los cambios de redacción. Si no hay, lista vacía.

TEXTO:

"""

struct SpellResult {
    var corrected: String
    var misspelled: [[String: String]]
}

/// Corrige con Claude Code (`claude -p`), como el chat (chat/server/workday.go, claudeAsk): sin
/// herramientas, sin MCP, sin ajustes de usuario ni de proyecto, en una carpeta vacía y sin guardar la
/// sesión. ⚠ Gasta el límite del asiento del plan, como usar Claude Code. Corre fuera del hilo principal.
func correctText(_ text: String) -> (SpellResult?, String) {
    guard let path = claudePath() else { return (nil, "no está `claude` (Claude Code) en esta máquina") }
    let dir = (NSTemporaryDirectory() as NSString).appendingPathComponent("captura-spell-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = ["-p", "--model", spellModel, "--output-format", "text", "--tools", "", "--strict-mcp-config",
                   "--restricted", "--no-session-persistence"]
    p.currentDirectoryURL = URL(fileURLWithPath: dir)
    // abierta con `open`, la app hereda un PATH mínimo: se le suman los lugares de siempre
    var env = ProcessInfo.processInfo.environment
    let home = NSHomeDirectory()
    env["PATH"] = ["/opt/homebrew/bin", "/usr/local/bin", home + "/.local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", env["PATH"] ?? ""].joined(separator: ":")
    p.environment = env
    let input = Pipe(), output = Pipe(), errors = Pipe()
    p.standardInput = input; p.standardOutput = output; p.standardError = errors
    do { try p.run() } catch { return (nil, "no corrió claude: \(error.localizedDescription)") }
    input.fileHandleForWriting.write((spellPrompt + String(text.prefix(4000))).data(using: .utf8)!)
    input.fileHandleForWriting.closeFile()
    let timer = DispatchWorkItem { if p.isRunning { p.terminate() } }
    DispatchQueue.global().asyncAfter(deadline: .now() + 60, execute: timer)
    let data = output.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    timer.cancel()
    var raw = String(data: data, encoding: .utf8) ?? ""
    guard p.terminationStatus == 0 else {
        let e = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return (nil, "claude falló (\(p.terminationStatus)): \(String((e + raw).trimmingCharacters(in: .whitespacesAndNewlines).prefix(160)))")
    }
    // a veces lo envuelve en ```json … ``` aunque se le pida que no: se toma del primer { al último }
    if let a = raw.firstIndex(of: "{"), let b = raw.lastIndex(of: "}") { raw = String(raw[a...b]) }
    guard let obj = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
          let corrected = obj["corrected"] as? String, !corrected.isEmpty else { return (nil, "claude no devolvió el JSON esperado") }
    let words = (obj["misspelled"] as? [[String: Any]] ?? []).compactMap { m -> [String: String]? in
        guard let w = m["word"] as? String, !w.isEmpty else { return nil }
        return ["word": w, "correction": m["correction"] as? String ?? "", "context": m["context"] as? String ?? ""]
    }
    return (SpellResult(corrected: corrected, misspelled: words), "ok")
}

/// Suma las palabras a la lista, salvo las que ya estaban (sin distinguir mayúsculas). Devuelve cuántas
/// entraron.
func saveWords(_ words: [[String: String]], app: String) -> Int {
    let existing = Set(((try? String(contentsOfFile: spellLog, encoding: .utf8)) ?? "")
        .split(separator: "\n")
        .compactMap { (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any] }
        .compactMap { ($0["word"] as? String)?.lowercased() })
    var seen = existing
    var lines = ""
    let iso = ISO8601DateFormatter()
    for w in words {
        let key = w["word", default: ""].lowercased()
        guard !key.isEmpty, !seen.contains(key) else { continue }
        seen.insert(key)
        var entry: [String: Any] = w
        entry["at"] = iso.string(from: Date()); entry["app"] = app; entry["source"] = spellModel
        if let d = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]), let l = String(data: d, encoding: .utf8) { lines += l + "\n" }
    }
    guard !lines.isEmpty else { return 0 }
    try? FileManager.default.createDirectory(atPath: (spellLog as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    if let h = FileHandle(forWritingAtPath: spellLog) { h.seekToEndOfFile(); h.write(lines.data(using: .utf8)!); h.closeFile() }
    else { try? lines.write(toFile: spellLog, atomically: true, encoding: .utf8) }
    return lines.split(separator: "\n").count
}

/// El texto SELECCIONADO en la app de adelante. Primero por Accesibilidad (AXSelectedText del elemento
/// con foco); si la app no lo da y el gesto fue una selección (arrastre o doble clic), con ⌘C, dejando el
/// portapapeles como estaba.
func selectedText(allowCopy: Bool) -> (text: String, app: String) {
    guard let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != ownPID else { return ("", "") }
    let appName = front.localizedName ?? "app"
    let appEl = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetMessagingTimeout(appEl, 0.2)
    wakeAccessibility(appEl, pid: front.processIdentifier)
    if let f = axAttr(appEl, kAXFocusedUIElementAttribute), CFGetTypeID(f) == AXUIElementGetTypeID(),
       let s = axAttr(f as! AXUIElement, kAXSelectedTextAttribute) as? String,
       !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return (s, appName)
    }
    guard allowCopy else { return ("", appName) }
    return (copyViaKeyboard(), appName)
}

/// ⌘C a la app de adelante y lo que dejó en el portapapeles; después se restaura lo que había.
func copyViaKeyboard() -> String {
    let pb = NSPasteboard.general
    let saved: [[NSPasteboard.PasteboardType: Data]] = (pb.pasteboardItems ?? []).map { item in
        var d: [NSPasteboard.PasteboardType: Data] = [:]
        for t in item.types { if let v = item.data(forType: t) { d[t] = v } }
        return d
    }
    let before = pb.changeCount
    let src = CGEventSource(stateID: .combinedSessionState)
    for down in [true, false] {
        let e = CGEvent(keyboardEventSource: src, virtualKey: 8, keyDown: down) // la C
        e?.flags = .maskCommand
        e?.post(tap: .cghidEventTap)
    }
    let deadline = Date().addingTimeInterval(0.35)
    while pb.changeCount == before, Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
    guard pb.changeCount != before else { return "" }
    let text = pb.string(forType: .string) ?? ""
    pb.clearContents()
    let items = saved.map { d -> NSPasteboardItem in
        let it = NSPasteboardItem(); for (t, v) in d { it.setData(v, forType: t) }; return it
    }
    if !items.isEmpty { pb.writeObjects(items) }
    return text
}

/// El botoncito junto al cursor: «Corregir», después «Corrigiendo…» y al final «Copiado ✓». No toma el
/// foco (panel no activante), así la selección de la otra app sigue intacta.
final class SpellButton: NSObject {
    let panel: FloatingPanel
    let button = PanelButton()
    let spinner = NSProgressIndicator()
    var onPress: (() -> Void)?

    override init() {
        panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 140, height: 34),
                              styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        panel.level = .popUpMenu
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let bg = NSVisualEffectView()
        bg.material = .hudWindow
        bg.blendingMode = .behindWindow
        bg.state = .active
        bg.appearance = NSAppearance(named: .vibrantDark)
        bg.wantsLayer = true
        bg.layer?.cornerRadius = 9
        bg.layer?.masksToBounds = true
        button.isBordered = false
        button.bezelStyle = .regularSquare
        button.contentTintColor = .white
        button.imagePosition = .imageLeading
        button.font = .systemFont(ofSize: 13, weight: .medium)
        button.target = self
        button.action = #selector(pressed)
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isHidden = true
        let stack = NSStackView(views: [spinner, button])
        stack.orientation = .horizontal
        stack.spacing = 6
        stack.edgeInsets = NSEdgeInsets(top: 6, left: 10, bottom: 6, right: 12)
        stack.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: bg.leadingAnchor), stack.trailingAnchor.constraint(equalTo: bg.trailingAnchor),
            stack.topAnchor.constraint(equalTo: bg.topAnchor), stack.bottomAnchor.constraint(equalTo: bg.bottomAnchor),
        ])
        panel.contentView = bg
    }

    @objc func pressed() { if button.isEnabled { onPress?() } }

    func set(_ title: String, symbol: String?, busy: Bool = false, enabled: Bool = true) {
        let cfg = NSImage.SymbolConfiguration(pointSize: 13, weight: .medium)
        button.image = symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil)?.withSymbolConfiguration(cfg) }
        button.attributedTitle = NSAttributedString(string: title, attributes: [.foregroundColor: NSColor.white, .font: NSFont.systemFont(ofSize: 13, weight: .medium)])
        button.isEnabled = enabled
        spinner.isHidden = !busy
        busy ? spinner.startAnimation(nil) : spinner.stopAnimation(nil)
        panel.setContentSize(panel.contentView!.fittingSize)
    }

    /// Abajo a la derecha del cursor (Cocoa), sin salirse de la pantalla.
    func show(at m: NSPoint) {
        set("Corregir", symbol: "textformat.abc")
        let screen = NSScreen.screens.first { $0.frame.contains(m) } ?? NSScreen.screens[0]
        let vf = screen.visibleFrame, size = panel.frame.size
        var o = NSPoint(x: m.x + 12, y: m.y - size.height - 14)
        o.x = max(vf.minX + 6, min(o.x, vf.maxX - size.width - 6))
        if o.y < vf.minY + 6 { o.y = m.y + 14 }
        panel.setFrameOrigin(o)
        panel.orderFrontRegardless()
    }
    func hide() { panel.orderOut(nil) }
    var visible: Bool { panel.isVisible }
}

/// Una corrección: espera una selección, muestra el botón y corrige. Termina con onDone(código, resultado).
final class SpellSession {
    let button = SpellButton()
    var monitors: [Any] = []
    var downAt = NSPoint.zero
    var text = "", app = ""
    var busy = false
    var onDone: ((Int32, String) -> Void)?

    func start() {
        dlog("ortografía: esperando una selección")
        button.onPress = { [weak self] in self?.correct() }
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] e in
            self?.downAt = NSEvent.mouseLocation
            if self?.busy == false { self?.button.hide() }
        } as Any)
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: .leftMouseUp) { [weak self] e in
            self?.mouseUp(clicks: e.clickCount)
        } as Any)
        // Esc en cualquier app (los monitores globales de teclado piden Accesibilidad, que ya está)
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] e in
            if e.keyCode == 53, self?.busy == false { self?.finish(1, "cancel") }
        } as Any)
    }

    func mouseUp(clicks: Int) {
        guard !busy else { return }
        let m = NSEvent.mouseLocation
        let dragged = hypot(m.x - downAt.x, m.y - downAt.y) >= 4
        // la app tarda un instante en registrar la selección nueva
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            let (t, a) = selectedText(allowCopy: dragged || clicks >= 2)
            let clean = t.trimmingCharacters(in: .whitespacesAndNewlines)
            dlog("ortografía: soltó (arrastre=\(dragged), clics=\(clicks)) en \(a): \(clean.count) caracteres «\(clean.prefix(60))»")
            guard !clean.isEmpty else { return }
            self.text = clean; self.app = a
            self.button.show(at: m)
        }
    }

    func correct() {
        guard !busy, !text.isEmpty else { return }
        busy = true
        button.set("Corrigiendo…", symbol: nil, busy: true, enabled: false)
        let text = self.text, app = self.app
        DispatchQueue.global(qos: .userInitiated).async {
            let t0 = Date()
            let (res, why) = correctText(text)
            DispatchQueue.main.async {
                guard let res else {
                    dlog("ortografía: falló: \(why)")
                    self.button.set("No se pudo corregir", symbol: "exclamationmark.triangle", enabled: false)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { self.finish(2, "error \(why)") }
                    return
                }
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(res.corrected, forType: .string)
                let added = saveWords(res.misspelled, app: app)
                dlog(String(format: "ortografía: corregido en %.1f s · %d mal escritas, %d nuevas en la lista", Date().timeIntervalSince(t0), res.misspelled.count, added))
                self.button.set(added > 0 ? "Copiado ✓ · \(added) a la lista" : "Copiado ✓", symbol: "checkmark", enabled: false)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                    self.finish(0, "ok spell \(res.misspelled.count) mal escritas, \(added) nuevas · \(spellLog)")
                }
            }
        }
    }

    func finish(_ code: Int32, _ result: String) {
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors = []
        button.hide()
        onDone?(code, result)
    }
}

// ── la app ────────────────────────────────────────────────────────────────────────────────────────

final class AppDelegate: NSObject, NSApplicationDelegate {
    var windows: [OverlayWindow] = []
    let picker = Picker()
    var tick: Timer?
    var panel: FloatingPanel?
    var selecting = false
    var spellSession: SpellSession?
    /// la «T» del panel: normal apagada, en negrita mientras la ortografía espera una selección
    var spellToggle: NSButton?

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
        } else if let t = arg("--spell-test") {
            // prueba de la corrección sin seleccionar nada: el texto va por argumento y el resultado al log
            DispatchQueue.global().async {
                let (res, why) = correctText(t)
                DispatchQueue.main.async {
                    guard let res else { report("error \(why)"); self.finish(code: 2); return }
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(res.corrected, forType: .string)
                    let added = saveWords(res.misspelled, app: "prueba")
                    dlog("prueba: corregido «\(res.corrected)» · mal escritas \(res.misspelled) · \(added) nuevas")
                    report("ok spell \(res.misspelled.count) mal escritas, \(added) nuevas · \(spellLog)"); self.finish(code: 0)
                }
            }
        } else if CommandLine.arguments.contains("--spell") {
            startSpell()
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
                makeSpellToggle(),
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
    func makeSpellToggle() -> NSButton {
        let b = makePanelButton(symbol: "textformat", tip: "Ortografía: seleccioná un texto y corregilo (otra vez la T o Esc la apaga)",
                                target: self, action: #selector(onSpellButton))
        b.image = nil
        spellToggle = b
        setSpellToggle(active: false)
        return b
    }

    func setSpellToggle(active: Bool) {
        guard let b = spellToggle else { return }
        let font = NSFont.systemFont(ofSize: active ? 18 : 17, weight: active ? .heavy : .regular)
        let color = active ? NSColor.white : NSColor(calibratedWhite: 1, alpha: 0.8)
        b.attributedTitle = NSAttributedString(string: "T", attributes: [.font: font, .foregroundColor: color])
    }

    @objc func onSpellButton() {
        // con la ortografía activa, la T la apaga (si no está corrigiendo)
        if let s = spellSession { if !s.busy { s.finish(1, "cancel") }; return }
        guard !selecting else { return }
        dlog("panel: ortografía")
        startSpell()
    }

    /// La corrección por selección: el panel se queda donde está (no tapa la selección de nadie).
    func startSpell() {
        guard spellSession == nil else { return }
        selecting = true
        let s = SpellSession()
        setSpellToggle(active: true)
        s.onDone = { [weak self] code, result in
            self?.spellSession = nil
            self?.setSpellToggle(active: false)
            self?.endSelection(code: code, result: result)
        }
        spellSession = s
        s.start()
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
        picker.marks = []; picker.marking = nil
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
        teardownOverlay()
        guard panelMode else { report(result); finish(code: code); return }
        dlog("panel: fin de la selección (\(result))")
        selecting = false
        NSCursor.arrow.set()
        showPanel()
    }

    func teardownOverlay() {
        tick?.invalidate(); tick = nil
        windows.forEach { $0.orderOut(nil); $0.close() }
        windows = []
        picker.views = []
    }

    func startPanelDebug() {
        guard let d = debugDir else { return }
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
        dlog("panel: pid \(ownPID) · frame=\(panel?.frame ?? .zero) · AX=\(AXIsProcessTrusted()) · pantalla=\(CGPreflightScreenCaptureAccess())")
        // la T prendida entre 1,5 y 3,5 s: la foto 1 la muestra apagada y la 2 en negrita
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startSpell() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { self.spellSession?.finish(1, "cancel") }
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
        if CommandLine.arguments.contains("--debug-mark") {
            // una marca arriba a la izquierda del área y otra abajo a la derecha; a los 5,5 s copia
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                guard let s = self.picker.selected else { return }
                for (fx, fy) in [(0.08, 0.1), (0.62, 0.58)] {
                    let b = CGRect(x: s.minX + s.width * fx, y: s.minY + s.height * fy, width: s.width * 0.28, height: s.height * 0.28)
                    self.picker.marks.append(makeMark(b, in: s))
                }
                self.picker.redraw()
                dlog("debug: 2 marcas en \(s)")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.5) { self.picker.copySelected() }
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
        let marks = picker.marks
        let area = CGRect(x: x, y: y, width: wd, height: ht) // lo que screencapture fotografía de verdad

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
            paintMarks(marks, onto: file, area: area)
            if !marks.isEmpty { dlog("captura: \(marks.count) marca(s) pintadas en la imagen") }
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
