import { createApp } from 'vue'
import ShopifyDemo from './ShopifyDemo.vue'
import './style.css'

// El mismo estilo «Paneles» que la pantalla principal.
document.documentElement.setAttribute('data-style', 'panels')

createApp(ShopifyDemo).mount('#app')
