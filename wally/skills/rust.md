# rust: escribir una API o un programa en Rust en la carpeta de pruebas, compilarlo, testearlo y probarlo

Se escribe como cualquier archivo de `pruebas/` (bloques `archivo` y `parche`: si no la tenés, pedí también
`ayuda pruebas`). Lo que cambia es que acá el código SE EJECUTA, dentro de un contenedor aislado.

## El proyecto

- `pruebas/<proyecto>/Cargo.toml`, `pruebas/<proyecto>/src/main.rs` (y los módulos que hagan falta en `src/`).
- **No hay red**: sólo existen estas bibliotecas, con estas líneas EXACTAS (otra versión u otra biblioteca no compila):

```archivo pruebas/mi-api/Cargo.toml
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
- **axum 0.8**: los parámetros de ruta van con llaves (`/tareas/{id}`, no `/tareas/:id`); se sirve con
  `axum::serve(listener, app)`.
- La API escucha en **`127.0.0.1`** y en el puerto de la variable **`PORT`** (8080 si no está). Tiene que contestar algo
  en `GET /` (aunque sea un 404): así se sabe que levantó.

## Los comandos (corren en el contenedor: sin red, viendo sólo tu proyecto)

| comando | para qué |
|---|---|
| `compilar pruebas/proyecto` | `cargo build`: los errores y avisos del compilador, con archivo y línea |
| `testear pruebas/proyecto` | `cargo test`: los tests que escribas (`#[cfg(test)]`, o en `tests/`) |
| `probar-api pruebas/proyecto` | compila, levanta la API y le hace EN ORDEN los pedidos de `criterios.json`, contra el mismo proceso |

```comando
compilar pruebas/mi-api
probar-api pruebas/mi-api
```

La primera compilación de un proyecto tarda más; las siguientes, segundos. Leé el error del compilador entero: dice el
archivo, la línea y casi siempre el arreglo. Corregí con un `parche`, no reescribas todo.

## Los criterios de una API (obligatorio): `pruebas/<proyecto>/criterios.json`

UN criterio por cada cosa pedida. Se corren en orden y la API no se reinicia entre uno y otro: lo que crea un criterio
lo ve el siguiente.

```archivo pruebas/mi-api/criterios.json
[
  { "criterio": "La lista arranca vacía",
    "pedido": { "metodo": "GET", "ruta": "/tareas" },
    "espera": { "estado": 200, "contiene": ["[]"] } },
  { "criterio": "Crear una tarea devuelve 201 con su título",
    "pedido": { "metodo": "POST", "ruta": "/tareas", "cuerpo": { "titulo": "comprar pan" } },
    "espera": { "estado": 201, "contiene": ["comprar pan"] } },
  { "criterio": "Sin título devuelve 400",
    "pedido": { "metodo": "POST", "ruta": "/tareas", "cuerpo": { "titulo": "" } },
    "espera": { "estado": 400, "no_contiene": ["comprar pan"] } }
]
```

- `pedido`: `metodo`, `ruta` y, si hace falta, `cuerpo` (JSON). `espera`: `estado`, y/o `contiene` y `no_contiene`
  (textos que tienen que estar, o no, en la respuesta). El JSON sale sin espacios: buscá `"id":1`, no `"id": 1`.
- Escribilos por lo que te PIDIERON. Si uno falla, lo normal es arreglar el código.
- No podés cerrar si escribiste después del último `probar-api` o si el último dejó algo en rojo. `compilar` solo no
  alcanza: que compile no es que funcione.
