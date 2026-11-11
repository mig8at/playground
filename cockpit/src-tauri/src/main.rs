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
// - EL PUERTO DE CONTROL (127.0.0.1:5209, `control_server`): para que Claude maneje Cockpit por consola (`bin/cockpit`)
//   y cuente lo que hace, que se ve en vivo en el panel «Claude» de la carcasa. Pide la llave que Cockpit deja al
//   arrancar en ~/.config/creditop-cockpit/control.json (600; se borra al salir): una página web no la conoce.
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
use tauri::{Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
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
    AppDef {
        id: "jarvis",
        name: "Jarvis",
        // Su Vite escucha sólo en IPv6: va con localhost, nunca 127.0.0.1 (jarvis/CLAUDE.md).
        url: "http://localhost:5202/",
        ready: &["localhost:5202", "127.0.0.1:5203"],
        start: Start::Make("jarvis"),
    },
    AppDef {
        // El visor (visor/): un diseño de Figma pantalla por pantalla, al lado de su HTML. En la barra, «Designer».
        id: "designer",
        name: "Designer",
        url: "http://localhost:5193/",
        ready: &["localhost:5193", "127.0.0.1:5194"],
        start: Start::Make("visor"),
    },
    AppDef {
        // ¿Qué le pasó a esta prueba de tienda? Por celular, URL del wizard o número de solicitud (local o qa).
        id: "ecommerce",
        name: "Ecommerce",
        url: "http://localhost:5178/",
        ready: &["localhost:5178", "127.0.0.1:5179"],
        start: Start::Make("ecommerce"),
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
    fn started(&self, id: &str) -> bool {
        self.children.lock().unwrap().contains_key(id)
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

// La app al frente, que la carcasa avisa al cambiar: la lee `status` del puerto de control.
#[derive(Default)]
struct Current(Mutex<String>);

// FRENAR: con el botón del panel «Claude», el hook `cockpit` niega cada herramienta que Claude intente usar (menos
// `bin/cockpit`, para que pueda contar que paró). Se levanta con «Reanudar» o cuando Miguel le escribe a Claude
// (hook en UserPromptSubmit). Lo que ya estaba corriendo termina: se corta lo siguiente, no un proceso a la mitad.
#[derive(Default)]
struct Stopped(Mutex<bool>);

fn set_stop(app: &tauri::AppHandle, stopped: bool, by: &str) {
    let changed = {
        let state = app.state::<Stopped>();
        let mut s = state.0.lock().unwrap();
        let changed = *s != stopped;
        *s = stopped;
        changed
    };
    if changed {
        let _ = app.emit("cockpit-activity", serde_json::json!({ "kind": "stop", "stopped": stopped, "text": by }));
    }
}

#[tauri::command]
fn set_stopped(stopped: bool, app: tauri::AppHandle) {
    set_stop(&app, stopped, if stopped { "frenado desde Cockpit" } else { "reanudado desde Cockpit" });
}

#[tauri::command]
fn set_current(id: String, current: State<'_, Current>) {
    *current.0.lock().unwrap() = id;
}

// ── EL PUERTO DE CONTROL ────────────────────────────────────────────────────────────────────────────────────────
const CONTROL_ADDR: &str = "127.0.0.1:5209";

fn control_path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var("HOME").ok()?).join(".config/creditop-cockpit/control.json"))
}

// Una llave nueva en cada arranque: 32 caracteres hex de /dev/urandom.
fn new_token() -> String {
    use std::io::Read;
    let mut buf = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut buf);
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn write_control(token: &str) {
    let Some(path) = control_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let body = serde_json::json!({ "port": 5209, "token": token }).to_string();
    use std::os::unix::fs::OpenOptionsExt;
    if let Ok(mut f) = OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&path) {
        use std::io::Write;
        let _ = f.write_all(body.as_bytes());
    }
}

fn remove_control() {
    if let Some(path) = control_path() {
        let _ = std::fs::remove_file(path);
    }
}

fn json_response(status: u16, body: serde_json::Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header("content-type: application/json".parse::<tiny_http::Header>().unwrap())
}

// Un texto para el panel: sin saltos raros y con tope, que el panel no es un log entero.
fn clip(s: &str, max: usize) -> String {
    let s: String = s.chars().filter(|c| !c.is_control() || *c == '\n').collect();
    if s.chars().count() <= max { s } else { s.chars().take(max).collect::<String>() + "…" }
}

fn control_server(app: tauri::AppHandle, token: String) {
    let Ok(server) = tiny_http::Server::http(CONTROL_ADDR) else { return };
    for mut req in server.incoming_requests() {
        let authorized = req.headers().iter().any(|h| h.field.equiv("x-cockpit-token") && h.value.as_str() == token);
        if !authorized {
            let _ = req.respond(json_response(401, serde_json::json!({ "error": "falta la llave de Cockpit" })));
            continue;
        }
        let mut body = String::new();
        let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
        let input: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
        let text = |key: &str, max: usize| clip(input.get(key).and_then(|v| v.as_str()).unwrap_or(""), max);
        let reply = match (req.method().as_str(), req.url()) {
            ("GET", "/status") => {
                let running = app.state::<Running>();
                let apps: Vec<_> = APPS
                    .iter()
                    .map(|a| serde_json::json!({ "id": a.id, "name": a.name, "ready": ready(a), "started": running.started(a.id) }))
                    .collect();
                let current = app.state::<Current>().0.lock().unwrap().clone();
                let stopped = *app.state::<Stopped>().0.lock().unwrap();
                json_response(200, serde_json::json!({ "current": current, "apps": apps, "stopped": stopped }))
            }
            ("GET", "/stop") => {
                let stopped = *app.state::<Stopped>().0.lock().unwrap();
                json_response(200, serde_json::json!({ "stopped": stopped }))
            }
            ("POST", "/stop") => {
                let stopped = input.get("stopped").and_then(|v| v.as_bool()).unwrap_or(false);
                let by = text("by", 80);
                set_stop(&app, stopped, if by.is_empty() { if stopped { "frenado" } else { "reanudado" } } else { &by });
                json_response(200, serde_json::json!({ "stopped": stopped }))
            }
            ("POST", "/open") => {
                let id = text("app", 40);
                let route = text("route", 300);
                if APPS.iter().any(|a| a.id == id) {
                    show_main(&app);
                    open_in_shell(&app, &id, &route);
                    let _ = app.emit("cockpit-activity", serde_json::json!({ "kind": "open", "app": id, "text": route, "session": text("session", 40) }));
                    json_response(200, serde_json::json!({ "ok": true }))
                } else {
                    let ids: Vec<_> = APPS.iter().map(|a| a.id).collect();
                    json_response(404, serde_json::json!({ "error": format!("no hay app «{id}»: {}", ids.join(", ")) }))
                }
            }
            ("POST", "/say") => {
                let _ = app.emit("cockpit-activity", serde_json::json!({ "kind": "say", "text": text("text", 600), "session": text("session", 40) }));
                json_response(200, serde_json::json!({ "ok": true }))
            }
            ("POST", "/activity") => {
                let kind = text("kind", 10);
                if !matches!(kind.as_str(), "start" | "end") {
                    json_response(400, serde_json::json!({ "error": "kind: start o end" }))
                } else {
                    // A dónde «seguir a Claude» llevaría (sólo una app conocida, y la ruta con los caracteres de una ruta).
                    let target = text("app", 40);
                    let target = if APPS.iter().any(|a| a.id == target) { target } else { String::new() };
                    let route: String = text("route", 300).chars().filter(|c| c.is_ascii_alphanumeric() || "#/@._%-+:?=&".contains(*c)).collect();
                    let _ = app.emit("cockpit-activity", serde_json::json!({
                        "kind": kind, "id": text("id", 80), "session": text("session", 40), "tool": text("tool", 60),
                        "text": text("text", 300), "ok": input.get("ok").and_then(|v| v.as_bool()),
                        "app": target, "route": route,
                    }));
                    json_response(200, serde_json::json!({ "ok": true }))
                }
            }
            _ => json_response(404, serde_json::json!({ "error": "rutas: GET /status · /stop · POST /open · /say · /activity · /stop" })),
        };
        let _ = req.respond(reply);
    }
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
    let route = url.fragment().map(|h| format!("#{h}")).unwrap_or_default();
    open_in_shell(app, id, &route);
}

// La carcasa a esa app y ruta (`#…` o `/…`). La ruta va filtrada: entra a un `eval`.
fn open_in_shell(app: &tauri::AppHandle, id: &str, route: &str) {
    let route: String = route
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "#/@._%-+:?=&".contains(*c))
        .collect();
    if let Some(w) = app.get_webview_window("main") {
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
        .manage(Current::default())
        .manage(Stopped::default())
        .invoke_handler(tauri::generate_handler![apps, ensure_app, set_current, set_stopped])
        .setup(|app| {
            // El puerto de control, con una llave nueva en cada arranque.
            let token = new_token();
            write_control(&token);
            {
                let handle = app.handle().clone();
                thread::spawn(move || control_server(handle, token));
            }
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
        RunEvent::Exit => {
            remove_control();
            on_exit.stop_all();
        }
        _ => {}
    });
}
