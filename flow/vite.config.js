import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // :5252 es el puerto de Flow en Cockpit. PORT (env) permite una 2.ª instancia sin pisarla.
  // (El proxy `/api/flow` al servidor del trazador se quitó: el trazador se borró el 2026-10-13, y la importación de
  // entidades de producción quedó sin backend.)
  server: { port: Number(process.env.PORT) || 5252, strictPort: true, host: '127.0.0.1' },
})
