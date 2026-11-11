// La app de escritorio del chat. Trae ADENTRO el servidor del chat (Go, `chat-server`, al lado de este binario en
// Contents/MacOS): lo arranca al abrir, lo vuelve a levantar si se cae y lo apaga al salir (⌘Q). La ventana es la
// interfaz que sirve ese servidor en :5185; los enlaces al navegador y el globito del Dock los hace la interfaz
// (src/desktop.js). Los avisos los muestra el avisador de macOS del servidor; tocarlos abre `creditop-chat://open/#/c/…`,
// que trae la app al frente en esa conversación.
//
// - Si :5185 ya contesta (un `make chat` con `go run`, o el servicio viejo del Mac), usa ese y no arranca otro.
// - Cerrar la ventana la esconde: la app sigue juntando el historial y avisando, como un chat. Volver: el ícono del Dock.
// - Arranca sola al iniciar sesión (en la versión compilada con `make chat-app`).
// - El servidor corre desde la carpeta del playground (la que tenía este código al compilar) y con el PATH de tu shell:
//   busca `playground`, `node` y `go` como cuando lo corrés vos. Su registro: ~/Library/Logs/creditop-playground-chat.log.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const ADDR: &str = "127.0.0.1:5185";
const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

fn listening() -> bool {
    let addr: SocketAddr = ADDR.parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

// El PATH de tu shell de login (una app abierta desde el Dock arranca con uno mínimo) y, por las dudas, donde suelen
// estar las herramientas.
fn user_path() -> String {
    let mut path = Command::new("/bin/zsh")
        .args(["-lc", "printf %s \"$PATH\""])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    let extra = [
        format!("{home}/.local/bin"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/local/go/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
        "/sbin".into(),
    ];
    for dir in extra {
        if !path.split(':').any(|p| p == dir) {
            if !path.is_empty() {
                path.push(':');
            }
            path.push_str(&dir);
        }
    }
    path
}

fn start_server(path: &str) -> Option<Child> {
    let bin = std::env::current_exe().ok()?.with_file_name("chat-server");
    let root = std::fs::canonicalize(ROOT).ok()?;
    let log_path = PathBuf::from(std::env::var("HOME").ok()?).join("Library/Logs/creditop-playground-chat.log");
    let log = OpenOptions::new().create(true).append(true).open(log_path).ok()?;
    Command::new(bin)
        .args(["-serve", ADDR])
        .current_dir(&root)
        .env("PLAYGROUND_ROOT", &root)
        .env("PATH", path)
        .stdout(log.try_clone().ok()?)
        .stderr(log)
        .spawn()
        .ok()
}

// El servidor de la app: el proceso, si lo arrancó ella (si usa uno de afuera, ninguno).
#[derive(Clone, Default)]
struct Server(Arc<Mutex<Option<Child>>>);

impl Server {
    fn ensure(&self, path: &str) {
        let mut child = self.0.lock().unwrap();
        let alive = matches!(child.as_mut().map(|c| c.try_wait()), Some(Ok(None)));
        if !alive && !listening() {
            *child = start_server(path);
        }
    }
    fn stop(&self) {
        if let Some(mut c) = self.0.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// Un enlace `creditop-chat://open/#/c/<conversación>`: la ventana al frente y la interfaz a esa ruta (escucha popstate).
fn open_link(app: &tauri::AppHandle, url: &str) {
    show_main(app);
    let hash: String = url
        .split_once('#')
        .map(|(_, h)| h)
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "/@._%-+:".contains(*c))
        .collect();
    if let (Some(w), false) = (app.get_webview_window("main"), hash.is_empty()) {
        let _ = w.eval(format!("location.hash = '#{hash}'"));
    }
}

fn main() {
    let server = Server::default();
    let path = user_path();
    server.ensure(&path);
    // Si se cae, se vuelve a levantar.
    {
        let (server, path) = (server.clone(), path.clone());
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            server.ensure(&path);
        });
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            // La ventana, cuando el servidor contesta (hasta 15 s: la primera vez macOS puede preguntar por Escritorio).
            let start = Instant::now();
            while !listening() && start.elapsed() < Duration::from_secs(15) {
                thread::sleep(Duration::from_millis(150));
            }
            let url: tauri::Url = format!("http://{ADDR}/").parse().unwrap();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.clone()))
                .title("chat")
                .inner_size(1280.0, 820.0)
                .min_inner_size(380.0, 480.0)
                .build()?;
            // Si el servidor todavía no contestaba (macOS esperando el permiso de Escritorio), la ventana quedó en blanco:
            // se recarga sola cuando conteste.
            if !listening() {
                thread::spawn(move || {
                    while !listening() {
                        thread::sleep(Duration::from_millis(500));
                    }
                    let _ = window.navigate(url);
                });
            }
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        open_link(&handle, url.as_str());
                    }
                });
            }
            // Se reescribe en cada arranque: si movés la app (a Aplicaciones), el arranque apunta a donde está ahora.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app.autolaunch().enable();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("no arrancó la app del chat");

    app.run(move |handle, event| match event {
        RunEvent::Reopen { .. } => show_main(handle),
        RunEvent::Exit => server.stop(),
        _ => {}
    });
}
