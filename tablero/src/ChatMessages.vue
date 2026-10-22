<script setup>
/* LOS MENSAJES DEL EQUIPO — lo que te escriben por el chat de la terminal del playground compartido.
 *
 * El tablero no es otro cliente del chat: el server le pregunta al CLI (`playground messages`), que es
 * el que está conectado mientras `playground listen` corre en segundo plano. Por eso esta vista dice
 * primero si ese proceso está prendido: apagado, no hay mensajes que mostrar ni se guardó nada.
 *
 * ⚠ El texto de un mensaje lo escribió otra persona: se pinta como texto (`{{ }}`), nunca con
 * `v-html`, y no se interpreta. Lo más nuevo va arriba, y lo que llegó desde la última vez que miraste
 * lleva la marca «nuevo».
 */
import { computed } from 'vue';

const props = defineProps({
  chat: Object,          // la respuesta de /api/chat, o null mientras no llegó la primera
  error: String,         // no se pudo hablar con el server
  seenAt: String,        // hasta qué hora ya se habían visto (ISO)
  listenBusy: Boolean,
  listenError: String,
});
const emit = defineEmits(['refresh', 'listen']);

const clock = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('es-CO', {
    timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false,
    ...(today ? {} : { day: 'numeric', month: 'short' }),
  });
};
// Cómo contestarle, con el mismo nombre que acepta `playground send`: la parte del correo antes de la @.
const handle = (from) => (from?.email || '').split('@')[0] || from?.github || from?.name || '';

const messages = computed(() => [...(props.chat?.messages || [])].reverse());
const isNew = (m) => !props.seenAt || (m.time && m.time > props.seenAt);
const me = computed(() => props.chat?.me?.email || '');
</script>

<template>
  <section class="chat" aria-label="Mensajes del equipo">
    <div class="region-head group chat-head">
      <span class="gh">Mensajes <span class="mut">· lo que te escriben por el chat de la terminal</span></span>
      <button type="button" class="btn btn-ghost btn-sm" @click="emit('refresh')">Actualizar</button>
    </div>

    <p v-if="error" class="note bad">{{ error }}</p>

    <template v-else-if="!chat">
      <p class="note">Preguntándole al CLI…</p>
    </template>

    <template v-else-if="!chat.installed">
      <p class="note">No encuentro el comando <code>playground</code> en esta máquina. Se instala con:</p>
      <pre class="cmd">curl -fsSL https://playground.creditop.com/cli/install | sh
playground login</pre>
    </template>

    <template v-else-if="!chat.listening">
      <p class="note">
        No estás escuchando: los mensajes llegan sólo mientras <code>playground listen</code> está prendido,
        y lo que te escribieron antes no se guardó.
      </p>
      <div class="actions">
        <button type="button" class="btn" :disabled="listenBusy" @click="emit('listen')">
          {{ listenBusy ? 'Prendiendo…' : 'Empezar a escuchar' }}
        </button>
        <span class="mut">es lo mismo que correr <code>playground listen</code></span>
      </div>
      <p v-if="listenError" class="note bad">{{ listenError }}</p>
    </template>

    <template v-else>
      <p class="state">
        <span class="dot" :class="{ off: !chat.connected }" aria-hidden="true"></span>
        {{ chat.connected ? 'Escuchando' : 'Reconectando' }}<template v-if="me"> como {{ me }}</template>
        <template v-if="chat.since"> desde las {{ clock(chat.since) }}</template>
      </p>
      <p v-if="chat.error" class="note bad">{{ chat.error }}</p>

      <p v-if="!messages.length" class="note">Todavía no te escribió nadie.</p>
      <ol v-else class="list">
        <li v-for="(m, i) in messages" :key="`${m.time}-${i}`" class="message" :class="{ fresh: isNew(m) }">
          <div class="meta">
            <b>{{ m.from?.name || m.from?.email || 'alguien' }}</b>
            <span v-if="m.from?.email" class="mut">{{ m.from.email }}</span>
            <time class="mut" :datetime="m.time">{{ clock(m.time) }}</time>
            <span v-if="isNew(m)" class="badge badge-outline badge-xs">nuevo</span>
          </div>
          <p class="text">{{ m.text }}</p>
          <p v-if="handle(m.from)" class="reply mut">contestar: <code>playground send @{{ handle(m.from) }} "…"</code></p>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; gap: var(--space-3); max-width: 760px }
.chat-head { margin: 0 -24px 2px; padding: 8px 24px; width: auto; justify-content: space-between }
.chat-head .gh { display: flex; align-items: center; gap: 9px; min-width: 0 }
.note { margin: 0; color: var(--mut); font-size: var(--text-base); line-height: 1.55 }
.note.bad { color: var(--bad) }
code { font-family: var(--font-mono); font-size: .92em }
.cmd { margin: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius);
       background: var(--panel2); font: 12px/1.6 var(--font-mono); overflow-x: auto }
.actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap }
.actions .mut { font-size: var(--text-sm) }
.state { margin: 0; display: flex; align-items: center; gap: 7px; font-size: var(--text-sm); color: var(--mut) }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok) }
.dot.off { background: var(--mut) }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.message { padding: 12px 0 12px 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px }
.message.fresh { box-shadow: inset 2px 0 0 var(--acc) }
.meta { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: var(--text-base) }
.meta .mut { font-size: var(--text-sm) }
.text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.55 }
.reply { margin: 0; font-size: var(--text-sm) }
.mut { color: var(--mut) }
</style>
