import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// El estilo «Paneles»: cada región (y cada vista del sidebar) es un panel sobre el lienzo, como en chat.
document.documentElement.setAttribute('data-style', 'panels')

createApp(App).mount('#app')
