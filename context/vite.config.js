import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Viz read-only del árbol de contexto. Sin backend: lee tree.json + los map.json/doc.md
// del repo vía import.meta.glob. `npm run dev` levanta solo Vite en :5193.
export default defineConfig({
  plugins: [vue()],
  server: { port: 5193 },
})
