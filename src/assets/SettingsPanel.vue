<script setup>
  import { ref } from 'vue'

  const props = defineProps({
    isOpen: Boolean,
    targetDepth: Number,
    soundOn: Boolean,
    showBestArrow: Boolean,
    boardTheme: String
  })

  const emit = defineEmits([
    'update:isOpen', 
    'update:targetDepth', 
    'update:soundOn', 
    'update:showBestArrow',
    'update:boardTheme',
    'depthChanged',
    'flipBoard',
    'copyPgn',
    'copyFen'
  ])

  const themes = [
    { value: 'midnight', label: 'Midnight Dark' },
    { value: 'brown', label: 'Dark Wood' },
    { value: 'blue', label: 'Ocean Blue' },
    { value: 'green', label: 'Forest Green' },
    { value: 'purple', label: 'Amethyst' },
    { value: 'slate', label: 'Cool Slate' },
    { value: 'cherry', label: 'Deep Cherry' }
  ]

  function close() {
    emit('update:isOpen', false)
  }

  // Board actions close the panel so the board (or the toast) is visible right away
  function runAction(eventName) {
    emit(eventName)
    close()
  }
</script>

<template>
  <Transition name="fade">
    <div v-if="isOpen" class="modal-overlay" @click.self="close">
      <div class="settings-modal">
        <div class="modal-header">
          <h2>UI & Engine Settings</h2>
          <button class="close-btn" @click="close">✕</button>
        </div>
        
        <div class="settings-content">
          <!-- Board actions -->
          <div class="setting-group">
            <label>Board</label>
            <div class="action-row">
              <button type="button" class="action-btn" @click="runAction('flipBoard')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M7 4v13" />
                  <path d="M3.5 13.5 7 17l3.5-3.5" />
                  <path d="M17 20V7" />
                  <path d="M13.5 10.5 17 7l3.5 3.5" />
                </svg>
                Flip board
              </button>
              <button type="button" class="action-btn" @click="runAction('copyPgn')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="11" height="11" rx="2.5" />
                  <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16" />
                </svg>
                Copy PGN
              </button>
              <button type="button" class="action-btn" @click="runAction('copyFen')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="11" height="11" rx="2.5" />
                  <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16" />
                </svg>
                Copy FEN
              </button>
            </div>
          </div>

          <!-- Engine Depth -->
          <div class="setting-group">
            <label>
              Search Depth <span class="highlight">{{ targetDepth }}</span>
            </label>
            <input 
              type="range" min="10" max="20" step="1"
              :value="targetDepth"
              @input="emit('update:targetDepth', Number($event.target.value))"
              @change="emit('depthChanged')"
            />
          </div>

          <!-- Theme Selector -->
          <div class="setting-group">
            <label>App Theme</label>
            <select 
              class="theme-select" 
              :value="boardTheme" 
              @change="emit('update:boardTheme', $event.target.value)"
            >
              <option v-for="t in themes" :key="t.value" :value="t.value">
                {{ t.label }}
              </option>
            </select>
          </div>

          <!-- Toggles -->
          <div class="setting-group toggles">
            <label class="toggle-label">
              <span>Move Sounds</span>
              <input type="checkbox" :checked="soundOn" @change="emit('update:soundOn', $event.target.checked)">
            </label>
            <label class="toggle-label">
              <span>Show Best Move Arrow</span>
              <input
                type="checkbox"
                :checked="showBestArrow"
                @change="emit('update:showBestArrow', $event.target.checked)"
              >
            </label>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }

  .settings-modal {
    background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    width: 90%;
    max-width: 400px;
    max-height: 90vh;
    max-height: 90dvh;
    overflow-y: auto;
    color: #f4f0e3;
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    font-family: 'Inter', sans-serif;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.2rem 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .modal-header h2 { margin: 0; font-size: 1.2rem; }

  .close-btn {
    background: transparent;
    border: none;
    color: #888;
    font-size: 1.5rem;
    cursor: pointer;
    transition: color 0.2s;
  }
  .close-btn:hover { color: #fff; }

  .settings-content { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }

  .setting-group { display: flex; flex-direction: column; gap: 0.5rem; }
  .setting-group label { font-size: 0.9rem; font-weight: 600; display: flex; justify-content: space-between; }

  .action-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.65rem 0.3rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: #f4f0e3;
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(217, 179, 130, 0.4);
  }

  .action-btn:active { transform: scale(0.97); }
  .action-btn svg { display: block; color: #d9b382; }

  input[type="range"] {
    accent-color: #d9b382;
    width: 100%;
  }

  .toggles { gap: 1rem; }
  .toggle-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
  }

  .fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
  .fade-enter-from, .fade-leave-to { opacity: 0; }

  .theme-select {
    background: rgba(0,0,0,0.3);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    padding: 0.5rem;
    border-radius: 8px;
    outline: none;
    width: 100%;
    font-family: inherit;
    cursor: pointer;
  }
  .theme-select option {
    background: #1a1a1a;
    color: #fff;
  }
  .highlight { color: var(--text-highlight, #d9b382); font-family: monospace; }
</style>