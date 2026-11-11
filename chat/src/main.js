import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { setupDesktop } from './desktop.js'
import './style.css'

/* El chat va con el estilo «Paneles» de la base (`workbench.css`, como canon): cada región, un panel sobre el lienzo. */
document.documentElement.setAttribute('data-style', 'panels')

// En la app de escritorio, antes de montar: los avisos nativos y los enlaces afuera (`desktop.js`).
setupDesktop().then(() => createApp(App).use(createPinia()).mount('#app'))
