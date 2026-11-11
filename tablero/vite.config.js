import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOT } from './src/workbench.js'

// El tema se aplica ANTES de pintar: el renglón sale de `THEME_BOOT` de la base (workbench.js), así
// hay una sola fuente y no una copia en el HTML que se desvíe.
const themeBoot = {
  name: 'theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
}

// Puerto 5191 para no chocar con flow (:5190).
export default defineConfig({
  plugins: [themeBoot, vue(), tailwindcss()],
  // ⚠ Las tareas y los datos NO se vigilan: un archivo que cambia ahí y no es código hacía que Vite (vía Tailwind)
  // RECARGARA LA PÁGINA entera, y cada bloque que una sesión agregaba a una pila recargaba el tablero (medido el
  // 2026-11-11). Lo que cambia ahí lo trae el tiempo real del server (`/api/events`), sin recargar.
  // `/artifacts` va al server por el MISMO origen: el visor los abre en un iframe, y un iframe de otro puerto lo
  // bloquea el navegador embebido.
  server: { port: 5191, watch: { ignored: ['**/tasks/**', '**/data/**'] },
    proxy: { '/artifacts': process.env.VITE_TABLERO_API || 'http://localhost:8787' } },
})
