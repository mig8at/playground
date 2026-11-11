import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

/* Con el estilo «Paneles» de la base (`workbench.css`), como el chat: cada región, un panel sobre el lienzo. */
document.documentElement.setAttribute('data-style', 'panels')

createApp(App).mount('#app')
