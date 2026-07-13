import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // PORT (env) permite levantar una 2ª instancia (p.ej. el preview de Claude) sin pisar la de :5190.
  server: { port: Number(process.env.PORT) || 5190, strictPort: true, host: true }
})
