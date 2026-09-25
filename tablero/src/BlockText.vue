<script setup>
/* UNA LÍNEA DE UN BLOQUE — texto, código, negrita y enlaces con tipo.
 *
 * Nada pasa por v-html: `inlineParts` parte el texto y Vue escapa cada pedazo. Un archivo se muestra con
 * su repo adelante —«legacy-backend · CreatesApplication»— porque de eso se trata nombrarlo por repo, y
 * enlaza a GitHub en el commit que el bloque dejó fijado. Un bloque citado no es un enlace de página:
 * la app usa el hash para rutear, así que lleva a él con un botón.
 */
import { computed } from 'vue';
import { inlineParts, repoHref, visorHref } from './block-body.js';

const props = defineProps({
  text: { type: String, default: '' },
  repos: { type: Object, default: () => ({}) },
  canonLink: { type: Function, required: true },
  jiraLink: { type: Function, required: true },
});
const emit = defineEmits(['block']);
const parts = computed(() => inlineParts(props.text));
const hrefOf = (part) => {
  if (part.kind === 'canon') return props.canonLink(part.ref);
  if (part.kind === 'repo' || part.kind === 'pr') return repoHref(part, props.repos);
  if (part.kind === 'jira') return props.jiraLink(part.key);
  if (part.kind === 'web') return part.url;
  if (part.kind === 'visor') return visorHref(part);
  return '';
};
const titleOf = (part) => {
  if (part.kind === 'repo') return `${part.repo}/${part.path}${part.sha ? ` @ ${part.sha}` : ''}`;
  if (part.kind === 'pr') return `${part.repo} #${part.number}`;
  if (part.kind === 'canon') return `canon · ${part.ref}`;
  if (part.kind === 'visor') return `visor · ${part.project}/${part.screen}${part.print ? ` · huella ${part.print}` : ' · sin huella: no se puede saber si cambió'}`;
  return undefined;
};
</script>

<template>
  <template v-for="(part, index) in parts" :key="index"><code v-if="part.type === 'code'" class="inline-code">{{ part.value }}</code><strong v-else-if="part.type === 'strong'">{{ part.value }}</strong><button v-else-if="part.type === 'link' && part.kind === 'block'" type="button" class="ref ref-block" @click="emit('block', part.id)">{{ part.label }}</button><component :is="hrefOf(part) ? 'a' : 'span'" v-else-if="part.type === 'link'" class="ref" :class="'ref-' + part.kind" :href="hrefOf(part) || undefined" :title="titleOf(part)" :target="hrefOf(part) ? '_blank' : undefined" :rel="hrefOf(part) ? 'noopener' : undefined"><span v-if="part.kind === 'repo' || part.kind === 'pr'" class="ref-source">{{ part.repo }} · </span><span v-else-if="part.kind === 'visor'" class="ref-source">diseño · </span>{{ part.label }}</component><template v-else>{{ part.value }}</template></template>
</template>

<style scoped>
.ref { color: var(--acc); text-decoration: none }
a.ref:hover, .ref-block:hover { text-decoration: underline }
.ref-source { color: var(--mut) }
.ref-block { padding: 0; border: 0; background: none; font: inherit; cursor: pointer }
.inline-code { color: var(--txt); font: 11.5px var(--mono, ui-monospace, monospace); overflow-wrap: anywhere }
</style>
