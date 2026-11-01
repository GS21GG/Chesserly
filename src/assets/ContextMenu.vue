<script setup>
  defineProps({
    visible: Boolean,
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 }
  })
  defineEmits(['delete'])
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu"
      :style="{ top: y + 'px', left: x + 'px' }"
      @click.stop
    >
      <button class="context-menu-item delete" @click="$emit('delete')">
        Delete move
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
  .context-menu {
    position: fixed;
    z-index: 2000;
    background: #2a2a2a;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    min-width: 140px;
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 0.65rem 1rem;
    background: transparent;
    border: none;
    color: #f4f0e3;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
  }

  .context-menu-item.delete { color: #ff6b6b; }
  .context-menu-item.delete:hover { background: rgba(255, 60, 60, 0.2); }
</style>