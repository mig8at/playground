import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// :5193 era el puerto de la viz de `context`, que se apagó el 2026-09-21; la API va en :5194, que
// quedó libre cuando `diccionario` salió del repo. El proxy deja la app en un solo origen, igual que
// el trazador.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5193,
    proxy: {
      // Generoso: el primer mapa de una sección grande baja el árbol entero (4,8 MB en flujo-ecommerce).
      '/api': { target: 'http://127.0.0.1:5194', changeOrigin: false, timeout: 180000 },
    },
  },
})
