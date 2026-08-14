import { marked } from 'marked'
import DOMPurify from 'dompurify'

/* Markdown → HTML, sanitizado.
   Esto es texto que escribe una persona y que después se inyecta con `v-html` en la pantalla de
   todos: sin sanitizar, cualquiera que pueda escribir documentación puede ejecutar JavaScript en
   el navegador del resto del equipo. `marked` convierte y `DOMPurify` decide qué sobrevive.

   La lista de tags es cerrada y a propósito NO incluye `img` ni `iframe`: una imagen remota en una
   nota filtra a un tercero quién la leyó y cuándo, y un iframe es una página entera dentro de la
   nuestra. Nada de eso hace falta para explicar una trampa de un seeder. */
const TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre',
  'ul', 'ol', 'li', 'blockquote', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

marked.setOptions({ gfm: true, breaks: true })

/* Los enlaces salen a otra pestaña y con `rel` completo. Sin `noopener`, la página destino puede
   tocar `window.opener` y redirigir la nuestra. */
DOMPurify.addHook('afterSanitizeAttributes', (nodo) => {
  if (nodo.tagName === 'A') {
    nodo.setAttribute('target', '_blank')
    nodo.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

export function aHtml(md){
  if (!md?.trim()) return ''
  return DOMPurify.sanitize(marked.parse(md), {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    // Solo esquemas que llevan a algún lado; corta `javascript:` y `data:`.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  })
}
