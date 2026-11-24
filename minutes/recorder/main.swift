// minutes-recorder — graba una reunión en una carpeta: la pantalla (≈1 captura por segundo, sólo las que cambian), el
// micrófono y el audio del sistema (lo que suena en la reunión), cada uno en tramos WAV de 16 kHz mono para Whisper.
//
// Todo sale de UN SCStream de ScreenCaptureKit: la pantalla, `capturesAudio` (el sistema) y `captureMicrophone`
// (macOS 15+). El micrófono en macOS se COMPARTE: abrirlo acá no se lo quita a Meet, Zoom ni Slack, que lo siguen
// usando igual. No se usa el procesamiento de voz (voice processing) de AVAudioEngine, que sí cambia el audio de las
// otras apps (baja el volumen del resto).
//
// Permisos: macOS los da a la app RESPONSABLE. Por eso `bin/minutes start` arma Minutes.app y la abre con `open`:
// pide «Grabación de pantalla» (cubre también el audio del sistema) y «Micrófono» una sola vez, para ella.
//
//   minutes-recorder --out <carpeta> [--chunk 15] [--no-mic] [--no-system] [--no-screen] [--display <id>]
//
// --no-screen: sólo audio. El stream de ScreenCaptureKit igual hace falta para el audio del sistema (y pide el mismo
// permiso), pero no se le pide la pantalla: va a 64x36 cada 10 s y nadie recibe esos cuadros, así que no hay capturas.
//
// La carpeta:
//   frames/<ms>.jpg + frames.jsonl   {"t": segundos, "file": "frames/…", "change": 0..1}
//   audio/<mic|system>/<ms>.wav      un tramo; el nombre es su comienzo en ms desde el arranque. Se escribe con otro
//                                    nombre y se renombra al terminar: el que lo vea, lo ve entero.
//   recorder.json                    pid, comienzo, pantalla; al terminar, `ended` y `seconds`.
//   recorder.log
// Se frena con el archivo <carpeta>/stop (lo crea `bin/minutes stop`), con SIGINT o con SIGTERM.

import AppKit
import AVFoundation
import CoreMedia
import CoreImage
import ScreenCaptureKit

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}
func has(_ name: String) -> Bool { CommandLine.arguments.contains(name) }

guard let outPath = arg("--out") else {
    FileHandle.standardError.write("falta --out <carpeta>\n".data(using: .utf8)!)
    exit(2)
}
let out = URL(fileURLWithPath: outPath)
let chunkSeconds = Double(arg("--chunk") ?? "15") ?? 15
let wantMic = !has("--no-mic")
let wantSystem = !has("--no-system")
let wantScreen = !has("--no-screen")
let sampleRate = 16000.0

let fm = FileManager.default
try? fm.createDirectory(at: out.appendingPathComponent("frames"), withIntermediateDirectories: true)
try? fm.createDirectory(at: out.appendingPathComponent("audio/mic"), withIntermediateDirectories: true)
try? fm.createDirectory(at: out.appendingPathComponent("audio/system"), withIntermediateDirectories: true)

let logURL = out.appendingPathComponent("recorder.log")
fm.createFile(atPath: logURL.path, contents: nil)
let logHandle = try? FileHandle(forWritingTo: logURL)
func log(_ s: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
    logHandle?.seekToEndOfFile()
    logHandle?.write(line.data(using: .utf8)!)
    FileHandle.standardError.write(line.data(using: .utf8)!)
}

func appendLine(_ url: URL, _ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]) else { return }
    if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
    if let h = try? FileHandle(forWritingTo: url) {
        h.seekToEndOfFile()
        h.write(data)
        h.write("\n".data(using: .utf8)!)
        try? h.close()
    }
}

func writeJSON(_ url: URL, _ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) {
        try? data.write(to: url, options: .atomic)
    }
}

/// El reloj de la grabación: los sample buffers de ScreenCaptureKit vienen en el reloj del host.
let startHost = CMClockGetTime(CMClockGetHostTimeClock())
let startDate = Date()
func secondsSinceStart(_ pts: CMTime) -> Double {
    let s = CMTimeGetSeconds(CMTimeSubtract(pts, startHost))
    return s.isFinite ? max(0, s) : 0
}

// MARK: - audio: tramos WAV de 16 kHz mono Int16

final class ChunkWriter {
    let name: String
    let dir: URL
    var samples: [Int16] = []
    var chunkStart: Double = -1 // segundos desde el arranque del primer sample del tramo
    var converter: AVAudioConverter?
    var inFormat: AVAudioFormat?
    let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    var total = 0

    init(name: String, dir: URL) { self.name = name; self.dir = dir }

    func add(_ sb: CMSampleBuffer) {
        guard let desc = CMSampleBufferGetFormatDescription(sb) else { return }
        let fmt = AVAudioFormat(cmAudioFormatDescription: desc)
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sb))
        guard frames > 0, let inBuf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { return }
        inBuf.frameLength = frames
        let st = CMSampleBufferCopyPCMDataIntoAudioBufferList(sb, at: 0, frameCount: Int32(frames), into: inBuf.mutableAudioBufferList)
        guard st == noErr else { log("\(name): no se pudo copiar el audio (\(st))"); return }
        if inFormat == nil || inFormat! != fmt {
            inFormat = fmt
            converter = AVAudioConverter(from: fmt, to: outFormat)
            log("\(name): \(fmt.sampleRate) Hz, \(fmt.channelCount) canal(es)")
        }
        guard let conv = converter else { return }
        let cap = AVAudioFrameCount(Double(frames) * sampleRate / fmt.sampleRate) + 32
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        conv.convert(to: outBuf, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return inBuf
        }
        if let err { log("\(name): conversión: \(err)"); return }
        if chunkStart < 0 { chunkStart = secondsSinceStart(CMSampleBufferGetPresentationTimeStamp(sb)) }
        let n = Int(outBuf.frameLength)
        if let p = outBuf.floatChannelData?[0] {
            for i in 0..<n {
                let v = max(-1, min(1, p[i]))
                samples.append(Int16(v * 32767))
            }
        }
        if Double(samples.count) >= chunkSeconds * sampleRate { flush() }
    }

    func flush() {
        guard !samples.isEmpty, chunkStart >= 0 else { return }
        let ms = Int(chunkStart * 1000)
        let final = dir.appendingPathComponent(String(format: "%09d.wav", ms))
        let tmp = dir.appendingPathComponent(String(format: ".%09d.wav.tmp", ms))
        var data = Data()
        let byteCount = samples.count * 2
        func u32(_ v: UInt32) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 2)) }
        data.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + byteCount))
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1)
        u32(UInt32(sampleRate)); u32(UInt32(sampleRate) * 2); u16(2); u16(16)
        data.append("data".data(using: .ascii)!); u32(UInt32(byteCount))
        samples.withUnsafeBufferPointer { data.append(Data(buffer: $0)) }
        do {
            try data.write(to: tmp)
            try fm.moveItem(at: tmp, to: final)
        } catch { log("\(name): no se pudo escribir el tramo: \(error)") }
        total += samples.count
        samples.removeAll(keepingCapacity: true)
        chunkStart = -1
    }
}

// MARK: - pantalla: guardar sólo lo que cambió

final class FrameKeeper {
    let ci = CIContext()
    var last: [UInt8]? = nil
    var kept = 0
    var seen = 0
    var lastSeen: Double = -10
    let thumbW = 64, thumbH = 36
    /// fracción de miniatura que tiene que cambiar para guardar otra captura (un cursor que parpadea no alcanza)
    let threshold = Double(arg("--change") ?? "0.02") ?? 0.02

    func thumb(_ img: CIImage) -> [UInt8]? {
        let sx = CGFloat(thumbW) / img.extent.width, sy = CGFloat(thumbH) / img.extent.height
        let small = img.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
        var buf = [UInt8](repeating: 0, count: thumbW * thumbH * 4)
        ci.render(small, toBitmap: &buf, rowBytes: thumbW * 4, bounds: CGRect(x: 0, y: 0, width: thumbW, height: thumbH),
                  format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        var gray = [UInt8](repeating: 0, count: thumbW * thumbH)
        for i in 0..<(thumbW * thumbH) {
            gray[i] = UInt8((Int(buf[i * 4]) * 3 + Int(buf[i * 4 + 1]) * 6 + Int(buf[i * 4 + 2])) / 10)
        }
        return gray
    }

    func add(_ sb: CMSampleBuffer) {
        // ScreenCaptureKit manda también cuadros «idle» (nada cambió) sin imagen: esos no cuentan.
        if let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let raw = atts.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw), status != .complete {
            return
        }
        guard let pix = CMSampleBufferGetImageBuffer(sb) else { return }
        let t = secondsSinceStart(CMSampleBufferGetPresentationTimeStamp(sb))
        if t - lastSeen < 0.9 { return } // ≈1 por segundo aunque lleguen más
        lastSeen = t
        seen += 1
        let img = CIImage(cvPixelBuffer: pix)
        guard let g = thumb(img) else { return }
        var change = 1.0
        if let prev = last {
            var diff = 0
            for i in 0..<g.count where abs(Int(g[i]) - Int(prev[i])) > 12 { diff += 1 }
            change = Double(diff) / Double(g.count)
            if change < threshold { return }
        }
        last = g
        let ms = Int(t * 1000)
        let rel = String(format: "frames/%09d.jpg", ms)
        let url = out.appendingPathComponent(rel)
        do {
            try ci.writeJPEGRepresentation(of: img, to: url, colorSpace: CGColorSpaceCreateDeviceRGB(),
                                           options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.7])
            kept += 1
            appendLine(out.appendingPathComponent("frames.jsonl"), ["t": (t * 10).rounded() / 10, "file": rel, "change": (change * 1000).rounded() / 1000])
        } catch { log("captura: \(error)") }
    }
}

// MARK: - el stream

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    var stream: SCStream?
    let frames = FrameKeeper()
    let mic = ChunkWriter(name: "mic", dir: out.appendingPathComponent("audio/mic"))
    let system = ChunkWriter(name: "system", dir: out.appendingPathComponent("audio/system"))
    let videoQ = DispatchQueue(label: "minutes.video")
    let audioQ = DispatchQueue(label: "minutes.audio")
    var displayInfo: [String: Any] = [:]
    var stopping = false

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        var display = content.displays.first
        if let want = arg("--display").flatMap(UInt32.init) {
            display = content.displays.first { $0.displayID == want } ?? display
        } else {
            // la pantalla donde está el mouse: casi siempre la de la reunión
            let mouse = NSEvent.mouseLocation
            if let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }),
               let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32 {
                display = content.displays.first { $0.displayID == id } ?? display
            }
        }
        guard let display else { throw NSError(domain: "minutes", code: 1, userInfo: [NSLocalizedDescriptionKey: "no hay pantallas"]) }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let cfg = SCStreamConfiguration()
        // el ancho lógico ×2 hasta 1920: alcanza para leer texto y no llena el disco
        let w = min(1920, display.width * 2)
        cfg.width = w
        cfg.height = Int(Double(w) * Double(display.height) / Double(display.width))
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        if !wantScreen { // sólo audio: lo mínimo que acepta el stream, y sin salida de pantalla
            cfg.width = 64
            cfg.height = 36
            cfg.minimumFrameInterval = CMTime(value: 10, timescale: 1)
        }
        cfg.queueDepth = 3
        cfg.showsCursor = true
        cfg.capturesAudio = wantSystem
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 1
        if #available(macOS 15.0, *) { cfg.captureMicrophone = wantMic }
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        if wantScreen { try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQ) }
        if wantSystem { try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQ) }
        if #available(macOS 15.0, *), wantMic { try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: audioQ) }
        try await s.startCapture()
        stream = s
        displayInfo = ["id": display.displayID, "width": cfg.width, "height": cfg.height]
        log("grabando: pantalla \(display.displayID) a \(cfg.width)x\(cfg.height), micrófono=\(wantMic), sistema=\(wantSystem), pantalla=\(wantScreen)")
        writeState(ended: nil)
    }

    func writeState(ended: Date?) {
        var o: [String: Any] = [
            "pid": Int(getpid()), "started": ISO8601DateFormatter().string(from: startDate),
            "display": displayInfo, "chunk_seconds": chunkSeconds, "mic": wantMic, "system": wantSystem, "screen": wantScreen,
        ]
        if let ended {
            o["ended"] = ISO8601DateFormatter().string(from: ended)
            o["seconds"] = (ended.timeIntervalSince(startDate) * 10).rounded() / 10
            o["frames_seen"] = frames.seen
            o["frames_kept"] = frames.kept
            o["mic_seconds"] = Double(mic.total) / sampleRate
            o["system_seconds"] = Double(system.total) / sampleRate
        }
        writeJSON(out.appendingPathComponent("recorder.json"), o)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sb.isValid, !stopping else { return }
        switch type {
        case .screen: frames.add(sb)
        case .audio: system.add(sb)
        default:
            if #available(macOS 15.0, *), type == .microphone { mic.add(sb) }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("el stream se cortó: \(error.localizedDescription)")
        finish(code: 1)
    }

    func finish(code: Int32) {
        if stopping { return }
        stopping = true
        let done = DispatchGroup()
        if let s = stream {
            done.enter()
            s.stopCapture { _ in done.leave() }
        }
        done.notify(queue: .main) {
            self.audioQ.sync { self.mic.flush(); self.system.flush() }
            self.videoQ.sync {}
            self.writeState(ended: Date())
            log("listo: \(self.frames.kept) de \(self.frames.seen) capturas guardadas")
            exit(code)
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let recorder = Recorder()

for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler { recorder.finish(code: 0) }
    src.resume()
    objc_setAssociatedObject(app, "sig\(sig)", src, .OBJC_ASSOCIATION_RETAIN)
}
// SIGHUP (la terminal que la lanzó se cerró): se anota y se sigue grabando; la grabadora no depende de esa terminal.
signal(SIGHUP, SIG_IGN)
signal(SIGPIPE, SIG_IGN)
let hup = DispatchSource.makeSignalSource(signal: SIGHUP, queue: .main)
hup.setEventHandler { log("SIGHUP: se ignora, sigue grabando") }
hup.resume()
// el archivo stop: lo deja `bin/minutes stop` (con `open` no hay un pid fácil de señalar desde make)
let stopURL = out.appendingPathComponent("stop")
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
    if fm.fileExists(atPath: stopURL.path) { recorder.finish(code: 0) }
}
Task {
    do { try await recorder.start() } catch {
        log("no se pudo grabar: \(error.localizedDescription) (¿falta el permiso de Grabación de pantalla o de Micrófono?)")
        appendLine(out.appendingPathComponent("errors.jsonl"), ["error": error.localizedDescription])
        exit(1)
    }
}
app.run()
