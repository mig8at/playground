import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Puerto 5191 para no chocar con flow (:5190).
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: { port: 5191 },
})
