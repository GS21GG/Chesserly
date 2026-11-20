<!--
  TheChessboard.vue — lightweight, crisp, animated chessboard (drop-in for vue3-chessboard).
  import TheChessboard from '../assets/TheChessboard.vue'

  What's new in this version:
  · Pieces: redrawn Staunton set — one clean silhouette per piece, warm ivory / charcoal
    shading, side sheen and a soft radial ground shadow. Still pure SVG, no filters.
  · Captures: no more spark burst. The taken piece simply shrinks away underneath the
    arriving piece, which lands with a tiny squash. Quiet and clean.
  · Animations: springy pick-up / drop, distance-based glide, lift + landing squash,
    staggered move hints, soft check pulse.
  · Lighter: burst FX layer, noise texture and per-piece rotation removed; detail
    strokes merged into single paths; fewer imports.
  · Dragging: unchanged — CSS-variable drag, cached board rect, instant drop.
  · Silent by design — the host app's useSound() remains the only audio source.
-->
<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Chess } from 'chess.js'

const props = defineProps({
  boardConfig: { type: Object, default: () => ({}) },
  fen: { type: String, default: '' }
})
const emit = defineEmits(['move', 'board-created', 'update:fen'])

/* ════════════════════════ 1 · CONFIG ════════════════════════ */
const cfg = reactive({
  orientation: 'white',
  coordinates: true,
  viewOnly: false,
  theme: 'midnight',
  colors: null,
  pieceScale: 0.74,
  animation: { enabled: true, duration: 180 },
  highlight: { lastMove: true, check: true },
  movable: { color: 'both', free: false, showDests: true },
  draggable: { enabled: true },
  drawable: { enabled: true, visible: true, autoShapes: [] },
  promotion: { autoQueen: false },
  badges: [],
  check: undefined
})
const lastMove = ref(undefined)
const animOn = computed(() => cfg.animation.enabled !== false)
const moveMs = computed(() => Math.max(0, Number(cfg.animation.duration) || 180))

function applyConfig(partial = {}) {
  for (const k of Object.keys(partial)) {
    const v = partial[k]
    if (['animation', 'highlight', 'movable', 'draggable', 'drawable', 'promotion'].includes(k) && v && typeof v === 'object') {
      Object.assign(cfg[k], v)
    } else if (k === 'lastMove') {
      lastMove.value = Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : undefined
    } else if (k === 'colors') {
      cfg.colors = v || null
    } else if (k === 'badges') {
      cfg.badges = Array.isArray(v) ? v.slice() : []
    } else if (k === 'pieceScale') {
      const n = Number(v)
      if (Number.isFinite(n)) cfg.pieceScale = Math.min(1, Math.max(0.5, n))
    } else if (k === 'orientation') {
      if (v === 'white' || v === 'black') cfg.orientation = v
    } else if (k in cfg) {
      cfg[k] = v
    }
  }
  refreshCheck()
}
function setConfig(c) { applyConfig(c || {}) }

// The host often passes a new inline object on every render. Skip the work if nothing really changed.
let lastCfgJson = ''
watch(() => props.boardConfig, c => {
  let j = null
  try { j = JSON.stringify(c || {}) } catch {}
  if (j !== null && j === lastCfgJson) return
  lastCfgJson = j || ''
  applyConfig(c || {})
}, { deep: true })

/* ════════════════════ 2 · PIECE ART — glossy Staunton, classic set ════════════════════ */
const uid = 'cb' + Math.random().toString(36).slice(2, 8)
const ART_H = 35.2, ART_CX = 22.5, ART_CY = 22.2
// k: 'b' body (fill+outline+sheen) · 'd' detail strokes · 'e' eye/nostril dot · 'x' cross finial
const SHADOW_RX = { p: 11.5, r: 11.2, n: 12.6, b: 10.2, q: 14.2, k: 11.6 }
const ART = {
  p: [
    { t: 'circle', k: 'b', cx: 22.5, cy: 12.6, r: 4.9 },
    { t: 'path', k: 'b', d: 'M19.2 16.8 H25.8 C26.6 16.8 27.2 17.4 27.2 18.2 V18.9 C27.2 19.6 26.7 20.2 26.0 20.4 L25.6 20.5 C25.9 24.5 26.9 28.6 28.9 31.6 C29.6 32.7 30.6 33.5 31.8 34.0 L32.6 34.3 C33.4 34.6 33.9 35.3 33.9 36.1 V37.6 C33.9 38.6 33.1 39.4 32.1 39.4 H12.9 C11.9 39.4 11.1 38.6 11.1 37.6 V36.1 C11.1 35.3 11.6 34.6 12.4 34.3 L13.2 34.0 C14.4 33.5 15.4 32.7 16.1 31.6 C18.1 28.6 19.1 24.5 19.4 20.5 L19.0 20.4 C18.3 20.2 17.8 19.6 17.8 18.9 V18.2 C17.8 17.4 18.4 16.8 19.2 16.8 Z' },
    { t: 'path', k: 'd', d: 'M17.9 18.9 H27.1 M19.4 20.5 H25.6 M12.6 34.2 H32.4' }
  ],
  r: [
    { t: 'path', k: 'b', d: 'M12.8 8.6 H17.0 V11.6 H20.4 V8.6 H24.6 V11.6 H28.0 V8.6 H32.2 V14.8 L29.6 17.4 C29.0 23.0 28.8 28.4 29.8 32.6 L30.6 33.0 C31.8 33.4 32.6 34.2 32.6 35.4 V37.4 C32.6 38.5 31.7 39.4 30.6 39.4 H14.4 C13.3 39.4 12.4 38.5 12.4 37.4 V35.4 C12.4 34.2 13.2 33.4 14.4 33.0 L15.2 32.6 C16.2 28.4 16.0 23.0 15.4 17.4 L12.8 14.8 Z' },
    { t: 'path', k: 'd', d: 'M15.4 17.4 H29.6 M15.2 32.8 H29.8 M12.6 35.4 H32.4' }
  ],
  n: [
    { t: 'path', k: 'b', d: 'M17.4 5.4 L19.6 7.4 C20.3 7.2 21.0 7.1 21.7 7.1 L23.6 4.6 L24.6 7.6 C27.8 9.2 30.2 12.4 31.4 16.4 C32.5 20.2 32.9 25.6 32.5 30.6 C32.4 32.0 32.5 33.4 32.7 34.6 C33.7 35.0 34.3 35.8 34.3 36.9 V37.5 C34.3 38.6 33.4 39.4 32.3 39.4 H12.7 C11.6 39.4 10.7 38.6 10.7 37.5 V36.9 C10.7 35.8 11.3 35.0 12.3 34.6 C12.8 30.6 14.0 27.0 16.2 24.0 C14.8 23.4 13.4 22.6 12.2 21.6 C11.0 20.8 9.8 20.4 9.2 19.6 C8.5 18.7 8.6 17.5 9.4 16.8 C10.2 16.1 11.4 15.8 12.6 15.8 C13.4 12.8 15.2 10.0 17.6 8.6 Z' },
    { t: 'path', k: 'd', d: 'M24.8 8.6 C27.8 10.8 29.8 14.0 30.8 17.8 C31.6 21.6 31.8 26.2 31.4 30.4 M9.8 19.2 C10.8 19.8 12.0 20.0 13.0 19.6' },
    { t: 'circle', k: 'e', cx: 14.0, cy: 14.4, r: 1.05 },
    { t: 'circle', k: 'e', cx: 10.4, cy: 17.4, r: 0.75 }
  ],
  b: [
    { t: 'circle', k: 'b', cx: 22.5, cy: 7.0, r: 2.2 },
    { t: 'path', k: 'b', d: 'M22.5 9.2 C25.8 12.4 28.2 16.6 28.2 20.6 C28.2 23.6 25.6 25.6 22.5 25.6 C19.4 25.6 16.8 23.6 16.8 20.6 C16.8 16.6 19.2 12.4 22.5 9.2 Z' },
    { t: 'path', k: 'b', d: 'M14.6 27.6 C16.4 26.2 18.0 25.4 19.6 25.0 H25.4 C27.0 25.4 28.6 26.2 30.4 27.6 C28.8 28.6 27.2 29.2 25.6 29.5 H19.4 C17.8 29.2 16.2 28.6 14.6 27.6 Z' },
    { t: 'path', k: 'b', d: 'M19.5 29.4 H25.5 C25.8 31.4 26.8 33.0 28.4 34.0 L29.4 34.5 C30.8 35.0 31.6 35.9 31.6 37.0 V37.6 C31.6 38.6 30.8 39.4 29.8 39.4 H15.2 C14.2 39.4 13.4 38.6 13.4 37.6 V37.0 C13.4 35.9 14.2 35.0 15.6 34.5 L16.6 34.0 C18.2 33.0 19.2 31.4 19.5 29.4 Z' },
    { t: 'path', k: 'd', d: 'M22.5 14.6 V20.6 M19.9 17.6 H25.1 M19.4 29.5 H25.6 M15.6 34.4 H29.4' }
  ],
  q: [
    { t: 'circle', k: 'b', cx: 8.9, cy: 11.2, r: 2.0 },
    { t: 'circle', k: 'b', cx: 15.5, cy: 8.4, r: 2.0 },
    { t: 'circle', k: 'b', cx: 22.5, cy: 7.2, r: 2.1 },
    { t: 'circle', k: 'b', cx: 29.5, cy: 8.4, r: 2.0 },
    { t: 'circle', k: 'b', cx: 36.1, cy: 11.2, r: 2.0 },
    { t: 'path', k: 'b', d: 'M9.4 12.8 L13.8 19.6 L16.0 10.6 L19.8 18.8 L22.5 9.4 L25.2 18.8 L29.0 10.6 L31.2 19.6 L35.6 12.8 L33.0 25.0 C32.2 28.2 32.6 31.4 34.2 34.2 V35.2 C35.4 35.7 36.0 36.5 36.0 37.5 V37.7 C36.0 38.7 35.2 39.4 34.2 39.4 H10.8 C9.8 39.4 9.0 38.7 9.0 37.7 V37.5 C9.0 36.5 9.6 35.7 10.8 35.2 V34.2 C12.4 31.4 12.8 28.2 12.0 25.0 Z' },
    { t: 'path', k: 'd', d: 'M12.6 25.6 C17.6 24.2 27.4 24.2 32.4 25.6 M12.2 30.4 C17.4 29.2 27.6 29.2 32.8 30.4 M10.8 35.2 H34.2' }
  ],
  k: [
    { t: 'path', k: 'x', d: 'M21.2 4.4 H23.8 V7.0 H26.4 V9.4 H23.8 V12.0 H21.2 V9.4 H18.6 V7.0 H21.2 Z' },
    { t: 'path', k: 'b', d: 'M22.5 12.2 C24.6 12.2 26.3 13.7 26.9 15.8 C27.5 18.0 26.9 20.4 25.7 22.2 C28.3 21.2 31.3 22.4 32.5 25.2 C33.7 28.0 33.1 31.5 31.5 34.3 V35.3 C32.7 35.8 33.3 36.6 33.3 37.6 V37.8 C33.3 38.8 32.5 39.4 31.5 39.4 H13.5 C12.5 39.4 11.7 38.8 11.7 37.8 V37.6 C11.7 36.6 12.3 35.8 13.5 35.3 V34.3 C11.9 31.5 11.3 28.0 12.5 25.2 C13.7 22.4 16.7 21.2 19.3 22.2 C18.1 20.4 17.5 18.0 18.1 15.8 C18.7 13.7 20.4 12.2 22.5 12.2 Z' },
    { t: 'path', k: 'd', d: 'M19.6 22.6 C21.2 23.6 23.8 23.6 25.4 22.6 M22.5 23.8 V30.8 M14.2 31.6 C18.6 30.0 26.4 30.0 30.8 31.6 M13.5 35.3 H31.5' }
  ]
}

// Paint: 3-stop ivory / graphite bodies + one diagonal sheen (light from upper-left,
// warm core-shadow at lower-right) + the shared radial ground shadow.
const gradDefs =
  `<linearGradient id="${uid}-fillw" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#FFFDF4"/><stop offset=".45" stop-color="#F2E9D3"/><stop offset="1" stop-color="#D3C29A"/></linearGradient>` +
  `<linearGradient id="${uid}-fillb" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#83858C"/><stop offset=".45" stop-color="#4B4D54"/><stop offset="1" stop-color="#1D1E22"/></linearGradient>` +
  `<linearGradient id="${uid}-sheenw" x1="0" y1="0" x2=".85" y2="1">` +
  `<stop offset="0" stop-color="#FFFFFF" stop-opacity=".5"/><stop offset=".38" stop-color="#FFFFFF" stop-opacity=".12"/><stop offset=".62" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#6B5A3A" stop-opacity=".18"/></linearGradient>` +
  `<linearGradient id="${uid}-sheenb" x1="0" y1="0" x2=".85" y2="1">` +
  `<stop offset="0" stop-color="#FFFFFF" stop-opacity=".34"/><stop offset=".38" stop-color="#FFFFFF" stop-opacity=".1"/><stop offset=".62" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".3"/></linearGradient>` +
  `<radialGradient id="${uid}-gsh">` +
  `<stop offset="0" stop-color="#000" stop-opacity=".3"/><stop offset=".65" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`

function pieceGroup(color, type) {
  const white = color === 'w'
  const F = `url(#${uid}-fill${color})`
  const SH = `url(#${uid}-sheen${color})`
  const S = white ? '#3E382B' : '#0E0E12'
  const D = white ? '#4A4436' : '#0B0B0E'
  const shadow = `<ellipse cx="22.5" cy="39.9" rx="${SHADOW_RX[type]}" ry="2.2" fill="url(#${uid}-gsh)"/>`
  const body = ART[type].map(pr => {
    if (pr.t === 'circle') {
      if (pr.k === 'e') return `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${D}"/>`
      return `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${F}" stroke="${S}" stroke-width="1.5"/>` +
             `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${SH}"/>`
    }
    if (pr.k === 'b') {
      return `<path d="${pr.d}" fill="${F}" stroke="${S}" stroke-width="1.5" stroke-linejoin="round"/>` +
             `<path d="${pr.d}" fill="${SH}"/>`
    }
    if (pr.k === 'x') {
      return `<path d="${pr.d}" fill="${F}" stroke="${S}" stroke-width="1.4" stroke-linejoin="round"/>`
    }
    return `<path d="${pr.d}" fill="none" stroke="${D}" stroke-opacity="${white ? 0.85 : 0.8}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('')
  return `<g id="${uid}-${color}${type}">${shadow}${body}</g>`
}
const defsMarkup = '<defs>' + gradDefs + '</defs>' +
  ['w', 'b'].map(c => Object.keys(ART).map(t => pieceGroup(c, t)).join('')).join('')
const useHref = p => `#${uid}-${p.color}${p.type}`
const pieceViewBox = computed(() => {
  const h = ART_H / cfg.pieceScale
  return `${(ART_CX - h / 2).toFixed(2)} ${(ART_CY - h / 2).toFixed(2)} ${h.toFixed(2)} ${h.toFixed(2)}`
})

/* ════════════════════════ 3 · STATE ════════════════════════ */
let chess = new Chess()
let idSeq = 1
const pieces = ref([])
const turn = ref('w')
const checkSq = ref(null)
const selected = ref(null)
const dests = ref([])
const hoverSq = ref(null)
const draggingId = ref(null)
const dragMoved = ref(false)
let dragState = null
const promo = ref(null)
const userShapes = ref([])
const shapePreview = ref(null)
let shapeDrag = null
const suppressAnim = ref(false)
const rootCursor = ref('default')
const rootEl = ref(null)
const piecesLayer = ref(null)
const boardW = ref(0)
let ro = null
let dragRaf = 0, pendX = 0, pendY = 0
let rectCache = null   // board rect, cached only while a drag / arrow-draw is running

const timers = new Set()
function later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }
function stopTimer(t) { if (t) { clearTimeout(t); timers.delete(t) } }
const morphs = []
function flushMorphs() {
  for (const m of morphs) { stopTimer(m.t); m.p.type = m.type; m.p.pop = false }
  morphs.length = 0
}

/* ════════════════════════ 4 · GEOMETRY ════════════════════════ */
const fileOf = sq => sq.charCodeAt(0) - 97
const rankOf = sq => +sq[1] - 1
function sqToXY(sq) {
  const f = fileOf(sq), r = rankOf(sq)
  return cfg.orientation === 'white' ? { col: f, row: 7 - r } : { col: 7 - f, row: r }
}
const snap = v => { const d = window.devicePixelRatio || 1; return Math.round(v * d) / d }
const cellSize = computed(() => boardW.value > 0 ? snap(boardW.value / 8) + 'px' : null)
function gridTransform(sq) {
  const { col, row } = sqToXY(sq)
  if (boardW.value > 0) return `translate(${snap(col * boardW.value / 8)}px, ${snap(row * boardW.value / 8)}px)`
  return `translate(${col * 100}%, ${row * 100}%)`
}
function getRect() {
  if ((dragState || shapeDrag) && rectCache) return rectCache
  return rootEl.value.getBoundingClientRect()
}
function sqFromEvent(e) {
  if (!rootEl.value) return null
  const rect = getRect()
  const col = Math.floor((e.clientX - rect.left) / rect.width * 8)
  const row = Math.floor((e.clientY - rect.top) / rect.height * 8)
  if (col < 0 || col > 7 || row < 0 || row > 7) return null
  const f = cfg.orientation === 'white' ? col : 7 - col
  const r = cfg.orientation === 'white' ? 7 - row : row
  return 'abcdefgh'[f] + (r + 1)
}
const sqStyle = sq => {
  const { col, row } = sqToXY(sq)
  return { transform: `translate(${col * 100}%, ${row * 100}%)` }
}
function pieceStyle(p) {
  const dragging = dragMoved.value && p.id === draggingId.value
  const s = {
    // While dragging, position comes from CSS variables written directly to the element.
    // The string never changes, so a Vue re-render cannot reset the piece.
    transform: dragging ? 'translate3d(var(--dx, 0px), var(--dy, 0px), 0)' : gridTransform(p.square),
    zIndex: p.captured ? 5 : (dragging ? 60 : p.moving ? 30 : 10)
  }
  if (cellSize.value) { s.width = cellSize.value; s.height = cellSize.value }
  if (p.ms) s['--cb-move-ms'] = p.ms + 'ms'
  return s
}
const pieceAt = sq => pieces.value.find(p => !p.captured && p.square === sq)
const byId = id => pieces.value.find(p => p.id === id)
const dist = (a, b) => { const dx = fileOf(a) - fileOf(b), dy = rankOf(a) - rankOf(b); return dx * dx + dy * dy }
// longer trips take a little longer (short hop ≈ 0.9x, full board ≈ 1.45x)
const travelMs = (a, b) => Math.round(moveMs.value * Math.min(1.45, 0.8 + 0.09 * Math.sqrt(dist(a, b))))

/* ════════════════════════ 5 · POSITION & ANIMATED DIFF ════════════════════════ */
function layoutOf(c) {
  const out = [], board = c.board()
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f]
    if (p) out.push({ square: 'abcdefgh'[f] + (8 - r), color: p.color, type: p.type })
  }
  return out
}
function safeInCheck() {
  try { return typeof chess.isCheck === 'function' ? chess.isCheck() : chess.inCheck() } catch { return false }
}
function kingSq(color) {
  const k = pieces.value.find(p => !p.captured && p.type === 'k' && p.color === color)
  return k ? k.square : null
}
function refreshCheck() {
  if (cfg.highlight.check === false || cfg.check === false) { checkSq.value = null; return }
  const c = cfg.check
  if (typeof c === 'string') {
    if (c === 'white' || c === 'black') checkSq.value = kingSq(c === 'white' ? 'w' : 'b')
    else checkSq.value = /^[a-h][1-8]$/.test(c) ? c : null
    return
  }
  checkSq.value = (c === true || safeInCheck()) ? kingSq(turn.value) : null
}
function afterPositionChange() {
  turn.value = chess.turn()
  selected.value = null
  dests.value = []
  refreshCheck()
  emit('update:fen', chess.fen())
}
function endDragVisual() {
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0 }
  dragState = null
  rectCache = null
  draggingId.value = null
  dragMoved.value = false
  hoverSq.value = null
  rootCursor.value = 'default'
}
function cancelTransient() {
  if (promo.value) cancelPromo()
  endDragVisual()
  shapeDrag = null
  shapePreview.value = null
  selected.value = null
  dests.value = []
}
async function withoutAnim(fn) {
  suppressAnim.value = true
  fn()
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(() => { suppressAnim.value = false }))
}
// The taken piece just shrinks away under the arriving one — no sparks, no ring.
function capturePiece(p) {
  if (!p || p.captured) return
  p.captured = true
  later(() => { pieces.value = pieces.value.filter(x => x.id !== p.id) }, 240)
}
// start the "travelling" state of a piece (lift animation + z-index)
function boost(p, from) {
  if (p.snap) return   // piece was dropped by hand: it is already in place
  p.ms = from && from !== p.square ? travelMs(from, p.square) : moveMs.value
  p.moving = true
  stopTimer(p._mt)
  p._mt = later(() => { p.moving = false }, p.ms + 90)
}
// landing squash for a piece that arrives on a capture
function markLand(p) {
  p.land = true
  later(() => { p.land = false }, (p.ms || moveMs.value) + 120)
}
function scheduleMorph(p, type, delay) {
  const m = { p, type, t: null }
  m.t = later(() => {
    const i = morphs.indexOf(m); if (i >= 0) morphs.splice(i, 1)
    p.type = type
    p.pop = true
    later(() => { p.pop = false }, 360)
  }, delay + 20)
  morphs.push(m)
}
function addSpawn(t, delay) {
  const p = reactive({
    id: idSeq++, color: t.color, type: t.type, square: t.square,
    captured: false, moving: false, land: false, pop: false, snap: false, ms: 0,
    spawn: true, spawnDelay: delay, _mt: null
  })
  pieces.value.push(p)
  later(() => { p.spawn = false }, 460 + delay)
  return p
}
function applyLayout(target, { animate = true, hint, moveHint } = {}) {
  flushMorphs()
  const run = () => {
    const old = pieces.value.filter(p => !p.captured)
    const used = new Set()
    const pending = []
    for (const t of target) {
      const hit = old.find(p => !used.has(p.id) && p.square === t.square && p.color === t.color && p.type === t.type)
      if (hit) { used.add(hit.id); hit.spawn = false; hit.pop = false }
      else pending.push(t)
    }
    const remaining = old.filter(p => !used.has(p.id))
    remaining.forEach(p => { p._taken = false })
    let spawnIdx = 0
    for (const t of pending) {
      let cands = remaining.filter(p => !p._taken && p.color === t.color && p.type === t.type)
      let morph = false
      if (!cands.length && 'qrbn'.includes(t.type) && t.square[1] === (t.color === 'w' ? '8' : '1')) {
        cands = remaining.filter(p => !p._taken && p.color === t.color && p.type === 'p' && dist(p.square, t.square) <= 2)
        morph = cands.length > 0
      }
      if (cands.length) {
        let pick = null
        if (moveHint && moveHint.to === t.square) pick = cands.find(p => p.square === moveHint.from)
        if (!pick && hint && hint[1] === t.square) pick = cands.find(p => p.square === hint[0])
        if (!pick) { cands.sort((a, b) => dist(a.square, t.square) - dist(b.square, t.square)); pick = cands[0] }
        pick._taken = true
        const fromSq = pick.square
        const takes = remaining.some(q => !q._taken && q.square === t.square)
        pick.square = t.square
        pick.spawn = false
        boost(pick, fromSq)
        if (takes) markLand(pick)
        if (morph) scheduleMorph(pick, t.type, animate ? moveMs.value : 0)
        else pick.type = t.type
      } else {
        addSpawn(t, animate ? spawnIdx++ * 14 : 0)
      }
    }
    for (const p of remaining) if (!p._taken) capturePiece(p)
    remaining.forEach(p => { delete p._taken })
  }
  if (animate && animOn.value) run()
  else withoutAnim(run)
}
function setPosition(fen, opts = {}) {
  let next
  try { next = new Chess(fen) } catch (e) { console.warn('[TheChessboard] invalid FEN:', fen); return false }
  cancelTransient()
  if (fen === chess.fen()) { chess = next; afterPositionChange(); return true }
  const animate = opts.animate !== false && animOn.value
  applyLayout(layoutOf(next), { animate, hint: lastMove.value })
  chess = next
  afterPositionChange()
  return true
}
function applyMoveVisual(mv, { moverId, skipCapture, snap: dropped } = {}) {
  flushMorphs()
  const mover = moverId ? byId(moverId) : pieceAt(mv.from)
  if (!mover) { applyLayout(layoutOf(chess), { animate: animOn.value, moveHint: mv }); return }
  if (mv.captured && !skipCapture) {
    const capSq = mv.flags.includes('e') ? mv.to[0] + mv.from[1] : mv.to
    const cap = pieces.value.find(p => !p.captured && p.square === capSq && p.id !== mover.id)
    if (cap) capturePiece(cap)
  }
  const fromSq = mover.square
  mover.square = mv.to
  mover.spawn = false
  if (dropped) {
    // dropped by hand → no second slide, just settle
    mover.snap = true
    later(() => { mover.snap = false }, 90)
  }
  boost(mover, fromSq)
  if (mv.captured) markLand(mover)
  if (mv.flags.includes('k') || mv.flags.includes('q')) {
    const kingside = mv.flags.includes('k')
    const [rf, rt] = mv.color === 'w'
      ? (kingside ? ['h1', 'f1'] : ['a1', 'd1'])
      : (kingside ? ['h8', 'f8'] : ['a8', 'd8'])
    const rook = pieceAt(rf)
    if (rook) later(() => { const f0 = rook.square; rook.square = rt; boost(rook, f0) }, Math.min(60, moveMs.value * 0.3))
  }
  if (mv.promotion) scheduleMorph(mover, mv.promotion, animOn.value ? moveMs.value : 0)
}
function movePayload(mv) {
  return {
    color: mv.color, from: mv.from, to: mv.to, piece: mv.piece,
    captured: mv.captured, promotion: mv.promotion, san: mv.san, flags: mv.flags,
    uci: mv.from + mv.to + (mv.promotion || '')
  }
}
function commitMove({ from, to, promotion }, visualOpts = {}, { silent = false } = {}) {
  let mv
  try { mv = chess.move({ from, to, promotion: promotion || undefined }) } catch { return null }
  if (!mv) return null
  applyMoveVisual(mv, visualOpts)
  lastMove.value = [mv.from, mv.to]
  afterPositionChange()
  if (!silent) emit('move', movePayload(mv))
  return mv
}

/* ════════════════════════ 6 · INTERACTION ════════════════════════ */
const colorAllowed = c => {
  const mc = cfg.movable.color
  return !mc || mc === 'both' || mc === (c === 'w' ? 'white' : 'black')
}
const canMovePiece = p =>
  !cfg.viewOnly && !promo.value && p && !p.captured &&
  (cfg.movable.free || p.color === turn.value) && colorAllowed(p.color)

function select(sq) {
  selected.value = sq
  if (cfg.movable.free) {
    dests.value = []
    for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) {
      const s = 'abcdefgh'[f] + r
      if (s !== sq) dests.value.push({ to: s })
    }
  } else {
    try { dests.value = chess.moves({ square: sq, verbose: true }) } catch { dests.value = [] }
  }
}
function deselect() { selected.value = null; dests.value = [] }

const CASTLE_ROOK_DROP = { h1: 'g1', a1: 'c1', h8: 'g8', a8: 'c8' }
function tryCommit(from, to, dropped = false) {
  let ms = dests.value.filter(m => m.to === to)
  if (!ms.length && CASTLE_ROOK_DROP[to]) {
    const alt = CASTLE_ROOK_DROP[to]
    const p = pieceAt(from)
    if (p && p.type === 'k') ms = dests.value.filter(m => m.to === alt)
    if (ms.length) to = alt
  }
  if (cfg.movable.free) { commitFree(from, to, dropped); return }
  if (!ms.length) { deselect(); return }
  if (ms[0].promotion && !cfg.promotion.autoQueen) { openPromo(from, to, dropped); return }
  const m = ms.find(x => x.promotion === 'q') || ms[0]
  commitMove({ from, to, promotion: m.promotion }, { snap: dropped })
}
function commitFree(from, to, dropped = false) {
  const mover = pieceAt(from)
  if (!mover) return
  const cap = pieces.value.find(p => !p.captured && p.square === to && p.id !== mover.id)
  if (cap) capturePiece(cap)
  try {
    chess.remove(from); chess.remove(to)
    chess.put({ type: mover.type, color: mover.color }, to)
  } catch {}
  mover.square = to
  if (dropped) { mover.snap = true; later(() => { mover.snap = false }, 90) }
  boost(mover, from)
  if (cap) markLand(mover)
  lastMove.value = [from, to]
  afterPositionChange()
  emit('move', { color: mover.color, from, to, piece: mover.type, captured: cap ? cap.type : undefined, uci: from + to })
}

/* promotion */
function openPromo(from, to, dropped = false) {
  const mover = pieceAt(from)
  if (!mover) return
  const cap = pieces.value.find(p => !p.captured && p.square === to && p.id !== mover.id)
  promo.value = { from, to, color: mover.color, moverId: mover.id, capId: cap ? cap.id : null }
  mover.square = to
  if (dropped) { mover.snap = true; later(() => { mover.snap = false }, 90) }
  boost(mover, from)
  deselect()
}
function choosePromo(type) {
  if (!promo.value) return
  const { from, to, moverId, capId } = promo.value
  promo.value = null
  if (capId) capturePiece(byId(capId))
  commitMove({ from, to, promotion: type }, { moverId, skipCapture: true })
}
function cancelPromo() {
  if (!promo.value) return
  const p = byId(promo.value.moverId)
  if (p) p.square = promo.value.from
  promo.value = null
  deselect()
}
const promoOptions = ['q', 'n', 'r', 'b']
const promoNames = { q: 'queen', n: 'knight', r: 'rook', b: 'bishop' }
function promoBtnStyle(i) {
  if (!promo.value) return {}
  const { col, row } = sqToXY(promo.value.to)
  const dir = row === 0 ? 1 : -1
  const r = row + i * dir
  return { transform: `translate(${col * 100}%, ${r * 100}%)`, animationDelay: `${i * 35}ms` }
}

/* pointer — the dragged piece is moved through CSS variables, throttled with rAF */
function applyDragVars() {
  const d = dragState
  if (d && d.el) {
    d.el.style.setProperty('--dx', pendX + 'px')
    d.el.style.setProperty('--dy', pendY + 'px')
  }
}
function placeDrag(e, now) {
  const r = rectCache || rootEl.value.getBoundingClientRect()
  pendX = e.clientX - r.left - r.width / 16
  pendY = e.clientY - r.top - r.width / 16
  if (now) { applyDragVars(); return }
  if (dragRaf) return
  dragRaf = requestAnimationFrame(() => { dragRaf = 0; applyDragVars() })
}
function onPointerDown(e) {
  const sq = sqFromEvent(e)
  if (sq == null) return
  if (e.button === 2) {
    if (cfg.drawable.enabled === false || promo.value) return
    rectCache = rootEl.value.getBoundingClientRect()
    shapeDrag = { orig: sq, pid: e.pointerId }
    shapePreview.value = { orig: sq, dest: sq, brush: 'green', preview: true }
    try { rootEl.value.setPointerCapture(e.pointerId) } catch {}
    return
  }
  if (e.button !== 0) return
  if (userShapes.value.length) userShapes.value = []
  if (promo.value || cfg.viewOnly || dragState) return
  if (selected.value && dests.value.some(m => m.to === sq)) { tryCommit(selected.value, sq); return }
  const p = pieceAt(sq)
  if (canMovePiece(p)) {
    const wasSel = selected.value === sq
    select(sq)
    if (cfg.draggable.enabled !== false) {
      const el = piecesLayer.value ? piecesLayer.value.querySelector(`[data-pid="${p.id}"]`) : null
      rectCache = rootEl.value.getBoundingClientRect()
      dragState = { id: p.id, from: sq, x0: e.clientX, y0: e.clientY, moved: false, wasSel, pid: e.pointerId, el }
      draggingId.value = p.id
      try { rootEl.value.setPointerCapture(e.pointerId) } catch {}
    }
  } else {
    deselect()
  }
}
function onPointerMove(e) {
  if (shapeDrag && e.pointerId === shapeDrag.pid) {
    const to = sqFromEvent(e)
    if (to != null && (!shapePreview.value || shapePreview.value.dest !== to)) {
      shapePreview.value = { orig: shapeDrag.orig, dest: to, brush: 'green', preview: true }
    }
    return
  }
  const d = dragState
  if (d && e.pointerId === d.pid) {
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 3) {
      d.moved = true
      placeDrag(e, true)          // write position BEFORE Vue switches the piece to drag mode
      dragMoved.value = true
      rootCursor.value = 'grabbing'
    } else if (d.moved) {
      placeDrag(e, false)
    }
    if (d.moved) {
      const h = sqFromEvent(e)
      if (h !== hoverSq.value) hoverSq.value = h
    }
    return
  }
  if (promo.value) return
  const sq = sqFromEvent(e)
  if (sq == null) { rootCursor.value = 'default'; return }
  const p = pieceAt(sq)
  if (canMovePiece(p)) rootCursor.value = 'grab'
  else if (selected.value && dests.value.some(m => m.to === sq)) rootCursor.value = 'pointer'
  else rootCursor.value = 'default'
}
function finishDrag(e, cancelled) {
  const d = dragState
  if (!d || (e && e.pointerId !== d.pid)) return false
  const wasMoved = d.moved, from = d.from, wasSel = d.wasSel
  const to = (!cancelled && wasMoved && e) ? sqFromEvent(e) : null   // uses the cached rect
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0 }
  dragState = null
  rectCache = null
  draggingId.value = null
  dragMoved.value = false
  hoverSq.value = null
  rootCursor.value = 'default'
  if (cancelled) { deselect(); return true }
  if (wasMoved) {
    const legal = to && dests.value.some(m => m.to === to || (CASTLE_ROOK_DROP[to] && m.to === CASTLE_ROOK_DROP[to]))
    if (legal || (cfg.movable.free && to && to !== from)) {
      tryCommit(from, to, true)
    } else {
      deselect()   // piece glides back by itself (CSS transition)
    }
  } else if (wasSel) {
    deselect()
  }
  return true
}
function toggleShape(orig, dest) {
  const key = s => s.orig + (s.dest || '')
  const want = dest && dest !== orig ? { orig, dest, brush: 'green' } : { orig, brush: 'green' }
  const i = userShapes.value.findIndex(s => key(s) === key(want))
  if (i >= 0) userShapes.value.splice(i, 1)
  else userShapes.value.push(want)
}
function onPointerUp(e) {
  if (shapeDrag && e.pointerId === shapeDrag.pid) {
    const orig = shapeDrag.orig
    const to = sqFromEvent(e)
    shapeDrag = null
    rectCache = null
    shapePreview.value = null
    if (to != null) toggleShape(orig, to)
    return
  }
  finishDrag(e, false)
}
function onPointerCancel(e) {
  if (shapeDrag && e.pointerId === shapeDrag.pid) { shapeDrag = null; rectCache = null; shapePreview.value = null; return }
  finishDrag(e, true)
}
function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (promo.value) cancelPromo()
  else if (dragState) finishDrag(null, true)
  else if (selected.value) deselect()
}

/* ════════════════════════ 7 · SHAPES (arrows & circles) ════════════════════════ */
const BRUSHES = {
  green: '#2F9E63', g: '#2F9E63',
  red: '#D9534F', r: '#D9534F',
  blue: '#4C8FD6', b: '#4C8FD6',
  yellow: '#E2A63B', y: '#E2A63B'
}
const renderedShapes = computed(() => {
  if (cfg.drawable.visible === false) return []
  const all = [...(cfg.drawable.autoShapes || []), ...userShapes.value]
  if (shapePreview.value) all.push(shapePreview.value)
  const out = []
  all.forEach((s, i) => {
    if (!s || !s.orig) return
    const color = BRUSHES[s.brush] || BRUSHES.green
    const opacity = s.preview ? 0.55 : 0.92
    const a = sqToXY(s.orig)
    const x1 = a.col + 0.5, y1 = a.row + 0.5
    if (!s.dest || s.dest === s.orig) {
      out.push({ key: `c${i}-${s.orig}-${s.preview ? 'p' : 'u'}`, circle: true, cx: x1, cy: y1, color, opacity, preview: !!s.preview })
      return
    }
    const b = sqToXY(s.dest)
    const x2 = b.col + 0.5, y2 = b.row + 0.5
    const dx = x2 - x1, dy = y2 - y1
    const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1)
    let path, ux, uy
    if (knight) {
      const bend = Math.abs(dx) > Math.abs(dy) ? { x: x2, y: y1 } : { x: x1, y: y2 }
      const len2 = Math.hypot(x2 - bend.x, y2 - bend.y) || 1
      ux = (x2 - bend.x) / len2; uy = (y2 - bend.y) / len2
      path = `M ${x1} ${y1} L ${bend.x} ${bend.y} L ${x2 - ux * 0.5} ${y2 - uy * 0.5}`
    } else {
      const len = Math.hypot(dx, dy) || 1
      ux = dx / len; uy = dy / len
      path = `M ${x1 + ux * 0.22} ${y1 + uy * 0.22} L ${x2 - ux * 0.5} ${y2 - uy * 0.5}`
    }
    const px = -uy, py = ux
    const bx = x2 - ux * 0.5, by = y2 - uy * 0.5
    const head = `${x2 - ux * 0.06},${y2 - uy * 0.06} ${bx + px * 0.3},${by + py * 0.3} ${bx - px * 0.3},${by - py * 0.3}`
    out.push({
      key: `a${i}-${s.orig}-${s.dest}-${s.preview ? 'p' : 'u'}`,
      path, head, color, opacity, preview: !!s.preview,
      gid: `${uid}-ag${i}`, gx1: x1, gy1: y1, gx2: x2, gy2: y2
    })
  })
  return out
})

/* ════════════════════════ 8 · HIGHLIGHTS · COORDS · BADGES ════════════════════════ */
const highlights = computed(() => {
  const out = []
  const add = (key, square, cls, extra) => out.push({ key, square, cls, style: { ...sqStyle(square), ...extra } })
  if (cfg.highlight.lastMove !== false && lastMove.value) {
    add('lf' + lastMove.value[0], lastMove.value[0], 'last-move')
    add('lt' + lastMove.value[1], lastMove.value[1], 'last-move')
  }
  if (selected.value) add('sel' + selected.value, selected.value, 'selected')
  if (checkSq.value) add('ck' + checkSq.value, checkSq.value, 'check')
  if (hoverSq.value != null && dragMoved.value) {
    const h = hoverSq.value
    const legal = dests.value.some(m => m.to === h || (CASTLE_ROOK_DROP[h] && m.to === CASTLE_ROOK_DROP[h]))
    if (legal) add('hv' + h, h, 'hover')
  }
  if (selected.value && cfg.movable.showDests !== false && !cfg.movable.free) {
    const seen = new Set()
    for (const m of dests.value) {
      if (seen.has(m.to)) continue
      seen.add(m.to)
      // hints ripple outward from the selected piece
      const delay = Math.min(150, Math.round(Math.sqrt(dist(selected.value, m.to)) * 20))
      add('d' + m.to, m.to, m.captured ? 'ring' : 'dot', { '--d': delay + 'ms' })
    }
  }
  return out
})
const badgeList = computed(() =>
  (cfg.badges || [])
    .filter(b => b && /^[a-h][1-8]$/.test(b.square || '') && b.src)
    .map(b => ({
      key: b.square + '|' + b.src,
      square: b.square,
      src: b.src,
      label: b.label || '',
      size: Math.min(60, Math.max(16, Number(b.size) || 36))
    }))
)
const coordLabels = computed(() => {
  if (!cfg.coordinates) return []
  const out = []
  const white = cfg.orientation === 'white'
  const lightAt = (f, r) => (f + r) % 2 === 1
  for (let row = 0; row < 8; row++) {
    const f = white ? 0 : 7, r = white ? 7 - row : row
    out.push({
      key: 'r' + row, text: String(r + 1), onLight: lightAt(f, r),
      style: { left: '0%', top: row * 12.5 + '%', width: '12.5%', height: '12.5%', alignItems: 'flex-start', justifyContent: 'flex-start', padding: '0.6cqi 0 0 0.8cqi' }
    })
  }
  for (let col = 0; col < 8; col++) {
    const f = white ? col : 7 - col, r = white ? 0 : 7
    out.push({
      key: 'f' + col, text: 'abcdefgh'[f], onLight: lightAt(f, r),
      style: { left: col * 12.5 + '%', top: '87.5%', width: '12.5%', height: '12.5%', alignItems: 'flex-end', justifyContent: 'flex-end', padding: '0 0.8cqi 0.5cqi 0' }
    })
  }
  return out
})
const rootStyle = computed(() => {
  const s = { '--cb-move-ms': moveMs.value + 'ms', cursor: rootCursor.value }
  if (cfg.colors?.light) s['--cb-light'] = cfg.colors.light
  if (cfg.colors?.dark) s['--cb-dark'] = cfg.colors.dark
  return s
})

/* ════════════════════════ 9 · PUBLIC API ════════════════════════ */
function toggleOrientation() { cfg.orientation = cfg.orientation === 'white' ? 'black' : 'white' }
function setBadges(list) { cfg.badges = Array.isArray(list) ? list.slice() : [] }
function apiMove(m) {
  let req = m
  if (typeof m === 'string') {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) {
      req = { from: m.slice(0, 2), to: CASTLE_ROOK_DROP[m.slice(0, 4)] || m.slice(2, 4), promotion: m[4] }
    } else {
      let mv
      try { mv = chess.move(m) } catch { return null }
      if (!mv) return null
      applyMoveVisual(mv)
      lastMove.value = [mv.from, mv.to]
      afterPositionChange()
      return mv
    }
  }
  if (!req || !req.from || !req.to) return null
  return commitMove(
    { from: req.from, to: CASTLE_ROOK_DROP[req.from + req.to] || req.to, promotion: req.promotion },
    {}, { silent: true }
  )
}
const guard = fn => (...a) => { try { return typeof chess[fn] === 'function' ? chess[fn](...a) : undefined } catch { return undefined } }
const api = {
  setPosition,
  setConfig,
  setBadges,
  toggleOrientation,
  setOrientation: o => { if (o === 'white' || o === 'black') cfg.orientation = o },
  getOrientation: () => cfg.orientation,
  setPieceScale: n => applyConfig({ pieceScale: n }),
  move: apiMove,
  undoMove: () => { const mv = chess.undo(); if (!mv) return null; setPosition(chess.fen()); lastMove.value = undefined; return mv },
  resetBoard: () => { chess.reset(); setPosition(chess.fen()); lastMove.value = undefined },
  getFen: () => chess.fen(),
  getPgn: () => chess.pgn(),
  loadPgn: pgn => { try { chess.loadPgn(pgn) } catch { return false } setPosition(chess.fen()); return true },
  getHistory: verbose => { try { return chess.history(verbose ? { verbose: true } : undefined) } catch { return [] } },
  getTurnColor: () => (turn.value === 'w' ? 'white' : 'black'),
  getIsCheck: guard('isCheck'),
  getIsCheckmate: guard('isCheckmate'),
  getIsStalemate: guard('isStalemate'),
  getIsDraw: guard('isDraw'),
  getIsInsufficientMaterial: guard('isInsufficientMaterial'),
  getIsThreefoldRepetition: guard('isThreefoldRepetition'),
  getIsGameOver: guard('isGameOver'),
  setShapes: s => { userShapes.value = Array.isArray(s) ? [...s] : [] },
  getShapes: () => [...userShapes.value],
  clearShapes: () => { userShapes.value = [] },
  setAutoShapes: s => { cfg.drawable.autoShapes = Array.isArray(s) ? [...s] : [] },
  cancelPromotion: cancelPromo,
  getChess: () => chess,
  redraw: () => {}, resize: () => {}
}
defineExpose({ api, setPosition, setConfig, setBadges, toggleOrientation })
watch(() => props.fen, f => { if (f && f !== chess.fen()) setPosition(f) })

/* ════════════════════════ 10 · LIFECYCLE ════════════════════════ */
onMounted(async () => {
  applyConfig(props.boardConfig || {})
  if (props.fen) { try { chess = new Chess(props.fen) } catch {} }
  turn.value = chess.turn()
  layoutOf(chess).forEach((t, i) => addSpawn(t, animOn.value ? 60 + i * 9 : 0))
  refreshCheck()
  window.addEventListener('keydown', onKeydown)
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width
      const prev = boardW.value
      if (prev > 0 && Math.abs(w - prev) > 0.5) withoutAnim(() => { boardW.value = w })
      else boardW.value = w
    })
    ro.observe(rootEl.value)
  }
  await nextTick()
  emit('board-created', api)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (ro) ro.disconnect()
  if (dragRaf) cancelAnimationFrame(dragRaf)
  for (const t of timers) clearTimeout(t)
  timers.clear()
  morphs.length = 0
})
</script>

<template>
  <div
    ref="rootEl"
    class="cb-root"
    :class="{ 'cb-no-anim': !animOn || suppressAnim }"
    :data-cb-theme="cfg.theme"
    :style="rootStyle"
    role="application"
    aria-label="Chessboard"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @contextmenu.prevent
  >
    <svg class="cb-defs" aria-hidden="true" focusable="false" v-html="defsMarkup"></svg>

    <div class="cb-board" aria-hidden="true"></div>

    <div class="cb-layer" aria-hidden="true">
      <div v-for="h in highlights" :key="h.key" class="cb-square" :class="h.cls" :style="h.style"></div>
    </div>

    <div class="cb-layer" aria-hidden="true">
      <span
        v-for="c in coordLabels" :key="c.key"
        class="cb-coord" :class="c.onLight ? 'on-light' : 'on-dark'"
        :style="c.style"
      >{{ c.text }}</span>
    </div>

    <div ref="piecesLayer" class="cb-layer cb-pieces" aria-hidden="true">
      <div
        v-for="p in pieces" :key="p.id"
        :data-pid="p.id"
        class="cb-piece"
        :class="{ dragging: dragMoved && p.id === draggingId, captured: p.captured, spawn: p.spawn, moving: p.moving, land: p.land, snap: p.snap }"
        :style="pieceStyle(p)"
      >
        <div
          class="cb-piece-inner"
          :class="{ pop: p.pop }"
          :style="{ animationDelay: p.spawn ? p.spawnDelay + 'ms' : undefined }"
        >
          <svg :viewBox="pieceViewBox"><use :href="useHref(p)" /></svg>
        </div>
      </div>
    </div>

    <svg class="cb-shapes" viewBox="0 0 8 8" aria-hidden="true">
      <g v-for="s in renderedShapes" :key="s.key" :opacity="s.opacity" :class="{ 'cb-shape-in': !s.preview }">
        <template v-if="s.circle">
          <circle :cx="s.cx" :cy="s.cy" r="0.43" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="0.19" />
          <circle :cx="s.cx" :cy="s.cy" r="0.43" :fill="s.color" fill-opacity="0.12" :stroke="s.color" stroke-width="0.11" />
        </template>
        <template v-else>
          <linearGradient :id="s.gid" gradientUnits="userSpaceOnUse" :x1="s.gx1" :y1="s.gy1" :x2="s.gx2" :y2="s.gy2">
            <stop offset="0" :stop-color="s.color" stop-opacity="0.5" />
            <stop offset="1" :stop-color="s.color" stop-opacity="1" />
          </linearGradient>
          <path :d="s.path" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="0.32" stroke-linecap="round" stroke-linejoin="round" />
          <path :d="s.path" fill="none" :stroke="`url(#${s.gid})`" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round" />
          <polygon :points="s.head" fill="rgba(0,0,0,0.16)" stroke="rgba(0,0,0,0.16)" stroke-width="0.1" stroke-linejoin="round" />
          <polygon :points="s.head" :fill="s.color" :stroke="s.color" stroke-width="0.06" stroke-linejoin="round" />
        </template>
      </g>
    </svg>

    <!-- classification badges: always painted above the pieces -->
    <div class="cb-layer cb-badges">
      <div v-for="b in badgeList" :key="b.key" class="cb-badge" :style="sqStyle(b.square)">
        <img
          :src="b.src"
          :alt="b.label"
          :title="b.label"
          :style="{ width: b.size + '%', height: b.size + '%' }"
          draggable="false"
        />
      </div>
    </div>

    <div v-if="promo" class="cb-promo-scrim" @pointerdown.stop="cancelPromo"></div>
    <template v-if="promo">
      <button
        v-for="(t, i) in promoOptions" :key="t"
        type="button"
        class="cb-promo-btn"
        :style="promoBtnStyle(i)"
        :aria-label="'Promote to ' + promoNames[t]"
        @pointerdown.stop
        @click.stop="choosePromo(t)"
      >
        <svg :viewBox="pieceViewBox"><use :href="`#${uid}-${promo.color}${t}`" /></svg>
      </button>
    </template>
  </div>
</template>

<style scoped>
.cb-root {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  container-type: inline-size;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  border-radius: 6px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35), 0 14px 34px -18px rgba(0, 0, 0, 0.6);
  --_l: #C6D2DE; --_d: #4B7CA6;
}
.cb-root[data-cb-theme='emerald']  { --_l: #EEEED2; --_d: #6E9457; }
.cb-root[data-cb-theme='walnut']   { --_l: #F0D9B5; --_d: #B58863; }
.cb-root[data-cb-theme='glacier']  { --_l: #D8E2EC; --_d: #5B7C99; }
.cb-root[data-cb-theme='rosewood'] { --_l: #F0DCD4; --_d: #A2635C; }

.cb-defs { position: absolute; width: 0; height: 0; overflow: hidden; }

.cb-board {
  position: absolute; inset: 0; border-radius: inherit;
  background: repeating-conic-gradient(var(--cb-dark, var(--_d)) 0% 25%, var(--cb-light, var(--_l)) 0% 50%) 0 0 / 25% 25%;
}
.cb-board::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: radial-gradient(120% 120% at 50% 42%, transparent 62%, rgba(8, 12, 9, 0.16));
}

.cb-layer { position: absolute; inset: 0; pointer-events: none; }

/* ── square highlights ── */
.cb-square { position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%; animation: cb-fade 0.18s ease-out; }
.cb-square.last-move {
  background: var(--last-move-highlight, rgba(255, 210, 90, 0.34));
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.16);
}
.cb-square.selected {
  background: var(--cb-selected, rgba(255, 214, 102, 0.5));
  box-shadow: inset 0 0 0 2px rgba(255, 240, 180, 0.55), inset 0 0 14px rgba(255, 255, 255, 0.18);
}
.cb-square.check {
  animation: cb-check 1.2s ease-in-out infinite;
  background: radial-gradient(circle at 50% 50%,
    rgba(255, 74, 58, 0.95) 0, rgba(232, 62, 48, 0.58) 36%, rgba(232, 62, 48, 0.2) 60%, transparent 76%);
}
.cb-square.hover {
  background: rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 0 0 2.5px rgba(255, 255, 255, 0.85), inset 0 0 16px rgba(255, 255, 255, 0.25);
}
.cb-square.dot::after, .cb-square.ring::after {
  content: ''; position: absolute; inset: 0;
  animation: cb-pop 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.3) backwards;
  animation-delay: var(--d, 0ms);
}
.cb-square.dot::after  { background: radial-gradient(circle, rgba(16, 24, 34, 0.32) 0 16%, rgba(16, 24, 34, 0.2) 19%, rgba(16, 24, 34, 0) 22%); }
.cb-square.ring::after { background: radial-gradient(circle, rgba(0, 0, 0, 0) 0 54%, rgba(16, 24, 34, 0.3) 57% 66%, rgba(0, 0, 0, 0) 69%); }

.cb-coord {
  position: absolute; display: flex; line-height: 1; pointer-events: none;
  font: 700 clamp(8px, 2.4cqi, 12px) / 1 system-ui, sans-serif;
}
.cb-coord.on-light { color: var(--cb-dark, var(--_d)); }
.cb-coord.on-dark  { color: var(--cb-light, var(--_l)); }

/* ── pieces ── */
.cb-pieces { z-index: 10; }
.cb-piece {
  position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%;
  transition: transform var(--cb-move-ms, 180ms) cubic-bezier(0.25, 0.9, 0.3, 1);
}
.cb-piece.moving { will-change: transform; }
.cb-piece.dragging { transition: none; will-change: transform; }
.cb-piece.snap { transition: none !important; }
/* pick-up / drop are a spring on the inner wrapper, so they never fight the grid transform */
.cb-piece-inner { width: 100%; height: 100%; transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
.cb-piece-inner svg { width: 100%; height: 100%; display: block; }
.cb-piece.dragging .cb-piece-inner { transform: translateY(-5%) scale(1.14); }
.cb-piece.moving .cb-piece-inner { animation: cb-lift var(--cb-move-ms, 180ms) cubic-bezier(0.3, 0, 0.3, 1); }
.cb-piece.moving.land .cb-piece-inner { animation-name: cb-land; }
.cb-piece.spawn .cb-piece-inner { animation: cb-spawn 0.32s cubic-bezier(0.2, 0.9, 0.25, 1.25) both; }
.cb-piece.captured .cb-piece-inner { animation: cb-cap 0.2s ease-out forwards; }
.cb-piece.snap .cb-piece-inner { animation: none !important; }
.cb-piece .cb-piece-inner.pop { animation: cb-morph 0.36s cubic-bezier(0.2, 0.9, 0.3, 1.4); }

/* ── arrows ── */
.cb-shapes { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 40; pointer-events: none; }
.cb-shape-in { animation: cb-fade 0.18s ease-out; }

/* ── badges ── */
.cb-badges { z-index: 45; }
.cb-badge { position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%; }
.cb-badge img {
  position: absolute; right: 0; top: 0;
  translate: 30% -30%;
  object-fit: contain; display: block;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
  animation: cb-badge-in 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.5) both;
}

/* ── promotion ── */
.cb-promo-scrim {
  position: absolute; inset: 0; z-index: 70; border-radius: inherit;
  background: rgba(8, 12, 10, 0.5);
  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  animation: cb-fade 0.15s ease-out;
}
.cb-promo-btn {
  position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%; z-index: 80;
  display: grid; place-items: center; padding: 5%;
  background: radial-gradient(circle at 35% 28%, #FFFFFF, #EBE6D8);
  border: 0; border-radius: 50%; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  animation: cb-promo-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
  transition: background 0.12s ease;
}
.cb-promo-btn:hover { background: #FFFFFF; }
.cb-promo-btn:hover svg { transform: scale(1.12); }
.cb-promo-btn:focus-visible { outline: 2px solid #F2C14E; outline-offset: 2px; }
.cb-promo-btn svg { width: 100%; height: 100%; transition: transform 0.12s ease; }

.cb-no-anim .cb-piece { transition: none !important; }
.cb-no-anim .cb-piece-inner { transition: none !important; animation: none !important; }
.cb-no-anim .cb-square, .cb-no-anim .cb-shape-in, .cb-no-anim .cb-badge img { animation: none !important; }

@keyframes cb-fade  { from { opacity: 0; } }
@keyframes cb-pop   { from { transform: scale(0.4); opacity: 0; } }
@keyframes cb-check { 50% { opacity: 0.6; } }
@keyframes cb-lift  { 0% { transform: none; } 38% { transform: translateY(-6%) scale(1.07); } 100% { transform: none; } }
@keyframes cb-land  { 0% { transform: none; } 34% { transform: translateY(-7%) scale(1.08); } 68% { transform: translateY(0) scale(1.02); } 84% { transform: scale(1.06, 0.93); } 100% { transform: none; } }
@keyframes cb-spawn { from { opacity: 0; transform: translateY(-10%) scale(0.55); } }
@keyframes cb-cap   { to { opacity: 0; transform: scale(0.55); } }
@keyframes cb-morph { 0% { transform: scale(0.35); } 55% { transform: scale(1.16); } }
@keyframes cb-badge-in { from { opacity: 0; transform: scale(0.4); } }
@keyframes cb-promo-in { from { opacity: 0; scale: 0.5; } }

@media (prefers-reduced-motion: reduce) {
  .cb-piece { transition-duration: 0.01ms !important; }
  .cb-piece-inner { transition-duration: 0.01ms !important; }
  .cb-piece-inner, .cb-square, .cb-promo-btn, .cb-shape-in, .cb-badge img {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
  }
}
</style>