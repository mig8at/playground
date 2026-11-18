import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOT } from './src/workbench.js'

// El tema y la paleta se aplican ANTES de pintar, con el renglón de la base (`THEME_BOOT`), como en el resto.
const themeBoot = {
  name: 'theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
}

// :5240 la interfaz y :5241 la API (Go). El proxy deja la app en un solo origen; Host queda localhost (changeOrigin false), que la API exige.
export default defineConfig({
  plugins: [themeBoot, vue(), tailwindcss()],
  server: {
    port: 5240,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:5241', changeOrigin: false } },
  },
})
