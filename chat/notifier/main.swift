// EL AVISADOR DEL CHAT: una app mínima («Chat de my-tools») que muestra los avisos que decide el servidor del chat
// (server/notify.go) cuando no hay ninguna pestaña abierta. Hace falta porque `osascript` desde el servicio no muestra
// nada si «Editor de Scripts» nunca tuvo permiso de avisos; esta app pide el suyo una vez, con su nombre, y al tocar
// un aviso abre el chat en esa conversación.
//
//	ChatNotifier --title T --body B [--url U] [--group G] [--sound]   muestra un aviso y termina
//	ChatNotifier --status                                              imprime authorized | denied | notDetermined
//	(sin argumentos: así la abre macOS al tocar un aviso; abre su URL y termina)
//
// La compila scripts/notifier.sh.

import AppKit
import UserNotifications

final class Notifier: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let args: [String: String]
    let flags: Set<String>

    init(arguments: [String]) {
        var values: [String: String] = [:]
        var flags = Set<String>()
        var i = 1
        while i < arguments.count {
            let a = arguments[i]
            if a.hasPrefix("--") {
                let key = String(a.dropFirst(2))
                if i + 1 < arguments.count, !arguments[i + 1].hasPrefix("--") {
                    values[key] = arguments[i + 1]
                    i += 2
                    continue
                }
                flags.insert(key)
            }
            i += 1
        }
        self.args = values
        self.flags = flags
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Antes de terminar de arrancar: si la abrió un toque en un aviso, la respuesta llega enseguida.
        UNUserNotificationCenter.current().delegate = self
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let center = UNUserNotificationCenter.current()
        if flags.contains("status") {
            center.getNotificationSettings { s in
                switch s.authorizationStatus {
                case .authorized, .provisional, .ephemeral: print("authorized")
                case .denied: print("denied")
                default: print("notDetermined")
                }
                exit(0)
            }
            return
        }
        guard let title = args["title"] else {
            // La abrió un toque: el delegado abre la URL. Si no llega nada, termina sola.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { exit(0) }
            return
        }
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            guard granted else {
                FileHandle.standardError.write("sin permiso de avisos: \(error?.localizedDescription ?? "denegado")\n".data(using: .utf8)!)
                exit(3)
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = self.args["body"] ?? ""
            if self.flags.contains("sound") { content.sound = .default }
            if let group = self.args["group"] { content.threadIdentifier = group }
            if let url = self.args["url"] { content.userInfo = ["url": url] }
            let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
            center.add(request) { error in
                if let error = error {
                    FileHandle.standardError.write("no se pudo avisar: \(error.localizedDescription)\n".data(using: .utf8)!)
                    exit(4)
                }
                exit(0)
            }
        }
    }

    // Con la app al frente (no pasa: es de fondo), igual se muestra.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let raw = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: raw) {
            NSWorkspace.shared.open(url)
        }
        completionHandler()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
    }
}

let app = NSApplication.shared
let notifier = Notifier(arguments: CommandLine.arguments)
app.delegate = notifier
app.setActivationPolicy(.accessory)
app.run()
