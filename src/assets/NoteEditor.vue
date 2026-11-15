<script setup>
defineProps({
  open: Boolean,
  san: { type: String, default: '' },
  draft: { type: String, default: '' }
})
defineEmits(['update:draft', 'save', 'cancel'])
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="note-overlay" @click.self="$emit('cancel')">
      <div class="note-editor">
        <h3 class="note-editor-title">
          📝 Move Note
          <span class="note-editor-move">{{ san }}</span>
        </h3>
        <textarea
          :value="draft"
          @input="$emit('update:draft', $event.target.value)"
          class="note-textarea"
          rows="3"
          placeholder="e.g. Missed the tactic here, should have played Bxh7+ first…"
          @keydown.ctrl.enter="$emit('save')"
          @keydown.meta.enter="$emit('save')"
          autofocus
        ></textarea>
        <div class="note-actions">
          <button class="note-btn cancel" @click="$emit('cancel')">Cancel</button>
          <button class="note-btn save" @click="$emit('save')">Save</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
  .note-overlay {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px);
  }

  .note-editor {
    background: linear-gradient(145deg, var(--panel-1, #262421), var(--panel-2, #1e1c18));
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 1.2rem 1.4rem;
    width: min(90vw, 24rem);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
  }

  .note-editor-title {
    font-family: serif;
    color: #f5f5dc;
    font-size: 1rem;
    font-weight: 700;
    margin: 0 0 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .note-editor-move {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.85rem;
    color: var(--text-highlight, #d9b382);
    background: rgba(255, 255, 255, 0.08);
    padding: 0.1rem 0.45rem;
    border-radius: 6px;
  }

  .note-textarea {
    width: 100%;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 0.7rem 0.8rem;
    color: #f4f0e3;
    font-family: "Inter", sans-serif;
    font-size: 0.88rem;
    line-height: 1.5;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .note-textarea:focus { border-color: rgba(168, 217, 122, 0.5); }
  .note-textarea::placeholder { color: rgba(244, 240, 227, 0.35); }

  .note-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.8rem; }

  .note-btn {
    padding: 0.45rem 1rem;
    border-radius: 8px;
    border: none;
    font-weight: 600;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .note-btn.cancel { background: rgba(255, 255, 255, 0.08); color: rgba(244, 240, 227, 0.7); }
  .note-btn.cancel:hover { background: rgba(255, 255, 255, 0.14); }

  .note-btn.save {
    background: linear-gradient(145deg, rgba(168, 217, 122, 0.3), rgba(106, 209, 63, 0.2));
    color: #a8d97a;
    border: 1px solid rgba(168, 217, 122, 0.3);
  }

  .note-btn.save:hover {
    background: linear-gradient(145deg, rgba(168, 217, 122, 0.4), rgba(106, 209, 63, 0.3));
  }
</style>