import { createApp } from 'vue'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'

import Analysis from './pages/Analysis.vue'
import Review from './pages/Review.vue'
import Play from './pages/Play.vue'
import Insights from './pages/Insights.vue'
import Puzzles from './pages/Puzzles.vue'
import Privacy from './pages/Privacy.vue'
import posthog from 'posthog-js'



const routes = [
	{ path: "/", component: Analysis },
	{ path: "/Review", component: Review },
	{ path: "/Insights", component: Insights },
	{ path: "/vsComputer", component: Play }, 
	{ path: '/Puzzles', name: 'Puzzles', component: Puzzles },
	{ path: '/Privacy', name: 'Privacy', component: Privacy }
]

const router = createRouter({
	history: createWebHistory(),
	routes
})

posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: import.meta.env.VITE_POSTHOG_HOST,
  defaults: '2026-05-30',
  cookieless_mode: 'on_reject',
  persistence: 'memory',
  capture_pageview: false,
  autocapture: false,
  disable_session_recording: true,
  capture_heatmaps: false,
  capture_performance: false
})

const app = createApp(App)
app.use(router)
app.mount('#app')
