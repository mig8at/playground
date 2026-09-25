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
  server: { port: 5191 },
})
