import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { startRoutes } from './route'

createApp(App).mount('#app')
startRoutes()
