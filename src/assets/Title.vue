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
      <svg class="logo" viewBox="228 68 796 1072" aria-hidden="true">
        <defs>
          <linearGradient id="lg-gold" gradientUnits="userSpaceOnUse" x1="0" y1="78" x2="0" y2="1130">
            <stop offset="0" stop-color="#FFE15A"/>
            <stop offset="1" stop-color="#F5B400"/>
          </linearGradient>
        </defs>
        <g fill="url(#lg-gold)">
          <!-- cross -->
          <rect x="585" y="78" width="83" height="200" rx="10"/>
          <rect x="512" y="150" width="229" height="65" rx="10"/>
          <!-- ring -->
          <path fill-rule="evenodd" d="M506,381 A120,120 0 1 0 746,381 A120,120 0 1 0 506,381 Z M551,381 A75,75 0 1 0 701,381 A75,75 0 1 0 551,381 Z"/>
          <!-- crown -->
          <path fill-rule="evenodd" d="M419,953 C428,940 434,925 436,905 C438,880 420,855 380,822 C320,775 238,720 238,600 C238,470 380,370 506,395 Q626,540 746,395 C872,370 1014,470 1014,600 C1014,720 932,775 872,822 C832,855 814,880 816,905 C818,925 824,940 833,953 Z M590,513 C540,480 480,462 430,470 C360,482 326,535 326,595 C326,680 400,740 440,775 C490,815 520,860 510,908 C570,850 580,700 590,513 Z M662,513 C712,480 772,462 822,470 C892,482 926,535 926,595 C926,680 852,740 812,775 C762,815 732,860 742,908 C682,850 672,700 662,513 Z"/>
          <!-- base -->
          <rect x="366" y="973" width="521" height="60" rx="30"/>
          <rect x="320" y="1052" width="612" height="78" rx="39"/>
        </g>
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
    font-weight: 700;
    letter-spacing: 0.2em;
    padding-left: 0.2em; /* balances the letter-spacing so it looks centered */
    color: #f4f1ea;
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
