<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { bindMenu } from './workbench.js';
const props = defineProps({
  items: { type: Array, required: true },
  title: { type: String, default: 'Más opciones' },
  icon: { type: String, default: 'more' },
  active: Boolean,
});
const emit = defineEmits(['select', 'toggle']);
const trigger = ref(null);
let menu;
onMounted(() => {
  menu = bindMenu(trigger.value, {
    label: props.title, getItems: () => props.items,
    onSelect: (id) => { emit('select', id); emit('toggle', id); },
  });
});
watch(() => props.items, () => menu?.refresh(), { deep: true, flush: 'post' });
onUnmounted(() => menu?.destroy());
</script>

<template>
  <button ref="trigger" type="button" class="region-action" :class="{ 'has-options': active }"
          :title="title" :aria-label="title">
    <span class="ui-icon" :data-icon="icon" aria-hidden="true"></span>
  </button>
</template>
