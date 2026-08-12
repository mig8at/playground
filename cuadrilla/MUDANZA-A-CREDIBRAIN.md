# Mudar cuadrilla a credibrain

Plan escrito el 12 ago 2026. **No se tocó nada del repo de credibrain** — es un repo real y eso pide
permiso explícito. Acá está el paso a paso para ejecutarlo cuando se decida.

## La forma: app aparte, no un tab

`credibrain/apps/web` es **React 18 + Vite + TS y no tiene router**: la navegación son cuatro tabs con
`useState<Tab>` (`apps/web/src/App.tsx:933`). Cuadrilla es **Vue 3 + vue-router** en modo history.

Por eso cuadrilla entra como **tercer workspace del monorepo**, con su propio build, servida en
`/cuadrilla`, y en el header de credibrain va **un enlace**, no un tab. Es carga de página completa.

**No montar Vue dentro de React.** Tres razones concretas:

1. Dos frameworks en el mismo bundle.
2. **Colisión de CSS**: cuadrilla define tokens en `:root` y estilos sobre `body`, y las dos apps usan
   `.badge`, `.card` y `.grid` con significados distintos.
3. Los tabs de credibrain son `useState`, sin URL. Cuadrilla tiene `/epica/:id` a propósito, para
   poder pegar el link en Slack. Adentro de un tab eso se pierde.

## La frontera con Work Logs

Decisión tomada: **cada una con lo suyo**. Credibrain ya tiene el tab *Work Logs*
(`feature, status, summary, blockers, author, updatedAt`) y las tools `log_work` / `find_work` /
`update_work`; cuadrilla tiene documentación por persona dentro de la épica. Conviven, pero la
frontera hay que escribirla o en seis meses no se escribe en ninguno de los dos:

| | credibrain · Work Logs | cuadrilla · documentación |
|---|---|---|
| Unidad | **feature** | **épica** |
| Alcance | en qué ando y qué me traba, en general | el traspaso técnico de *esta* épica |
| Vida útil | queda en el cerebro, se consulta meses después | muere cuando la épica gradúa |
| Lo consume | RAG / `ask_sofia` | el que agarra la épica mañana |

**Regla práctica:** si sirve fuera de la épica o dentro de seis meses, va al worklog de credibrain.
Si solo tiene sentido junto a estas ramas, va en cuadrilla.

⚠ Si con el uso resulta que la gente escribe en uno solo, ganó ese: hay que quitar el otro campo, no
dejar los dos a medio llenar.

## Paso a paso

### 1 · Copiar la app

```bash
rsync -a --exclude node_modules --exclude dist --exclude bocetos \
  ~/Desktop/CREDITOP/playground/cuadrilla/ \
  ~/Desktop/CREDITOP/github/credibrain/apps/cuadrilla/
```

`bocetos/` se queda en playground: son los HTML sueltos con los que se diseñó la pantalla, no son
parte de la app. Este mismo `.md` tampoco viaja.

### 2 · `apps/cuadrilla/package.json`

```json
"name": "@credibrain/cuadrilla"
```

### 3 · `credibrain/package.json` (raíz)

Agregar el workspace y los scripts, siguiendo el patrón de `brain` y `web`:

```json
"workspaces": ["apps/brain", "apps/web", "apps/cuadrilla"],
"scripts": {
  "cuadrilla:dev":   "npm run dev -w @credibrain/cuadrilla",
  "cuadrilla:build": "npm run build -w @credibrain/cuadrilla",
  "build": "npm run brain:build && npm run web:build && npm run cuadrilla:build"
}
```

### 4 · `apps/cuadrilla/vite.config.js`

```js
export default defineConfig({
  plugins: [vue()],
  base: '/cuadrilla/',                        // el navegador la pide detrás de ese prefijo
  server: { port: 5197, strictPort: true, host: true },
})
```

### 5 · `apps/cuadrilla/src/main.js`

```js
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),   // sigue a `base`, no lo repite
  ...
})
```

`import.meta.env.BASE_URL` y no `'/cuadrilla'` a mano: así el día que cambie el prefijo se toca un
solo lugar, y en dev (`base` = `/`) sigue andando igual.

### 6 · `apps/cuadrilla/Dockerfile`

Copiar el de `apps/web` **quitando los `ARG VITE_*`** (cuadrilla no lee env) y su `nginx.conf` tal
cual — el `try_files $uri $uri/ /index.html` es justo lo que necesita el modo history.

### 7 · `docker-compose.prod.yml`

```yaml
  cuadrilla:
    build:
      context: ./apps/cuadrilla
    container_name: credibrain-cuadrilla
    restart: unless-stopped
    expose:
      - '80'
```

### 8 · `Caddyfile`

**Antes** del `handle` catch-all que manda todo a `web`:

```
	redir /cuadrilla /cuadrilla/
	handle_path /cuadrilla/* {
		reverse_proxy cuadrilla:80
	}
```

`handle_path` (no `handle`) porque **estripea el prefijo**, igual que ya hace `/api/*` con el brain:
nginx recibe `/epica/x` y sirve desde su raíz, sin que haya que anidar el `dist` en una subcarpeta.
El `redir` es para que `/cuadrilla` sin barra final no caiga en el catch-all.

⚠ El orden importa: en Caddy, dentro de un mismo bloque los `handle` se evalúan en orden y el
catch-all se come todo lo que quede.

### 9 · El link en el header

`apps/web/src/App.tsx`, dentro de `.user-cluster` (línea ~945), antes del botón «Token MCP»:

```tsx
<a className="btn" href="/cuadrilla/">Cuadrilla</a>
```

Un `<a>` y no un `<button onClick>`: es otra app, y así funciona el clic con la rueda, el
«abrir en pestaña nueva» y el copiar-enlace.

## Cómo verificar que quedó bien

```bash
cd ~/Desktop/CREDITOP/github/credibrain && npm install && npm run cuadrilla:build
```

Y con el compose arriba, revisar los cuatro casos que suelen romperse con un subpath:

| Qué probar | Qué tiene que pasar |
|---|---|
| `/cuadrilla` | redirige a `/cuadrilla/` y carga |
| `/cuadrilla/epica/pais-como-dato` | carga **recargando la página**, no solo navegando |
| Assets | `/cuadrilla/assets/*.js` responde 200, no el `index.html` de credibrain |
| `/` | credibrain sigue igual, con su link nuevo en el header |

El segundo es el que falla si `base` y el `history` no coinciden: navegando por dentro anda, y al
recargar tira 404.

## Dos frenos antes de publicarla

1. **Auth.** Credibrain está detrás de Google (`VITE_GOOGLE_CLIENT_ID`, `useAuth`, roles por email).
   Cuadrilla no tiene ninguna: servida en el mismo dominio queda **pública**. Con datos de mentira da
   igual; el día que muestre las ramas y los PRs reales del equipo, no. Hay que gatearla en Caddy o
   hacer que use el mismo auth.
2. **Sigue siendo un prototipo con datos inventados.** Hoy los repos, personas y ramas salen de
   `git for-each-ref origin` pero los PRs, estados y días están puestos a mano. Al lado de
   herramientas que sí son reales, alguien la va a leer como estado del equipo. O se mantiene el
   descargo bien visible, o se conecta a la API de GitHub antes de mudarla.

Mi orden sugerido: **primero los datos reales, después la mudanza.** Mudarla ahora cuesta lo mismo
que mudarla después, y en el medio hay que mantener dos copias sincronizadas.
