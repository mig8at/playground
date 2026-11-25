import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { flowBridge } from './server/bridge.mjs'

export default defineConfig({
  // flowBridge: el canal de `bin/flow` con la app abierta (server/bridge.mjs).
  plugins: [vue(), flowBridge()],
  // :5252 es el puerto de Flow en Cockpit. PORT (env) permite una 2.ª instancia sin pisarla.
  server: { port: Number(process.env.PORT) || 5252, strictPort: true, host: '127.0.0.1' },
})
