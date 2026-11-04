import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { THEME_BOOT } from './src/workbench.js'

// El tema se aplica ANTES de pintar, con el renglón de la base (`THEME_BOOT`), como en el resto.
const themeBoot = {
  name: 'theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT, injectTo: 'head-prepend' }],
}

// :5186 la interfaz y :5187 la API (Go). El proxy deja la app en un solo origen.
export default defineConfig({
  plugins: [themeBoot, vue(), tailwindcss()],
  // Dos páginas: la consola de siempre y la tienda Shopify demo (shopify-demo.html).
  build: { rollupOptions: { input: { main: 'index.html', shopify: 'shopify-demo.html' } } },
  server: {
    port: 5186,
    strictPort: true,
    // ECOMMERCE_API deja levantar una segunda copia sin pisar la que ya corre.
    proxy: { '/api': { target: process.env.ECOMMERCE_API || 'http://127.0.0.1:5187', changeOrigin: false } },
  },
})
