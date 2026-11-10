<script setup>
/* UN PDF COMO PÁGINAS, sin la barra del visor de Chrome: cada página es un lienzo del ancho de la región, sobre un fondo
   liso y con una sombra suave (como una hoja apoyada). Lo dibuja pdf.js en el navegador; las páginas se pintan a medida
   que se acercan a la vista, así un PDF largo abre enseguida, y se vuelven a pintar si cambia el ancho de la región. */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps({ src: { type: String, required: true }, name: { type: String, default: '' } })

const root = ref(null)
const pages = ref([])          // [{ n, ratio }] — la proporción alto/ancho de cada página, para reservar su lugar
const error = ref('')
const loading = ref(true)
let doc = null
let task = null
let observer = null
let resizer = null
let width = 0
const drawn = new Map()        // n → ancho con que se pintó
const canvases = new Map()     // n → <canvas>

async function load() {
  error.value = ''
  loading.value = true
  pages.value = []
  drawn.clear()
  try {
    task?.destroy()
    task = pdfjs.getDocument({ url: props.src, isEvalSupported: false })
    doc = await task.promise
    const list = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const v = page.getViewport({ scale: 1 })
      list.push({ n, ratio: v.height / v.width })
    }
    pages.value = list
    await nextTick()
    observe()
  } catch (e) {
    error.value = `No se pudo abrir el PDF: ${e?.message || e}`
  } finally {
    loading.value = false
  }
}

async function draw(n) {
  const canvas = canvases.get(n)
  if (!doc || !canvas || !width || drawn.get(n) === width) return
  drawn.set(n, width)
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const dpr = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: (width / base.width) * dpr })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
}

function observe() {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) draw(Number(e.target.dataset.page))
  }, { root: root.value, rootMargin: '600px 0px' })
  for (const c of canvases.values()) observer.observe(c)
}

function measure() {
  const el = root.value
  if (!el) return
  const style = getComputedStyle(el)
  const next = Math.floor(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
  if (next > 0 && Math.abs(next - width) > 2) {
    width = next
    observe()   // las que están a la vista se pintan otra vez con el ancho nuevo
  }
}

const setCanvas = (n) => (el) => { if (el) canvases.set(n, el); else canvases.delete(n) }

onMounted(() => {
  measure()
  resizer = new ResizeObserver(() => measure())
  resizer.observe(root.value)
  load()
})
watch(() => props.src, load)
onBeforeUnmount(() => { observer?.disconnect(); resizer?.disconnect(); task?.destroy() })
</script>

<template>
  <div ref="root" class="pdf-pages" :aria-label="name || 'PDF'">
    <p v-if="loading" class="pdf-note">Abriendo el PDF…</p>
    <p v-else-if="error" class="pdf-note error">{{ error }}</p>
    <canvas v-for="p in pages" :key="p.n" :ref="setCanvas(p.n)" :data-page="p.n" class="pdf-page"
            :style="{ aspectRatio: `1 / ${p.ratio}` }" :aria-label="`Página ${p.n} de ${pages.length}`" role="img"></canvas>
    <p v-if="pages.length" class="pdf-note">{{ pages.length }} página{{ pages.length === 1 ? '' : 's' }}</p>
  </div>
</template>

<style scoped>
.pdf-pages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; align-items: stretch; gap: 14px;
  padding: 16px 18px 24px; background: color-mix(in oklab, var(--muted) 55%, var(--background)) }
/* La hoja: blanca por su contenido, con una sombra corta y otra difusa, apenas visibles. */
.pdf-page { display: block; width: 100%; height: auto; border-radius: 2px; background: var(--card);
  box-shadow: 0 1px 2px color-mix(in oklab, var(--background) 55%, transparent), 0 6px 18px color-mix(in oklab, var(--background) 45%, transparent) }
.pdf-note { margin: 0; text-align: center; color: var(--fg-2); font-size: var(--text-xs) }
.pdf-note.error { color: var(--destructive-ink) }
</style>
