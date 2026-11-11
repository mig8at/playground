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
    // JARVIS_WEB / JARVIS_API dejan levantar una segunda copia (para probar sin cortar una corrida en curso).
    port: Number(process.env.JARVIS_WEB || 5202),
    strictPort: true,
    // ⚠ Los flujos, mapas y corridas NO se vigilan: un archivo que cambia ahí y no es código hacía que Vite (vía
    // Tailwind) RECARGARA LA INTERFAZ entera, por ejemplo al guardarse un flujo mientras Claude trabaja (2026-11-11).
    // Lo que cambia ahí lo trae el tiempo real de la API (`/api/events`).
    watch: { ignored: ['**/flows/**', '**/maps/**', '**/.data/**', '**/extension/**'] },
    proxy: { '/api': { target: process.env.JARVIS_API || 'http://127.0.0.1:5203', changeOrigin: false } },
  },
})
