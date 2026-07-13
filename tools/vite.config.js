import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Puerto 5191 para no chocar con flow (:5190).
export default defineConfig({
  plugins: [vue()],
  server: { port: 5191 },
})
