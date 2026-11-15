<script setup>
defineProps({
  visible: Boolean,
  shortcuts: { type: Array, default: () => [] }
})
defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <Transition name="panel-fade">
      <div v-if="visible" class="shortcuts-overlay" @click.self="$emit('close')">
        <div class="shortcuts-panel">
          <div class="shortcuts-header">
            <h3>⌨️ Keyboard Shortcuts</h3>
            <button class="shortcuts-close" @click="$emit('close')">✕</button>
          </div>
          <div class="shortcuts-list">
            <div v-for="s in shortcuts" :key="s.keys" class="shortcut-row">
              <kbd>{{ s.keys }}</kbd>
              <span>{{ s.desc }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
  .shortcuts-overlay {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(3px);
  }

  .shortcuts-panel {
    background: linear-gradient(145deg, var(--panel-1, #262421), var(--panel-2, #1e1c18));
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    padding: 1.3rem 1.5rem;
    width: min(90vw, 22rem);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
  }

  .shortcuts-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .shortcuts-header h3 { font-family: serif; color: #f5f5dc; font-size: 1.05rem; font-weight: 700; margin: 0; }

  .shortcuts-close {
    background: none;
    border: none;
    color: rgba(244, 240, 227, 0.6);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0.2rem;
    line-height: 1;
  }

  .shortcuts-close:hover { color: #f4f0e3; }
  .shortcuts-list { display: flex; flex-direction: column; gap: 0.55rem; }
  .shortcut-row { display: flex; align-items: center; gap: 0.8rem; }

  .shortcut-row kbd {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-highlight, #d9b382);
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 0.25rem 0.55rem;
    min-width: 4.5rem;
    text-align: center;
    white-space: nowrap;
  }

  .shortcut-row span { color: rgba(244, 240, 227, 0.8); font-size: 0.85rem; }

  .panel-fade-enter-active, .panel-fade-leave-active { transition: opacity 0.25s ease; }
  .panel-fade-enter-from, .panel-fade-leave-to { opacity: 0; }
</style>