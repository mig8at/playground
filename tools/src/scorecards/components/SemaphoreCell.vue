<script setup>
import { ref, computed } from 'vue'
import { EMOJI } from '../data.js'

const props = defineProps({ cell: Object, week: Number })
const emit = defineEmits(['set'])

const open = ref(false)
const OPTIONS = ['green', 'yellow', 'red', 'none']
const emoji = computed(() => EMOJI[props.cell.status] || '·')

function pick(status) {
  emit('set', status)
  open.value = false
}
</script>

<template>
  <td class="cell" :class="'s-' + cell.status">
    <button class="chip" :title="'W' + week" @click="open = !open">
      <span class="emoji">{{ emoji }}</span>
      <span v-if="cell.value" class="val">{{ cell.value }}</span>
    </button>

    <div v-if="open" class="picker" @mouseleave="open = false">
      <button
        v-for="s in OPTIONS"
        :key="s"
        class="opt"
        :class="'s-' + s"
        :title="s"
        @click="pick(s)"
      >
        {{ EMOJI[s] }}
      </button>
    </div>
  </td>
</template>

<style scoped>
.cell {
  padding: 0;
  text-align: center;
  position: relative;
  border-left: 1px solid var(--border);
}
.chip {
  width: 100%;
  min-height: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  padding: 4px 2px;
}
.chip:hover { background: rgba(0, 0, 0, 0.04); }
.emoji { font-size: 13px; line-height: 1; }
.val { font-size: 10px; font-weight: 600; color: var(--ink-soft); white-space: nowrap; }
.s-green { background: var(--green-bg); }
.s-yellow { background: var(--yellow-bg); }
.s-red { background: var(--red-bg); }
.s-red .val { color: var(--red-ink); }

.picker {
  position: absolute;
  z-index: 20;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
}
.opt {
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  background: transparent;
}
.opt:hover { border-color: var(--border-strong); }
</style>
