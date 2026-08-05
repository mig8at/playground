import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// :5192 era el puerto del `soporte` que se borró — el trazador es su sucesor, así que hereda el número en
// vez de inventar uno nuevo. Ocupados hoy: 5190 flow · 5191 tablero · 5193 context · 5194 dict ·
// 5195 panel · 5197 engine · 5174 wizard · 3100 Loki local · 3200/4318 Tempo local.
//
// El PROXY evita CORS y, más importante, hace que la app viva en un solo origen: el día que se sirva el
// `dist/` desde el propio Go, las rutas `/api/…` siguen valiendo sin cambiar una línea.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5192,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5199',
        changeOrigin: false,
        // Generoso: una traza contra prod pasa por la cola de Redash y puede tardar segundos.
        timeout: 120000,
      },
    },
  },
})
