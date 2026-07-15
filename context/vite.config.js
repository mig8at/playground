import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Puerto 5193 para no chocar con flow (:5190), tools (:5191), soporte (:5192).
export default defineConfig({
  plugins: [vue()],
  server: { port: 5193 },
})
