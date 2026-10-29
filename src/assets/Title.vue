<script setup>
  import { ref, computed, watch } from 'vue'
  import { useRouter, useRoute } from 'vue-router'

  const router = useRouter()
  const route = useRoute()

  const menuOpen = ref(false)

  // Close the mobile dropdown whenever the route changes
  watch(() => route.path, () => { menuOpen.value = false })

  const activeColor = "var(--title-btn-active-1), var(--title-btn-active-2)"
  const idleColor = "var(--title-btn-idle-1), var(--title-btn-idle-2)"

  function bgColor(buttonName) {
    return activeButton.value === buttonName ? activeColor : idleColor
  }

  function navTo(path) {
    router.push(path)
    menuOpen.value = false
  }

  function analyzeClick() { navTo('/') }
  function importClick() { navTo('/Review') }
  function insightsClick() { navTo('/Insights') }
  function gameClick() { navTo('/vsComputer') }
  function puzzlesClick() { navTo('/Puzzles') }

  const activeButton = computed(() => {
    if (route.path === '/Review') return 'import'
    if (route.path === '/Analysis') return 'analyze'
    if (route.path === '/Insights') return 'insight'
    if (route.path === '/vsComputer') return 'computer'
    if (route.path === '/Puzzles') return 'puzzles'
    return 'analyze'
  })
</script>

<template>
  <div class="title-container" :class="{ 'menu-open': menuOpen }">
    <h1 class="title">
      <svg class="logo" viewBox="268 148 716 928" aria-hidden="true">
        <defs>
          <linearGradient id="lg-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FDE047"/>
            <stop offset="1" stop-color="#FBBF24"/>
          </linearGradient>
          <linearGradient id="lg-base" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#FDD02F"/>
            <stop offset="1" stop-color="#F29D12"/>
          </linearGradient>
          <linearGradient id="lg-ribbon" gradientUnits="userSpaceOnUse" x1="0" y1="500" x2="0" y2="905">
            <stop offset="0" stop-color="#F6A91E"/>
            <stop offset="0.6" stop-color="#E58A12"/>
            <stop offset="1" stop-color="#8B4A1C"/>
          </linearGradient>
          <linearGradient id="lg-stemL" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#F59E0B"/>
            <stop offset="1" stop-color="#FBBF24"/>
          </linearGradient>
          <g id="lg-arm">
            <path fill-rule="evenodd" fill="url(#lg-gold)" d="M527 425 C380 395 272 500 272 607 C272 720 350 770 420 830 C445 855 445 880 435 905 L627 905 L627 488 C585 480 545 460 527 425 Z M425 500 C500 495 560 520 582 548 C590 600 575 760 556 805 C548 830 542 840 535 842 C520 790 372 730 372 607 C372 560 395 520 425 500 Z"/>
            <path fill="url(#lg-ribbon)" d="M272 607 C272 720 350 770 420 830 C445 855 445 880 435 905 C490 898 530 875 535 842 C520 790 372 730 372 607 C372 560 395 520 425 500 C340 520 290 580 272 607 Z"/>
          </g>
          <path id="lg-stem" d="M627 488 L582 548 C590 600 575 760 556 805 C548 830 542 840 535 842 C520 880 480 898 435 905 L627 905 Z"/>
        </defs>

        <!-- cross -->
        <rect x="587" y="150" width="80" height="190" rx="10" fill="url(#lg-gold)"/>
        <rect x="520" y="218" width="213" height="65" rx="10" fill="url(#lg-gold)"/>
        <!-- ring -->
        <path fill-rule="evenodd" fill="url(#lg-gold)" d="M517 420 a110 110 0 1 0 220 0 a110 110 0 1 0 -220 0 Z M560 420 a67 67 0 1 0 134 0 a67 67 0 1 0 -134 0 Z"/>
        <!-- arms -->
        <use href="#lg-arm"/>
        <use href="#lg-arm" transform="translate(1254 0) scale(-1 1)"/>
        <!-- stem -->
        <use href="#lg-stem" fill="url(#lg-stemL)"/>
        <use href="#lg-stem" fill="url(#lg-gold)" transform="translate(1254 0) scale(-1 1)"/>
        <!-- base -->
        <rect x="380" y="928" width="490" height="58" rx="22" fill="url(#lg-base)"/>
        <rect x="338" y="1000" width="570" height="72" rx="36" fill="url(#lg-base)"/>
      </svg>
      <span class="title-text">CHESSERLY</span>
    </h1>

    <button
      class="menu-toggle"
      :aria-expanded="menuOpen"
      aria-label="Navigation menu"
      @click="menuOpen = !menuOpen"
    >
      {{ menuOpen ? '✕' : '☰' }}
    </button>
    <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
    <nav class="title-nav">
      <button class="btn" :style="{ background: `linear-gradient(${bgColor('import')})` }" @click="importClick()">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" x2="12" y1="15" y2="3"/>
        </svg>
        GameImport
      </button>

      <button class="btn" :style="{ background: `linear-gradient(${bgColor('analyze')})` }" @click="analyzeClick()">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
        Analyse
      </button>

      <button class="btn" :style="{ background: `linear-gradient(${bgColor('insight')})` }" @click="insightsClick()">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v16a2 2 0 0 0 2 2h16"/>
          <path d="M18 17V9"/>
          <path d="M13 17V5"/>
          <path d="M8 17v-3"/>
        </svg>
        Insights
      </button>

      <button
        class="btn tooltip-btn"
        :style="{ background: `linear-gradient(${bgColor('computer')})` }"
        @click="gameClick()"
        disabled
        data-tooltip="Coming soon..."
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 8V4H8"/>
          <rect width="16" height="12" x="4" y="8" rx="2"/>
          <path d="M2 14h2"/>
          <path d="M20 14h2"/>
          <path d="M15 13v2"/>
          <path d="M9 13v2"/>
        </svg>
        VS Computer
      </button>

      <button
        class="btn tooltip-btn"
        :style="{ background: `linear-gradient(${bgColor('puzzles')})` }"
        @click="puzzlesClick()"
        disabled
        data-tooltip="Coming soon..."
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>
        </svg>
        Puzzles
      </button>
    </nav>
  </div>
</template>

<style scoped>
  .title-container {
    display: flex;
    align-items: center;
    flex-direction: column;
    margin-top: -0.5rem;
    margin-left: 2%;
    width: clamp(10rem, 20.7vw, 20rem);
    height: clamp(25rem, 37rem, 45rem);
    padding: 3%;
    box-sizing: border-box;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    margin: 1rem 0 1.5rem;
    user-select: none;
  }

  .logo {
    height: 3.5rem;
    width: auto;
    filter: drop-shadow(0 4px 10px rgba(245, 158, 11, 0.35));
  }

  .title-text {
    font-family: "Montserrat", "Trebuchet MS", system-ui, sans-serif;
    font-size: clamp(1.2rem, 2.2vw, 1.7rem);
    font-weight: 800;
    letter-spacing: 0.2em;
    padding-left: 0.2em; /* balances the letter-spacing so it looks centered */

    background: linear-gradient(90deg, #fde047, #f59e0b);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  button {
    width: clamp(3rem, 100%, 12.5rem);
    height: clamp(2.8rem, 5vh, 3.2rem);
    border-radius: 12px;
    border: none;
    margin-top: 1.5rem;

    font-size: clamp(15px, 1.5vw, 17px);
    font-weight: 600;
    letter-spacing: 0.4px;
    color: #fefefe;

    cursor: pointer;
    transition: transform 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
  }

  .btn {
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .icon {
    width: 1.15em;
    height: 1.15em;
    flex-shrink: 0;
  }

  button:hover:not(:disabled) {
    transform: translateY(-2px) scale(1.03);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  }

  button:active:not(:disabled) {
    transform: translateY(0) scale(0.99);
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35);
  }

  button:focus-visible {
    outline: 2px solid #faedcd;
    outline-offset: 3px;
  }

  /* Styling for disabled states */
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
    transform: none !important;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
  }

  /* ---- Desktop nav column (unchanged look) ---- */
  .title-nav {
    display: flex;
    align-items: center;
    flex-direction: column;
    width: 100%;
  }

  /* ---- Mobile-only pieces, hidden on desktop ---- */
  .menu-toggle {
    display: none;
  }

  .menu-backdrop {
    display: none;
  }

  /* Instant Tooltip Implementation */
  .tooltip-btn {
    position: relative;
  }

  /* The tooltip box */
  .tooltip-btn::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 115%;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(0, 0, 0, 0.85);
    color: #fff;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0s; /* 0s ensures it shows up instantly */
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
    z-index: 10;
  }

  /* Tiny arrow below the tooltip box */
  .tooltip-btn::before {
    content: " ";
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    border-width: 6px;
    border-style: solid;
    border-color: rgba(0, 0, 0, 0.85) transparent transparent transparent;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0s;
    z-index: 10;
  }

  /* Trigger tooltip instantly on hover */
  .tooltip-btn:hover::after,
  .tooltip-btn:hover::before {
    opacity: 1;
  }

  @media (max-width: 767px) {
    /* Slim one-row app bar: menu button on the left, brand centered.
       The 3rd grid column is an invisible spacer matching the button's
       width so the title stays optically centered. */
    .title-container {
      display: grid;
      grid-template-columns: 2.2rem minmax(0, 1fr) 2.2rem;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      height: auto;
      margin: 0 0 0.25rem 0;
      padding: 0.45rem 0.75rem;
      position: relative;
      z-index: 45;
    }

    .menu-toggle {
      grid-column: 1;
      grid-row: 1;
      justify-self: start;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      width: 2.2rem;
      height: 2.2rem;
      border: none;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      color: #faedcd;
      font-size: 1.1rem;
      cursor: pointer;
    }

    .title {
      grid-column: 2;
      grid-row: 1;
      justify-self: center;
      flex-direction: row;
      gap: 0.5rem;
      min-width: 0;
      margin: 0;
      white-space: nowrap;
    }

    .logo {
      height: 1.6rem;
    }

    .title-text {
      font-size: 1.05rem;
      letter-spacing: 0.15em;
    }

    .menu-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: -1;
    }

    .title-nav {
      display: none;
      position: absolute;
      top: calc(100% + 0.35rem);
      left: 0;
      right: 0;
      flex-direction: column;
      align-items: stretch;
      padding: 0.5rem;
      background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5);
    }

    .title-container.menu-open .title-nav {
      display: flex;
    }

    .title-nav .btn {
      margin-top: 0;
      width: 100%;
    }

    .title-nav .btn + .btn {
      margin-top: 0.45rem;
    }

    .tooltip-btn::after {
      bottom: 125%;
    }
  }
</style>
