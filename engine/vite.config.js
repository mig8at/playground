import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Misma convención que flow: PORT (env) permite una 2ª instancia sin pisar la de :5196.
export default defineConfig({
  plugins: [vue()],
  server: { port: Number(process.env.PORT) || 5196, strictPort: true, host: true }
})
