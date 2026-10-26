import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

/* El chat va con el estilo «Paneles» de la base (`workbench.css`, como canon): cada región, un panel sobre el lienzo. */
document.documentElement.setAttribute('data-style', 'panels')

createApp(App).use(createPinia()).mount('#app')
