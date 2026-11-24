// LA BARRA DE MENÚS: Minutes.app abierta SIN --out no graba: queda como un ícono en la barra de menús de macOS para
// arrancar y frenar sin abrir Cockpit ni una terminal. Con --out es la grabadora de siempre (main.swift).
//
// No tiene lógica propia: corre `bin/minutes start|stop` (el mismo CLI que usan la app de Cockpit y la consola) y lee
// el estado de los mismos archivos (recordings/current y el recorder.json de la grabación). Por eso lo que arranca el
// ícono se ve en Cockpit, y al revés. Es genérico a propósito: no mira qué app de reuniones está abierta.
//
//   ⌃⌥M (en cualquier app)   graba o frena (con el último modo elegido: con pantalla o sólo audio)
//   el menú                   Grabar · Grabar sólo audio · Frenar y resumir · Ver en Cockpit · Abrir al iniciar sesión
//
// El atajo es de Carbon (RegisterEventHotKey): no pide el permiso de Accesibilidad. La raíz de my-tools sale de dónde
// está la app (<raíz>/minutes/recorder/.build/Minutes.app). Una sola barra a la vez (un pid en ~/.cache/my-tools).

import AppKit
import Carbon.HIToolbox
import ServiceManagement

private var menuBar: MenuBar?

func runMenuBar() -> Never {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    // una sola barra: si ya hay otra viva, ésta se va (abrirla de nuevo no duplica el ícono)
    let pidFile = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".cache/my-tools/minutes-menubar.pid")
    if let old = try? String(contentsOf: pidFile, encoding: .utf8), let pid = Int32(old.trimmingCharacters(in: .whitespacesAndNewlines)),
       pid != getpid(), kill(pid, 0) == 0 {
        exit(0)
    }
    try? FileManager.default.createDirectory(at: pidFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? String(getpid()).write(to: pidFile, atomically: true, encoding: .utf8)
    menuBar = MenuBar()
    app.run()
    exit(0)
}

final class MenuBar: NSObject, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let root: URL
    var busy = "" // "" · "arrancando" · "armando el resumen"
    var hotKey: EventHotKeyRef?
    var audioOnly: Bool {
        get { UserDefaults.standard.bool(forKey: "audioOnly") }
        set { UserDefaults.standard.set(newValue, forKey: "audioOnly") }
    }

    override init() {
        // <raíz>/minutes/recorder/.build/Minutes.app → <raíz>
        root = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        super.init()
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        registerHotKey()
        refresh()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }

    // MARK: el estado, de los archivos

    struct Recording { let id: String; let started: Date?; let title: String; let audioOnly: Bool }

    func current() -> Recording? {
        let dir = root.appendingPathComponent("minutes/recordings")
        guard let id = try? String(contentsOf: dir.appendingPathComponent("current"), encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else { return nil }
        let rec = dir.appendingPathComponent(id)
        guard let data = try? Data(contentsOf: rec.appendingPathComponent("recorder.json")),
              let st = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if st["ended"] != nil { return nil }
        if let pid = st["pid"] as? Int, kill(Int32(pid), 0) != 0 { return nil }
        var meta: [String: Any] = [:]
        if let m = try? Data(contentsOf: rec.appendingPathComponent("meta.json")),
           let o = try? JSONSerialization.jsonObject(with: m) as? [String: Any] { meta = o }
        let started = (st["started"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return Recording(id: id, started: started, title: meta["title"] as? String ?? "", audioOnly: meta["audio_only"] as? Bool ?? false)
    }

    func clock(_ s: TimeInterval) -> String {
        let t = max(0, Int(s))
        if t >= 3600 { return String(format: "%d:%02d:%02d", t / 3600, t / 60 % 60, t % 60) }
        return String(format: "%02d:%02d", t / 60, t % 60)
    }

    func refresh() {
        guard let button = item.button else { return }
        let rec = current()
        let symbol: String
        var tint: NSColor? = nil
        if !busy.isEmpty {
            symbol = "hourglass"
            button.title = ""
        } else if rec != nil {
            symbol = "record.circle.fill"
            tint = .systemRed
            // sin el reloj al lado: más ancho, macOS lo esconde primero cuando la app del frente llena la barra hasta
            // el notch (pasó con Chrome). El tiempo va en el menú y en el tooltip.
            button.title = ""
        } else {
            symbol = "waveform"
            button.title = ""
        }
        var image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Minutes")
        if let tint, let img = image {
            image = img.withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [tint]))
            image?.isTemplate = false
        } else {
            image?.isTemplate = true
        }
        button.image = image
        button.imagePosition = .imageLeft
        button.font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize - 1, weight: .regular)
        if let rec { button.toolTip = "Minutes: grabando " + clock(Date().timeIntervalSince(rec.started ?? Date())) + " (⌃⌥M frena)" }
        else if busy.isEmpty { button.toolTip = "Minutes (⌃⌥M graba)" }
        else { button.toolTip = "Minutes: \(busy)…" }
    }

    // MARK: el menú, armado al abrirlo

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let rec = current()
        let head: String
        if !busy.isEmpty { head = "Minutes · \(busy)…" }
        else if let rec {
            // por partes: una sola expresión con varios «+» y ternarios cuelga al compilador de Swift
            var h = "● Grabando " + clock(Date().timeIntervalSince(rec.started ?? Date()))
            if !rec.title.isEmpty { h += " · " + rec.title }
            if rec.audioOnly { h += " · sólo audio" }
            head = h
        }
        else { head = "Minutes · sin grabar" }
        let h = NSMenuItem(title: head, action: nil, keyEquivalent: "")
        h.isEnabled = false
        menu.addItem(h)
        menu.addItem(.separator())
        if rec != nil {
            menu.addItem(entry("Frenar y resumir", #selector(stop), key: "m", enabled: busy.isEmpty))
        } else {
            menu.addItem(entry("Grabar", #selector(startScreen), key: audioOnly ? "" : "m", enabled: busy.isEmpty))
            menu.addItem(entry("Grabar sólo audio", #selector(startAudio), key: audioOnly ? "m" : "", enabled: busy.isEmpty))
        }
        menu.addItem(.separator())
        menu.addItem(entry("Ver en Cockpit", #selector(openCockpit), key: "", enabled: true))
        let login = entry("Abrir al iniciar sesión", #selector(toggleLogin), key: "", enabled: true)
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(entry("Salir de la barra", #selector(quit), key: "", enabled: true))
    }

    func entry(_ title: String, _ action: Selector, key: String, enabled: Bool) -> NSMenuItem {
        let m = NSMenuItem(title: title, action: enabled ? action : nil, keyEquivalent: key)
        if !key.isEmpty { m.keyEquivalentModifierMask = [.control, .option] } // sólo se muestra: el atajo real es el global
        m.target = self
        m.isEnabled = enabled
        return m
    }

    // MARK: las acciones, por el CLI

    @objc func startScreen() { audioOnly = false; start() }
    @objc func startAudio() { audioOnly = true; start() }

    func start() {
        guard busy.isEmpty, current() == nil else { return }
        var args = ["start"]
        if audioOnly { args.append("--no-screen") }
        run(args, busyLabel: "arrancando")
    }

    @objc func stop() {
        guard busy.isEmpty, current() != nil else { return }
        run(["stop"], busyLabel: "armando el resumen")
    }

    func toggle() {
        if current() != nil { stop() } else { start() }
    }

    @objc func openCockpit() {
        var route = ""
        if let id = current()?.id ?? lastRecording() { route = "#/r/\(id)" }
        let cockpit = root.appendingPathComponent("bin/cockpit").path
        let p = Process()
        p.executableURL = URL(fileURLWithPath: cockpit)
        p.arguments = route.isEmpty ? ["open", "minutes"] : ["open", "minutes", route]
        p.environment = env()
        try? p.run()
    }

    func lastRecording() -> String? {
        let dir = root.appendingPathComponent("minutes/recordings")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { $0.first?.isNumber == true }.sorted().last
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            alert("No se pudo cambiar el inicio de sesión", error.localizedDescription)
        }
    }

    @objc func quit() { NSApp.terminate(nil) }

    func env() -> [String: String] {
        var e = ProcessInfo.processInfo.environment
        let home = NSHomeDirectory()
        // abierta con `open` o al iniciar sesión, la app trae un PATH mínimo: el CLI necesita go, whisper-cli, claude…
        var dirs: [String] = ["/opt/homebrew/bin", "/usr/local/bin", home + "/.local/bin", home + "/go/bin", "/usr/local/go/bin"]
        dirs += ["/usr/bin", "/bin", "/usr/sbin", "/sbin", e["PATH"] ?? ""]
        e["PATH"] = dirs.joined(separator: ":")
        e["MY_TOOLS_ROOT"] = root.path
        return e
    }

    func run(_ args: [String], busyLabel: String) {
        busy = busyLabel
        refresh()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: root.appendingPathComponent("bin/minutes").path)
        p.arguments = args
        p.currentDirectoryURL = root
        p.environment = env()
        let errs = Pipe()
        p.standardError = errs
        p.standardOutput = FileHandle.nullDevice
        p.terminationHandler = { proc in
            let msg = String(data: errs.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                self.busy = ""
                self.refresh()
                if proc.terminationStatus != 0 {
                    let last = msg.split(separator: "\n").filter { $0.contains("minutes:") }.last.map(String.init) ?? String(msg.suffix(300))
                    self.alert(args.first == "stop" ? "No se pudo frenar" : "No se pudo grabar", last)
                }
            }
        }
        do { try p.run() } catch {
            busy = ""
            refresh()
            alert("No corrió bin/minutes", error.localizedDescription)
        }
    }

    func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    // MARK: ⌃⌥M en cualquier app

    func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { menuBar?.toggle() }
            return noErr
        }, 1, &spec, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x4D4E5453), id: 1) // 'MNTS'
        RegisterEventHotKey(UInt32(kVK_ANSI_M), UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
    }
}
