import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/* :5189 — la familia 519x está llena (5190 flow · 5191 tablero · 5192 trazador · 5193 context ·
   5194 dict · 5195 panel · 5196 engine · 5197 cuadrilla · 5198 plantillas · 5199 trazador-go), así
   que esto baja un escalón. 5183 lo tiene domain-model; 5184-5189 estaban libres.
   `strictPort` a propósito: si el puerto está tomado quiero el error, no que Vite se mude en
   silencio y el enlace del Makefile quede mintiendo. */
export default defineConfig({
  plugins: [vue()],
  server: { port: Number(process.env.PORT) || 5189, strictPort: true },
})
