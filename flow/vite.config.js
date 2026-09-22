import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // PORT (env) permite levantar una 2ª instancia (p.ej. el preview de Claude) sin pisar la de :5190.
  server: {
    port: Number(process.env.PORT) || 5190, strictPort: true, host: true,
    // El servidor local del Trazador es la única puerta hacia Redash/prod. Flow nunca ve token ni SQL.
    proxy: { '/api/flow': { target: 'http://127.0.0.1:5199', changeOrigin: false, timeout: 120000 } },
  }
})
