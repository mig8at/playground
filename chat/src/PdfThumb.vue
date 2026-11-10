<script setup>
/* LA PORTADA DE UN PDF como miniatura: la primera página, dibujada por pdf.js al ancho del cuadro. Si no se puede
   abrir, avisa con `fail` y el cuadro sigue mostrando su tipo. */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps({ src: { type: String, required: true } })
const emit = defineEmits(['fail'])
const canvas = ref(null)
const ready = ref(false)
let task = null

onMounted(async () => {
  try {
    task = pdfjs.getDocument({ url: props.src, isEvalSupported: false })
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const target = (canvas.value?.clientWidth || 120) * (window.devicePixelRatio || 1)
    const viewport = page.getViewport({ scale: target / base.width })
    if (!canvas.value) return
    canvas.value.width = Math.floor(viewport.width)
    canvas.value.height = Math.floor(viewport.height)
    await page.render({ canvasContext: canvas.value.getContext('2d'), viewport }).promise
    ready.value = true
  } catch {
    emit('fail')
  }
})
onBeforeUnmount(() => task?.destroy())
</script>

<template>
  <canvas ref="canvas" class="pdf-thumb" :class="{ ready }" aria-hidden="true"></canvas>
</template>

<style scoped>
/* La hoja arranca arriba, como una captura: se ve el encabezado del documento. */
.pdf-thumb { display: block; width: 100%; opacity: 0; transition: opacity .2s }
.pdf-thumb.ready { opacity: 1 }
</style>
