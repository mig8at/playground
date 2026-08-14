import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// :5197 — el único libre de la familia 519x. Ojo con lo que dice el Makefile: durante un tiempo
// anunció `engine (:5197)`, pero engine corre en :5196 (engine/vite.config.js, con strictPort).
// Ocupados de verdad: 5183 domain-model · 5190 flow · 5191 tablero · 5192 trazador(vue) ·
// 5193 context · 5194 dict · 5195 panel · 5196 engine · 5198 plantillas · 5199 trazador(go) ·
// 5174 wizard. El server de sesión va en :8091 (8090 es plantillas).
//
// PORT por env, misma convención que flow y engine: permite una 2ª instancia sin pisar la primera.
//
// El PROXY es lo que hace que el login funcione: el navegador ve UN SOLO origen (:5197), así la
// cookie de sesión se manda sola y no hay CORS de por medio. Es también lo que permite que el
// callback de la OAuth App sea `http://localhost:5197/api/volver` y no la URL del server.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: Number(process.env.PORT) || 5197,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PUERTO || 8091}`,
        changeOrigin: false,
        /* `timeout: 0` es OBLIGATORIO por el stream SSE del juego: esa conexión se queda abierta
           minutos, y cualquier timeout del proxy la corta. El síntoma engaña —el chat se congela
           sin error ni en consola ni en el log del server—. Mismo caso que en `plantillas`. */
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
