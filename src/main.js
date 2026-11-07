import { createApp } from 'vue'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'

import Analysis from './pages/Analysis.vue'
import Review from './pages/Review.vue'
import Play from './pages/Play.vue'
import Insights from './pages/Insights.vue'
import Puzzles from './pages/Puzzles.vue'
import Privacy from './pages/Privacy.vue'

/* ---------- Analytics consent (Google tag is loaded in index.html) ---------- */

const CONSENT_KEY = 'chesserly-analytics-consent'

// Used by CookieBanner.vue
window.getAnalyticsConsent = () => localStorage.getItem(CONSENT_KEY) // 'granted', 'denied' or null

window.setAnalyticsConsent = (granted) => {
  const value = granted ? 'granted' : 'denied'
  localStorage.setItem(CONSENT_KEY, value)
  window.gtag('consent', 'update', { analytics_storage: value })
}

// Used by Privacy.vue
window.resetAnalyticsConsent = () => {
  localStorage.removeItem(CONSENT_KEY)
  location.reload()
}

// Returning visitor who already said yes
if (window.getAnalyticsConsent() === 'granted') {
  window.gtag('consent', 'update', { analytics_storage: 'granted' })
}

function trackPage(path) {
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: location.origin + path,
    page_title: document.title,
  })
}

/* ---------- Router and app ---------- */

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

// Count every page the user opens (including the first one)
router.afterEach((to) => trackPage(to.fullPath))

const app = createApp(App)
app.use(router)
app.mount('#app')