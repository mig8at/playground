import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

/* Jarvis va con el estilo «Paneles» de la base (`workbench.css`, como chat y canon): cada región, un panel sobre el
 * lienzo. La pestaña Jarvis de la extensión usa el mismo. */
document.documentElement.setAttribute('data-style', 'panels')

createApp(App).mount('#app')
