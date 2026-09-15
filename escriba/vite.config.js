import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/* :5188 — el escalón de abajo de `ingles` (5189), que es su hermana: las dos son herramientas
   personales de escribir, y tenerlas pegadas ayuda a acordarse.
   `strictPort` a propósito: si el puerto está tomado quiero el error, no que Vite se mude en
   silencio y el enlace del Makefile quede mintiendo. */
export default defineConfig({
  plugins: [vue()],
  server: { port: Number(process.env.PORT) || 5188, strictPort: true },
})
