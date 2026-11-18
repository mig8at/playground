import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOT } from './src/workbench.js'

// El tema y la paleta se aplican ANTES de pintar, con el renglón de la base (`THEME_BOOT`), como en el resto.
const themeBoot = {
  name: 'theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
}

// :5228 la interfaz y :5229 la API (Go). El proxy deja la app en un solo origen.
export default defineConfig({
  plugins: [themeBoot, vue(), tailwindcss()],
  server: {
    port: 5228,
    strictPort: true,
    // Lo que NO es la interfaz no la recarga: Tailwind mira toda la carpeta buscando clases, y cada archivo que un
    // agente escribía en sandbox/ (o un cambio en el servidor, una guía, lo guardado) recargaba la página entera: se
    // cerraba la vista previa y se cortaba el modo Auto que corre la interfaz (2026-11-17).
    watch: { ignored: ['**/sandbox/**', '**/server/**', '**/.data/**', '**/agents/**', '**/dist/**', '**/*.md', '**/*.json', '**/*.mjs', '**/cli.ts'] },
    proxy: { '/api': { target: 'http://127.0.0.1:5229', changeOrigin: false }, '/sandbox': { target: 'http://127.0.0.1:5229', changeOrigin: false } },
  },
})
