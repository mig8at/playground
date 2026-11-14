// COCKPIT: las herramientas de my-tools en una sola app, con una barra de aplicaciones a la izquierda como la de VS
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
// Todo corre desde la carpeta de my-tools (la que tenía este código al compilar) y con el PATH de tu shell. Los
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
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

enum Start {
    // El servidor del chat, que viene adentro de la app.
    Sidecar,
    // `make <target>` desde la carpeta de my-tools.
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
    AppDef {
        // El vigía de producción (sentinel/): por entidad y comercio, la última hora contra lo normal, y los despliegues.
        id: "sentinel",
        name: "Sentinel",
        url: "http://localhost:5210/",
        ready: &["localhost:5210", "127.0.0.1:5211"],
        start: Start::Make("sentinel"),
    },
    AppDef {
        // Goldfish (goldfish/): las ramas por subir de los repos reales y su validación Elephant-Goldfish antes del PR.
        id: "goldfish",
        name: "Goldfish",
        url: "http://localhost:5216/",
        ready: &["localhost:5216", "127.0.0.1:5217"],
        start: Start::Make("goldfish"),
    },
    AppDef {
        // Correo (correo/): los correos de los remitentes que se siguen en Gmail, con aviso de macOS. Su API también corre
        // de fondo (`make correo-install`): si ya contesta, Cockpit usa ésa.
        id: "correo",
        name: "Correo",
        url: "http://localhost:5224/",
        ready: &["localhost:5224", "127.0.0.1:5225"],
        start: Start::Make("correo"),
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

// Dónde van los registros. En macOS, ~/Library/Logs (lo de siempre). En lo demás esa carpeta no existe, y sin
// registro `spawn` no levantaba NINGUNA app, sin decir nada: ahí van a $XDG_STATE_HOME/cockpit (o
// ~/.local/state/cockpit), que se crea si falta.
fn log_dir() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var("HOME").ok()?);
    if cfg!(target_os = "macos") {
        return Some(home.join("Library/Logs"));
    }
    let state = std::env::var("XDG_STATE_HOME").ok().filter(|v| !v.is_empty()).map(PathBuf::from);
    Some(state.unwrap_or_else(|| home.join(".local/state")).join("cockpit"))
}

fn log_file(name: &str) -> Result<std::fs::File, String> {
    let dir = log_dir().ok_or("no hay HOME: no sé dónde dejar el registro")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("crear {}: {e}", dir.display()))?;
    let path = dir.join(name);
    OpenOptions::new().create(true).append(true).open(&path).map_err(|e| format!("abrir {}: {e}", path.display()))
}

// Un arranque que falla deja constancia en stderr (antes devolvía `None` callado, y la carcasa esperaba 90 s a
// una app que nunca se había lanzado).
fn spawn(app: &AppDef, path: &str) -> Option<Child> {
    match try_spawn(app, path) {
        Ok(child) => Some(child),
        Err(why) => {
            eprintln!("cockpit: no pude levantar {}: {why}", app.id);
            None
        }
    }
}

fn try_spawn(app: &AppDef, path: &str) -> Result<Child, String> {
    let root = std::fs::canonicalize(ROOT).map_err(|e| format!("la raíz de my-tools ({ROOT}): {e}"))?;
    let (mut cmd, log) = match app.start {
        Start::Sidecar => {
            let exe = std::env::current_exe().map_err(|e| format!("mi propio ejecutable: {e}"))?;
            let mut c = Command::new(exe.with_file_name("chat-server"));
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
        .env("MY_TOOLS_ROOT", &root)
        .env("PATH", path)
        .stdout(log.try_clone().map_err(|e| format!("duplicar el registro: {e}"))?)
        .stderr(log)
        // Su propio grupo de procesos: al salir se apaga entero (make → npm → vite y go).
        .process_group(0)
        .spawn()
        .map_err(|e| format!("lanzar el proceso: {e}"))
}

// Los procesos que levantó Cockpit, por app (las que ya estaban corriendo no figuran: no son suyas).
#[derive(Clone)]
struct Running {
    children: Arc<Mutex<HashMap<&'static str, Child>>>,
    path: Arc<String>,
    // LAS APPS QUE SE VIGILAN: las que se abrieron alguna vez (`ensure_app`), con cuántas revisiones seguidas lleva
    // cada una sin contestar. Ver `watchdog`.
    watched: Arc<Mutex<HashMap<&'static str, u32>>>,
    // Desde cuándo el chat no contesta (ver `chat_agent_installed`).
    sidecar_down: Arc<Mutex<Option<Instant>>>,
    // Cuándo se lanzó cada app por última vez y cuántos lanzamientos seguidos lleva sin llegar a contestar. Ver
    // `relaunch_wait`.
    launches: Arc<Mutex<HashMap<&'static str, (Instant, u32)>>>,
}

/* LA ESPERA ANTES DE RELANZAR: si el `make <app>` muere enseguida (un puerto tomado, un error de compilación, falta
   una dependencia), `ensure` lo relanzaba en CADA sondeo, y la carcasa sondea cada 700 ms durante 90 s: más de cien
   `make` seguidos. Ahora, entre un lanzamiento y el siguiente de una app que todavía no contestó, se espera 5 s, y el
   doble cada vez (10, 20, 40) hasta 60 s. La cuenta vuelve a cero cuando la app contesta, y un reinicio pedido
   (`restart`) no espera. */
fn relaunch_wait(failed: u32) -> Duration {
    Duration::from_secs((5u64 << failed.saturating_sub(1).min(4)).min(60))
}

/* EL CHAT DE FONDO (`make chat-install`): si su LaunchAgent está instalado, el servidor del chat lo cuida launchd y
   sigue aunque Cockpit se cierre. Cockpit entonces NO levanta el suyo al arrancar (si lo hiciera, ganaría el puerto y
   el de fondo quedaría esperando); sólo lo levanta de respaldo si el chat no contesta durante SIDECAR_GRACE. */
const SIDECAR_GRACE: Duration = Duration::from_secs(30);

fn chat_agent_installed() -> bool {
    std::env::var("HOME")
        .map(|h| PathBuf::from(h).join("Library/LaunchAgents/com.creditop.playground.chat.plist").exists())
        .unwrap_or(false)
}

impl Running {
    // ¿Está lista? Si no y no hay nada arrancando, la arranca. La carcasa pregunta hasta que diga que sí.
    fn ensure(&self, app: &AppDef) -> bool {
        if ready(app) {
            if matches!(app.start, Start::Sidecar) {
                *self.sidecar_down.lock().unwrap() = None;
            }
            self.launches.lock().unwrap().remove(app.id);
            return true;
        }
        if matches!(app.start, Start::Sidecar) && chat_agent_installed() {
            let mut since = self.sidecar_down.lock().unwrap();
            let first = *since.get_or_insert_with(Instant::now);
            if first.elapsed() < SIDECAR_GRACE {
                return false; // lo levanta launchd: se le da tiempo
            }
        }
        let mut children = self.children.lock().unwrap();
        let alive = matches!(children.get_mut(app.id).map(|c| c.try_wait()), Some(Ok(None)));
        if !alive {
            // Murió (o nunca arrancó) sin llegar a contestar: no se relanza antes de su espera (`relaunch_wait`).
            let mut launches = self.launches.lock().unwrap();
            let failed = match launches.get(app.id) {
                Some((at, n)) if at.elapsed() < relaunch_wait(*n) => return false,
                Some((_, n)) => *n,
                None => 0,
            };
            // Cuenta también el lanzamiento que falla antes de existir (sin registro, sin ejecutable): si no,
            // se reintentaría en cada sondeo igual.
            launches.insert(app.id, (Instant::now(), failed + 1));
            if let Some(child) = spawn(app, &self.path) {
                children.insert(app.id, child);
            }
        }
        false
    }
    // Olvida los intentos fallidos de una app: el próximo `ensure` la lanza sin esperar.
    fn forget_launches(&self, id: &str) {
        self.launches.lock().unwrap().remove(id);
    }
    fn started(&self, id: &str) -> bool {
        self.children.lock().unwrap().contains_key(id)
    }
    // ¿Está vivo el proceso que levantó Cockpit para esta app? (Si no lo levantó Cockpit, no.)
    fn alive(&self, id: &str) -> bool {
        matches!(self.children.lock().unwrap().get_mut(id).map(|c| c.try_wait()), Some(Ok(None)))
    }
    fn watch(&self, id: &'static str) {
        self.watched.lock().unwrap().entry(id).or_insert(0);
    }
    // Apaga lo que levantó Cockpit para esta app (todo su grupo). `false`: no era suya.
    fn kill(&self, id: &str) -> bool {
        let Some(mut child) = self.children.lock().unwrap().remove(id) else { return false };
        let _ = Command::new("/bin/kill").args(["-TERM", &format!("-{}", child.id())]).status();
        let _ = child.wait();
        true
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
    let Some(app) = APPS.iter().find(|a| a.id == id) else { return false };
    running.watch(app.id);
    running.ensure(app)
}

/* EL VIGILANTE: cada 5 s revisa las apps que se abrieron. Si una deja de contestar, la carcasa la tapa con un aviso
   (`cockpit-app` down) y, tras DOWN_CHECKS revisiones seguidas, Cockpit la vuelve a levantar con su `make`; cuando
   contesta de nuevo, la carcasa la recarga (`cockpit-app` up).

   Por qué hace falta: la carcasa levantaba cada app UNA vez, al abrirla. Si después se caía (o se la mataba para tomar
   un cambio en su servidor Go), quedaba muerta hasta reabrir Cockpit (pasó el 2026-11-11 con el tablero).

   Por qué espera varias revisiones: un servidor que se reinicia solo (Vite al cambiar su config) deja el puerto un
   par de segundos sin contestar, y relanzar ahí uno que no es de Cockpit levantaría un segundo `make` que choca por
   el puerto. Si el proceso de Cockpit sigue vivo (está arrancando), `ensure` no lanza otro. */
const DOWN_CHECKS: u32 = 3;

fn watchdog(app: tauri::AppHandle, running: Running) {
    loop {
        thread::sleep(Duration::from_secs(5));
        let ids: Vec<&'static str> = running.watched.lock().unwrap().keys().copied().collect();
        for id in ids {
            let Some(def) = APPS.iter().find(|a| a.id == id) else { continue };
            // El chat tiene su propio cuidado (abajo, en `main`): acá sólo se avisa a la carcasa.
            let up = ready(def);
            let downs = {
                let mut watched = running.watched.lock().unwrap();
                let n = watched.entry(id).or_insert(0);
                let before = *n;
                *n = if up { 0 } else { before + 1 };
                (before, *n)
            };
            match downs {
                (before, 0) if before > 0 => {
                    let _ = app.emit("cockpit-app", serde_json::json!({ "id": id, "state": "up" }));
                }
                (0, 1) => {
                    let _ = app.emit("cockpit-app", serde_json::json!({ "id": id, "state": "down" }));
                }
                (_, n) if n >= DOWN_CHECKS && !matches!(def.start, Start::Sidecar) && !running.alive(id) => {
                    let _ = app.emit("cockpit-app", serde_json::json!({ "id": id, "state": "restarting" }));
                    running.ensure(def);
                }
                _ => {}
            }
        }
    }
}

/* REINICIAR UNA APP (`bin/cockpit restart <app>`): para que tome un cambio en su servidor (Go no se recarga solo).
   Si la levantó Cockpit, apaga su grupo de procesos. Si la levantó otro, sólo la apaga cuando el líder de su grupo es
   el `make <target>` de esa app (una sesión que corrió `make tablero`): el grupo de procesos que escucha en su puerto,
   nunca un patrón ni «lo que esté en el puerto». Después la vuelve a levantar Cockpit. */
fn restart(app: &tauri::AppHandle, def: &'static AppDef) -> Result<String, String> {
    let running = app.state::<Running>();
    running.watch(def.id);
    let mut how = "estaba apagada";
    if matches!(def.start, Start::Sidecar) {
        return Err("el chat lo cuida Cockpit solo: si se cae, lo vuelve a levantar".into());
    }
    if running.kill(def.id) {
        how = "la había levantado Cockpit";
    } else if ready(def) {
        let Start::Make(target) = def.start else { unreachable!() };
        let group = owner_group(def).ok_or_else(|| format!("no encontré quién escucha en {}", def.ready.join(" · ")))?;
        let leader = Command::new("/bin/ps")
            .args(["-o", "command=", "-p", &group.to_string()])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        if !runs_make(&leader, target) {
            return Err(format!(
                "{} la levantó otro proceso (grupo {group}, no es `make {target}`): apagala vos y Cockpit la vuelve a levantar",
                def.name
            ));
        }
        let _ = Command::new("/bin/kill").args(["-TERM", &format!("-{group}")]).status();
        how = "la había levantado una terminal";
    }
    let _ = app.emit("cockpit-app", serde_json::json!({ "id": def.id, "state": "restarting" }));
    // Se espera a que suelte el puerto, para no ver «ya contesta» con el servidor viejo.
    for _ in 0..50 {
        if !def.ready.iter().any(|hp| answers(hp)) {
            break;
        }
        thread::sleep(Duration::from_millis(200));
    }
    running.watched.lock().unwrap().insert(def.id, 1);
    running.forget_launches(def.id); // lo pidió alguien: no espera
    running.ensure(def);
    Ok(format!("{}: {how}; arrancando de nuevo", def.name))
}

// El grupo de procesos de quien escucha en el primer puerto de la app (sólo LISTEN: un cliente conectado no cuenta).
fn owner_group(def: &AppDef) -> Option<i32> {
    let port = def.ready.first()?.rsplit(':').next()?;
    let out = Command::new("/usr/sbin/lsof").args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"]).output().ok()?;
    let pid = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_string();
    let out = Command::new("/bin/ps").args(["-o", "pgid=", "-p", &pid]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

// ¿El comando del líder corre `make <target>`? `make tablero` sí; `make tablero-db` o `make tableros` no.
fn runs_make(command: &str, target: &str) -> bool {
    let needle = format!("make {target}");
    command.match_indices(&needle).any(|(i, _)| {
        let before = command[..i].chars().last();
        let after = command[i + needle.len()..].chars().next();
        !matches!(before, Some(c) if c.is_alphanumeric() || c == '-' || c == '_')
            && !matches!(after, Some(c) if c.is_alphanumeric() || c == '-' || c == '_')
    })
}

// Para la configuración (el modal del engranaje): qué apps están arriba, y reiniciar una (lo mismo que
// `bin/cockpit restart`, con sus mismas guardas).
#[derive(Serialize)]
struct AppState {
    id: &'static str,
    ready: bool,
    started: bool,
    ports: &'static [&'static str],
}

// Asíncronos y con el trabajo en otro hilo: un comando síncrono corre en el de la ventana, y reiniciar espera hasta
// 10 s a que la app suelte el puerto (Cockpit quedaría congelado).
#[tauri::command]
async fn apps_state(app: tauri::AppHandle) -> Vec<AppState> {
    tauri::async_runtime::spawn_blocking(move || {
        let running = app.state::<Running>();
        APPS.iter()
            .map(|a| AppState { id: a.id, ready: ready(a), started: running.started(a.id), ports: a.ready })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
async fn restart_app(id: String, app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let def = APPS.iter().find(|a| a.id == id).ok_or_else(|| format!("no hay app «{id}»"))?;
        restart(&app, def)
    })
    .await
    .map_err(|e| e.to_string())?
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
            ("POST", "/restart") => {
                let id = text("app", 40);
                match APPS.iter().find(|a| a.id == id) {
                    None => {
                        let ids: Vec<_> = APPS.iter().map(|a| a.id).collect();
                        json_response(404, serde_json::json!({ "error": format!("no hay app «{id}»: {}", ids.join(", ")) }))
                    }
                    Some(def) => match restart(&app, def) {
                        Ok(text) => {
                            let _ = app.emit("cockpit-activity", serde_json::json!({ "kind": "say", "text": format!("↻ {text}"), "session": "" }));
                            json_response(200, serde_json::json!({ "ok": true, "text": text }))
                        }
                        Err(e) => json_response(409, serde_json::json!({ "error": e })),
                    },
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
            _ => json_response(404, serde_json::json!({ "error": "rutas: GET /status · /stop · POST /open · /restart · /say · /activity · /stop" })),
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
    let running = Running { children: Arc::default(), path: Arc::new(user_path()), watched: Arc::default(), sidecar_down: Arc::default(), launches: Arc::default() };
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
    let watching = running.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(running)
        .manage(Current::default())
        .manage(Stopped::default())
        .invoke_handler(tauri::generate_handler![apps, ensure_app, set_current, set_stopped, apps_state, restart_app])
        .setup(|app| {
            // El puerto de control, con una llave nueva en cada arranque.
            let token = new_token();
            write_control(&token);
            {
                let handle = app.handle().clone();
                thread::spawn(move || control_server(handle, token));
            }
            {
                let handle = app.handle().clone();
                thread::spawn(move || watchdog(handle, watching));
            }
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Cockpit")
                .inner_size(1320.0, 840.0)
                .min_inner_size(420.0, 480.0)
                // El micrófono, para dictar en el chat (Whisper corre en esta máquina): sí. La cámara y lo demás: no.
                // macOS además pregunta una vez por el micrófono (NSMicrophoneUsageDescription, src-tauri/Info.plist).
                .on_permission_request(|_, kind| match kind {
                    tauri::webview::PermissionKind::Microphone => tauri::webview::PermissionResponse::Allow,
                    _ => tauri::webview::PermissionResponse::Deny,
                })
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

#[cfg(test)]
mod tests {
    use super::runs_make;

    #[test]
    fn runs_make_only_matches_the_exact_target() {
        assert!(runs_make("/usr/bin/make tablero", "tablero"));
        assert!(runs_make("/bin/zsh -c eval 'make tablero' < /dev/null", "tablero"));
        assert!(!runs_make("/usr/bin/make tablero-db SQL=x", "tablero"));
        assert!(!runs_make("/usr/bin/make tableros", "tablero"));
        assert!(!runs_make("node vite", "tablero"));
    }
}
