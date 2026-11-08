import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import 'prosemirror-view/style/prosemirror.css'
import 'animate.css'
import '@/assets/styles/prosemirror.scss'
import '@/assets/styles/global.scss'
import '@/assets/styles/font.scss'

import Directive from '@/directive'

// eslint-disable-next-line no-console -- Build mode is a browser startup diagnostic.
console.info(`[courseware] Build mode: ${import.meta.env.MODE}`)

const app = createApp(App)
app.use(Directive)
app.use(createPinia())
app.mount('#app')
