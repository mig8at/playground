import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOT } from './src/workbench.js'

// El tema se aplica ANTES de pintar, con el renglón de la base (`THEME_BOOT`), como en el resto.
const themeBoot = {
  name: 'theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
}

// :5202 la interfaz y :5203 la API (Go). El proxy deja la app en un solo origen.
export default defineConfig({
  plugins: [themeBoot, vue(), tailwindcss()],
  server: {
    // NAVEGADOR_WEB / NAVEGADOR_API dejan levantar una segunda copia (para probar sin cortar una corrida en curso).
    port: Number(process.env.NAVEGADOR_WEB || 5202),
    strictPort: true,
    proxy: { '/api': { target: process.env.NAVEGADOR_API || 'http://127.0.0.1:5203', changeOrigin: false } },
  },
})
