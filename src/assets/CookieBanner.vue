<script setup>
  import { ref } from 'vue'

  const show = ref(window.getAnalyticsConsent() === null)

  function accept() {
    window.setAnalyticsConsent(true)
    show.value = false
  }
  function reject() {
    window.setAnalyticsConsent(false)
    show.value = false
  }
</script>

<template>
  <Transition name="banner">
    <div v-if="show" class="cookie-banner" role="dialog" aria-label="Analytics consent">
      <div class="text">
        <strong>Help us count visits</strong>
        <p>
          We use analytics to see how many people use Chesserly. If you reject,
          we don't track your visits.
          <router-link to="/Privacy">Learn more</router-link>
        </p>
      </div>
      <div class="actions">
        <button class="btn" @click="reject">Reject</button>
        <button class="btn" @click="accept">Accept</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
  .cookie-banner {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    width: min(640px, calc(100% - 32px));
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
    background: linear-gradient(135deg, var(--panel-1, #1c1c1c), var(--panel-2, #111));
    color: #e6e6e6;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    z-index: 1000;
  }

  .text { flex: 1; }

  .text strong {
    display: block;
    margin-bottom: 2px;
    font-size: 15px;
    color: var(--text-highlight, #fff);
  }

  .text p {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: #c9c9c9;
  }

  .text a {
    color: var(--text-highlight, #fff);
    text-decoration: underline;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    min-width: 84px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    background: var(--btn-idle, #444);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    transition: background 0.15s, transform 0.1s;
  }

  .btn:hover { background: var(--btn-active, #666); }
  .btn:active { transform: scale(0.97); }

  .banner-enter-active,
  .banner-leave-active {
    transition: opacity 0.25s, transform 0.25s;
  }
  .banner-enter-from,
  .banner-leave-to {
    opacity: 0;
    transform: translateX(-50%) translateY(12px);
  }

  @media (max-width: 520px) {
    .cookie-banner {
      flex-direction: column;
      align-items: stretch;
    }
    .btn { flex: 1; }
  }
</style>