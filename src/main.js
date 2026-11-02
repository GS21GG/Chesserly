import { createApp } from 'vue'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'

import Analysis from './pages/Analysis.vue'
import Review from './pages/Review.vue'
import Play from './pages/Play.vue'
import Insights from './pages/Insights.vue'
import Puzzles from './pages/Puzzles.vue'
import Privacy from './pages/Privacy.vue'

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

router.afterEach((to) => {
  if (typeof window.gtag === 'function') {
    window.gtag('config', 'G-GYKFRBMF29', {
      page_path: to.fullPath
    })
  }
})

const app = createApp(App)
app.use(router)
app.mount('#app')
