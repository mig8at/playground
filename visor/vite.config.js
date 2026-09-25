import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOT } from './src/workbench.js'

// El tema se aplica ANTES de pintar: el renglón sale de `THEME_BOOT` de la base (workbench.js), así
// hay una sola fuente y no una copia en el HTML que se desvíe. Es el mismo plugin que el del tablero.
const themeBoot = {
  name: 'theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
}

// :5193 era el puerto de la viz de `context`, que se apagó el 2026-09-21; la API va en :5194, que
// quedó libre cuando `diccionario` salió del repo. El proxy deja la app en un solo origen, igual que
// el trazador. `PORT` y `VISOR_API_PORT` los mueven para levantar un segundo visor al lado de otro
// (otra sesión con el suyo en 5193/5194); `dev:server` lee la misma variable.
const apiPort = Number(process.env.VISOR_API_PORT) || 5194

export default defineConfig({
  plugins: [themeBoot, vue(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5193,
    proxy: {
      // Generoso: el primer mapa de una sección grande baja el árbol entero (4,8 MB en flujo-ecommerce).
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false, timeout: 180000 },
    },
  },
})
