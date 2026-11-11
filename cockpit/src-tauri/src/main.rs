// COCKPIT: las herramientas del playground en una sola app, con una barra de aplicaciones a la izquierda como la de VS
// Code. La ventana es la carcasa (cockpit/shell/index.html): la barra y, a la derecha, cada app en su panel. Acá vive lo
// que la carcasa no puede hacer sola:
//
// - QUÉ APPS HAY y cómo se levanta cada una (`APPS`). El chat trae su servidor ADENTRO (Go, `chat-server`, al lado de
//   este binario en Contents/MacOS): se arranca al abrir Cockpit, se vuelve a levantar si se cae y se apaga al salir.
//   Las demás se levantan con su `make <app>` la primera vez que las abrís, y se apagan al salir (todo su grupo de
//   procesos). Si el puerto de una app ya contesta (la corriste vos en una terminal), se usa ésa y no se toca.
// - Los enlaces `cockpit://<app>/#/…` (tocar un aviso del chat): la ventana al frente y esa app en esa ruta.
// - Los enlaces que abren ventana nueva (`target="_blank"`, de cualquier app) se abren en tu navegador.
// - Cerrar la ventana la esconde: Cockpit sigue juntando el historial del chat y avisando. Volver: el ícono del Dock.
// - Arranca sola al iniciar sesión (en la versión compilada con `make cockpit`).
//
// Todo corre desde la carpeta del playground (la que tenía este código al compilar) y con el PATH de tu shell. Los
// registros: ~/Library/Logs/creditop-playground-chat.log (el chat) y ~/Library/Logs/cockpit-<app>.log (las demás).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::net::{TcpStream, ToSocketAddrs};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::webview::NewWindowResponse;
use tauri::{Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

enum Start {
    // El servidor del chat, que viene adentro de la app.
    Sidecar,
    // `make <target>` desde la carpeta del playground.
    Make(&'static str),
}

struct AppDef {
    id: &'static str,
    name: &'static str,
    url: &'static str,
    // Lo que tiene que contestar para que la app esté lista (host:puerto).
    ready: &'static [&'static str],
    start: Start,
}

// Las apps de la barra, en orden. Se agregan de a una.
const APPS: &[AppDef] = &[
    AppDef { id: "chat", name: "Chat", url: "http://127.0.0.1:5185/?cockpit=1", ready: &["127.0.0.1:5185"], start: Start::Sidecar },
    AppDef {
        id: "tablero",
        name: "Tablero",
        url: "http://localhost:5191/",
        ready: &["localhost:5191", "127.0.0.1:8787"],
        start: Start::Make("tablero"),
    },
    AppDef {
        id: "harness",
        name: "Harness",
        url: "http://localhost:5195/",
        ready: &["127.0.0.1:5195"],
        start: Start::Make("panel"),
    },
];

fn answers(hostport: &str) -> bool {
    hostport
        .to_socket_addrs()
        .map(|addrs| addrs.into_iter().any(|a| TcpStream::connect_timeout(&a, Duration::from_millis(300)).is_ok()))
        .unwrap_or(false)
}

fn ready(app: &AppDef) -> bool {
    app.ready.iter().all(|hp| answers(hp))
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
        format!("{home}/.cargo/bin"),
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

fn log_file(name: &str) -> Option<std::fs::File> {
    let path = PathBuf::from(std::env::var("HOME").ok()?).join("Library/Logs").join(name);
    OpenOptions::new().create(true).append(true).open(path).ok()
}

fn spawn(app: &AppDef, path: &str) -> Option<Child> {
    let root = std::fs::canonicalize(ROOT).ok()?;
    let (mut cmd, log) = match app.start {
        Start::Sidecar => {
            let mut c = Command::new(std::env::current_exe().ok()?.with_file_name("chat-server"));
            c.args(["-serve", "127.0.0.1:5185"]);
            (c, log_file("creditop-playground-chat.log")?)
        }
        Start::Make(target) => {
            let mut c = Command::new("/usr/bin/make");
            c.arg(target);
            (c, log_file(&format!("cockpit-{}.log", app.id))?)
        }
    };
    cmd.current_dir(&root)
        .env("PLAYGROUND_ROOT", &root)
        .env("PATH", path)
        .stdout(log.try_clone().ok()?)
        .stderr(log)
        // Su propio grupo de procesos: al salir se apaga entero (make → npm → vite y go).
        .process_group(0)
        .spawn()
        .ok()
}

// Los procesos que levantó Cockpit, por app (las que ya estaban corriendo no figuran: no son suyas).
#[derive(Clone)]
struct Running {
    children: Arc<Mutex<HashMap<&'static str, Child>>>,
    path: Arc<String>,
}

impl Running {
    // ¿Está lista? Si no y no hay nada arrancando, la arranca. La carcasa pregunta hasta que diga que sí.
    fn ensure(&self, app: &AppDef) -> bool {
        if ready(app) {
            return true;
        }
        let mut children = self.children.lock().unwrap();
        let alive = matches!(children.get_mut(app.id).map(|c| c.try_wait()), Some(Ok(None)));
        if !alive {
            if let Some(child) = spawn(app, &self.path) {
                children.insert(app.id, child);
            }
        }
        false
    }
    fn stop_all(&self) {
        for (_, mut child) in self.children.lock().unwrap().drain() {
            let _ = Command::new("/bin/kill").args(["-TERM", &format!("-{}", child.id())]).status();
            let _ = child.wait();
        }
    }
}

#[derive(Serialize)]
struct AppInfo {
    id: &'static str,
    name: &'static str,
    url: &'static str,
}

#[tauri::command]
fn apps() -> Vec<AppInfo> {
    APPS.iter().map(|a| AppInfo { id: a.id, name: a.name, url: a.url }).collect()
}

#[tauri::command]
fn ensure_app(id: String, running: State<'_, Running>) -> bool {
    APPS.iter().find(|a| a.id == id).map(|a| running.ensure(a)).unwrap_or(false)
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// Un enlace `cockpit://<app>/#/<ruta>`: la ventana al frente y la carcasa a esa app y ruta.
fn open_link(app: &tauri::AppHandle, url: &tauri::Url) {
    show_main(app);
    let Some(id) = url.host_str().and_then(|h| APPS.iter().find(|a| a.id == h)).map(|a| a.id) else { return };
    let hash: String = url
        .fragment()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "/@._%-+:".contains(*c))
        .collect();
    if let Some(w) = app.get_webview_window("main") {
        let route = if hash.is_empty() { String::new() } else { format!("#{hash}") };
        let _ = w.eval(format!("window.cockpitOpen && window.cockpitOpen('{id}', '{route}')"));
    }
}

fn main() {
    let running = Running { children: Arc::default(), path: Arc::new(user_path()) };
    // El chat, ya: aunque no lo abras, junta el historial y avisa. Si se cae, se vuelve a levantar.
    let chat = &APPS[0];
    running.ensure(chat);
    {
        let running = running.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            running.ensure(&APPS[0]);
        });
    }
    let on_exit = running.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(running)
        .invoke_handler(tauri::generate_handler![apps, ensure_app])
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Cockpit")
                .inner_size(1320.0, 840.0)
                .min_inner_size(420.0, 480.0)
                // Un enlace que abre ventana nueva, de cualquier app: a tu navegador.
                .on_new_window(move |url, _| {
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        open_link(&handle, &url);
                    }
                });
            }
            // Se reescribe en cada arranque: si movés la app, el arranque apunta a donde está ahora.
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
        .expect("no arrancó Cockpit");

    app.run(move |handle, event| match event {
        RunEvent::Reopen { .. } => show_main(handle),
        RunEvent::Exit => on_exit.stop_all(),
        _ => {}
    });
}
