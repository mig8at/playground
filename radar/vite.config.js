import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOT } from './src/workbench.js'

// El tema se aplica ANTES de pintar, con el renglón de la base (`THEME_BOOT`), como en el resto.
const themeBoot = {
  name: 'theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
}

// :5188 la interfaz y :5189 la API (Go). (5196 es del panel alternativo del harness y 5187 de la API del visor). El proxy deja la app en un solo origen.
export default defineConfig({
  plugins: [themeBoot, vue(), tailwindcss()],
  server: {
    port: 5188,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:5189', changeOrigin: false } },
  },
})
