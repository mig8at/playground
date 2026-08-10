import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// :5198 era el último 519x libre. Ocupados hoy: 5190 flow · 5191 tablero · 5192 trazador ·
// 5193 context · 5194 dict · 5195 panel · 5196 · 5197 engine · 5199 trazador-server · 5174 wizard.
// El server Go va en :8090 (8000 admin · 8103/8104 mocks del harness · 8787 tablero-server).
//
// El PROXY, igual que en trazador: un solo origen, así el día que el Go sirva el `dist/` las rutas
// `/api/…` no cambian. Y `timeout: 0` es OBLIGATORIO acá: el stream SSE de eventos vive minutos y
// cualquier timeout del proxy lo corta — el síntoma engaña, se ve como "el server se cayó".
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5198,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: false,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
