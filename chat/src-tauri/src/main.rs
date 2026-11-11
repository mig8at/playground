// La app de escritorio del chat: una ventana sobre la interfaz que sirve el servidor del chat (:5185, el servicio del
// Mac). Lo demás lo hace la interfaz (src/desktop.js) con los plugins de abajo: avisos nativos, enlaces al navegador y
// el globito del Dock. La ventana recuerda su tamaño y lugar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("no arrancó la app del chat");
}
