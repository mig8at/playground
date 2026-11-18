# rust: escribir una API o un programa en Rust en la carpeta de pruebas, compilarlo, testearlo y probarlo

Se escribe como cualquier archivo de `sandbox/` (bloques `file` y `patch`: si no la tenés, pedí también
`help sandbox`). Lo que cambia es que acá el código SE EJECUTA, dentro de un contenedor aislado.

## El proyecto

- `sandbox/<proyecto>/Cargo.toml`, `sandbox/<proyecto>/src/main.rs` (y los módulos que hagan falta en `src/`).
- **No hay red**: sólo existen estas bibliotecas, con estas líneas EXACTAS (otra versión u otra biblioteca no compila):

```file sandbox/mi-api/Cargo.toml
[package]
name = "mi-api"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.8.9"
serde = { version = "1.0.229", features = ["derive"] }
serde_json = "1.0.154"
tokio = { version = "1.54.1", features = ["full"] }

[dev-dependencies]
http-body-util = "0.1.5"
tower = { version = "0.5.3", features = ["util"] }
```

- Lo demás, con la biblioteca estándar: nada de `uuid`, `chrono`, `sqlx`, `reqwest`, `tracing`. Los datos van en
  memoria (`Arc<Mutex<…>>` en el estado de axum); un id es un contador.
- **axum 0.8**: los parámetros de ruta van con llaves (`/tasks/{id}`, no `/tasks/:id`); se sirve con
  `axum::serve(listener, app)`.
- La API escucha en **`127.0.0.1`** y en el puerto de la variable **`PORT`** (8080 si no está). Tiene que contestar algo
  en `GET /` (aunque sea un 404): así se sabe que levantó.

## Los comandos (corren en el contenedor: sin red, viendo sólo tu proyecto)

| comando | para qué |
|---|---|
| `build sandbox/proyecto` | `cargo build`: los errores y avisos del compilador, con archivo y línea |
| `test sandbox/proyecto` | `cargo test`: los tests que escribas (`#[cfg(test)]`, o en `tests/`) |
| `check-api sandbox/proyecto` | compila, levanta la API y le hace EN ORDEN los pedidos de `criteria.json`, contra el mismo proceso |

```command
build sandbox/mi-api
check-api sandbox/mi-api
```

La primera compilación de un proyecto tarda más; las siguientes, segundos. Leé el error del compilador entero: dice el
archivo, la línea y casi siempre el arreglo. Corregí con un `parche`, no reescribas todo.

## La consola: explorar y depurar a mano

`console sandbox/proyecto <comando>` corre CUALQUIER comando de terminal dentro del contenedor del proyecto (parado
en su carpeta): `cargo`, `curl`, `jq`, `grep`, `sed`, `ls`, `cat`, `find`… Sin red, y sólo ve tu proyecto.

```command
console sandbox/mi-api ls -la src
console sandbox/mi-api grep -n "fn " src/main.rs
console sandbox/mi-api cargo test crea_una_tarea -- --nocapture
console sandbox/mi-api with-api curl -s -i localhost:8080/tasks
console sandbox/mi-api with-api bash -c 'curl -s -X POST localhost:8080/tasks -H "content-type: application/json" -d "{\"title\":\"a\"}"; echo; curl -s localhost:8080/tasks'
```

- **Cada comando arranca de cero**: la API no queda corriendo entre uno y otro. Para pedirle algo, anteponé
  **`with-api`**: compila, la levanta en `localhost:8080`, corre tu comando y la apaga (y muestra lo que la API
  escribió por consola). Varios pedidos seguidos contra el mismo proceso: `with-api bash -c '…; …'`.
- Un comando por línea, hasta 2.000 caracteres, hasta 5 minutos. Llega la cola de la salida (200 renglones).
- Sirve para MIRAR y depurar: qué contesta de verdad una ruta, por qué falla un test, qué hay en un archivo. Para
  cambiar código seguí usando `patch` (queda el diff a la vista); si un comando cambia archivos del proyecto, cuenta
  como una escritura y hay que volver a probar.
- No reemplaza a los criterios: cerrás con `check-api` en verde.

## Los criterios de una API (obligatorio): `sandbox/<proyecto>/criteria.json`

UN criterio por cada cosa pedida. Se corren en orden y la API no se reinicia entre uno y otro: lo que crea un criterio
lo ve el siguiente.

```file sandbox/mi-api/criteria.json
[
  { "name": "La lista arranca vacía",
    "request": { "method": "GET", "path": "/tasks" },
    "expect": { "status": 200, "contains": ["[]"] } },
  { "name": "Crear una tarea devuelve 201 con su título",
    "request": { "method": "POST", "path": "/tasks", "body": { "title": "comprar pan" } },
    "expect": { "status": 201, "contains": ["comprar pan"] } },
  { "name": "Sin título devuelve 400",
    "request": { "method": "POST", "path": "/tasks", "body": { "title": "" } },
    "expect": { "status": 400, "not_contains": ["comprar pan"] } }
]
```

- Se corren TODOS los criterios (hasta 200): no hace falta sacar uno para que entre otro.
- `request`: `method`, `path` y, si hace falta, `body` (JSON). `expect`: `status`, y/o `contains` y `not_contains`
  (textos que tienen que estar, o no, en la respuesta). El JSON sale sin espacios: buscá `"id":1`, no `"id": 1`.
- Escribilos por lo que te PIDIERON. Si uno falla, lo normal es arreglar el código.
- No podés cerrar si escribiste después del último `check-api` o si el último dejó algo en rojo. `build` solo no
  alcanza: que compile no es que funcione.
