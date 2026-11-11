// El número de la ventana de Cockpit en pantalla, para `screencapture -l`: la MÁS GRANDE de las suyas (la primera
// puede ser un tooltip o un menú). Imprime 0 si no hay ninguna a la vista. Lo usa tools/ui-shot/main.mjs.
import CoreGraphics

let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
var best = 0
var bestArea = 0.0
for window in windows where (window["kCGWindowOwnerName"] as? String) == "Cockpit" {
    guard let bounds = window["kCGWindowBounds"] as? [String: Double],
          let width = bounds["Width"], let height = bounds["Height"],
          let number = window["kCGWindowNumber"] as? Int else { continue }
    if width * height > bestArea {
        bestArea = width * height
        best = number
    }
}
print(best)
