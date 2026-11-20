<!--
  TheChessboard.vue — lightweight, crisp, animated chessboard (drop-in for vue3-chessboard).
  import TheChessboard from '../assets/TheChessboard.vue'

  What's new in this version:
  · Pieces: redrawn Staunton set — classic proportions (taller king/queen/bishop, shorter pawn),
    warm ivory / charcoal shading with a subtle sheen, soft radial ground shadow.
    Knight now reads clearly as a horse: pointed ear, defined jaw notch, two-tone mane ridge,
    eye and nostril. Bishop has a single continuous tapered body (no disjointed collar).
    Rook has 5 crenellations and a stepped two-tier base. Queen has 5 connected ball-tipped
    spikes. King has a cross pattée sitting flush on the crown. Pure SVG, no filters.
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
    { t: 'circle', k: 'b', cx: 22.5, cy: 8.6, r: 4.7 },
    { t: 'path', k: 'b', d: 'M18 13 H27 C27.85 13 28.5 13.65 28.5 14.5 V15.1 C28.5 15.78 28.03 16.36 27.36 16.55 L26.95 16.67 C27.32 20.5 28.05 24.1 29.55 27.2 C30.28 28.45 31.28 29.32 32.4 29.85 L33.05 30.15 C33.95 30.55 34.5 31.4 34.5 32.32 V36 C34.5 37.1 33.6 38 32.5 38 H12.5 C11.4 38 10.5 37.1 10.5 36 V32.32 C10.5 31.4 11.05 30.55 11.95 30.15 L12.6 29.85 C13.72 29.32 14.72 28.45 15.45 27.2 C16.95 24.1 17.68 20.5 18.05 16.67 L17.64 16.55 C16.97 16.36 16.5 15.78 16.5 15.1 V14.5 C16.5 13.65 17.15 13 18 13 Z' },
    { t: 'path', k: 'd', d: 'M17.6 16.5 H27.4 M11 30 H34' }
  ],
  r: [
    { t: 'path', k: 'b', d: 'M11 11 V7 H14 V11 H16.5 V7 H19 V11 H21.5 V7 H24 V11 H26.5 V7 H29 V11 H31.5 V7 H34 V11 H34.7 C35.55 11 36.2 11.65 36.2 12.5 V13.5 C36.2 14.35 35.55 15 34.7 15 H10.3 C9.45 15 8.8 14.35 8.8 13.5 V12.5 C8.8 11.65 9.45 11 10.3 11 H11 Z M12.3 15 H32.7 C33.6 15 34.3 15.7 34.3 16.6 V28.8 C34.3 30.0 33.4 30.9 32.2 30.9 H12.8 C11.6 30.9 10.7 30.0 10.7 28.8 V16.6 C10.7 15.7 11.4 15 12.3 15 Z M10.3 30.9 H34.7 C35.85 30.9 36.8 31.85 36.8 33 V36 C36.8 37.15 35.85 38 34.7 38 H10.3 C9.15 38 8.2 37.15 8.2 36 V33 C8.2 31.85 9.15 30.9 10.3 30.9 Z' },
    { t: 'path', k: 'd', d: 'M11 14 H34 M12 31 H33' }
  ],
  n: [
    { t: 'path', k: 'b', d: 'M7.8 22 C7 20 6.8 17 8 14.8 C9 13 10.5 11.6 12.4 10.2 C14 9 15.5 7.8 17 6.8 C18 6.2 19 5.8 20.5 5.8 L20.8 2 L22.7 3.2 L22.9 5.8 C24.3 6.6 25.7 8.1 27 10.2 C28.6 12.8 29.6 15.8 30.2 18.8 C30.8 21.8 31 24.8 30.6 27.2 L31.4 28.2 C32.4 29.2 32.9 30.2 32.9 31.6 V35 C32.9 37 31.9 38 30.4 38 H14.5 C13 38 12 37 12 35.5 V31.6 C12 30.2 12.5 29.2 13.5 28.4 L14 28 C13 26.8 12 25.4 11 24 C10.5 23.5 10.2 23.4 10 23.6 C9.8 23.8 9.6 24 9.4 23.8 C9 23 8.5 22.6 8 22.4 L7.8 22 Z' },
    { t: 'path', k: 'd', d: 'M23.2 6.2 C24.2 7.8 25 9.6 25.6 11.6 C26.2 13.8 26.6 16 26.8 18.2 C27 20.4 26.8 22.6 26.4 24.6 C26 26.4 25.4 27.8 24.6 28.8' },
    { t: 'path', k: 'd', d: 'M24.5 8 C25.2 9.5 25.8 11.2 26.2 13.2 C26.6 15.2 26.8 17.4 26.8 19.6' },
    { t: 'path', k: 'd', d: 'M22.6 7 L24.4 8' },
    { t: 'path', k: 'd', d: 'M8 21.4 L10.6 22' },
    { t: 'circle', k: 'e', cx: 13.0, cy: 13.2, r: 1.15 },
    { t: 'circle', k: 'e', cx: 8.2, cy: 19.4, r: 0.7 }
  ],
  b: [
    { t: 'circle', k: 'b', cx: 22.5, cy: 4.6, r: 2.0 },
    { t: 'path', k: 'b', d: 'M22.5 6.6 C26 9.8 28.4 13.6 28.4 17.5 C28.4 20.6 25.8 22.4 22.5 22.4 C19.2 22.4 16.6 20.6 16.6 17.5 C16.6 13.6 19 9.8 22.5 6.6 Z' },
    { t: 'path', k: 'b', d: 'M14.5 22.4 H30.5 C30 24 29.5 25 29.3 25.8 C28.8 27.5 28.2 29.5 27.8 31.5 L28.5 32 C32 32 34 33 34 34.3 V36.5 C34 37.5 33 38 31.5 38 H13.5 C12 38 11 37.5 11 36.5 V34.3 C11 33 13 32 16.5 32 L17.2 31.5 C16.8 29.5 16.2 27.5 15.7 25.8 C15.5 25 15 24 14.5 22.4 Z' },
    { t: 'path', k: 'd', d: 'M19.5 9.5 L25.5 21' },
    { t: 'path', k: 'd', d: 'M15 25 H30' }
  ],
  q: [
    { t: 'circle', k: 'b', cx: 8.8, cy: 9.5, r: 1.85 },
    { t: 'circle', k: 'b', cx: 15.5, cy: 7.4, r: 1.95 },
    { t: 'circle', k: 'b', cx: 22.5, cy: 6.5, r: 2.1 },
    { t: 'circle', k: 'b', cx: 29.5, cy: 7.4, r: 1.95 },
    { t: 'circle', k: 'b', cx: 36.2, cy: 9.5, r: 1.85 },
    { t: 'path', k: 'b', d: 'M8.8 11 C9.2 13 11 15 13.5 15.5 L15.5 9.5 C16 12 18.5 13.5 22.5 14 C26.5 13.5 29 12 29.5 9.5 L31.5 15.5 C34 15 36 13 36.2 11 L33.5 27 C33 29.5 33.4 32 34.4 34 V34.4 C35.6 34.9 36.3 35.7 36.3 36.7 V36.9 C36.3 37.9 35.5 38.6 34.5 38.6 H10.5 C9.5 38.6 8.7 37.9 8.7 36.9 V36.7 C8.7 35.7 9.4 34.9 10.6 34.4 V34 C11.6 32 12 29.5 11.5 27 Z' },
    { t: 'path', k: 'd', d: 'M13 25.5 H32 M10.5 34.5 H34.5' }
  ],
  k: [
    { t: 'path', k: 'x', d: 'M21.2 2 H23.8 V4.5 H26.4 V6.8 H23.8 V9.2 H21.2 V6.8 H18.6 V4.5 H21.2 Z' },
    { t: 'path', k: 'b', d: 'M22.5 9.5 C24.4 9.5 26 11 26.5 13 C27.1 15.2 26.5 17.6 25.3 19.5 C27.9 18.4 30.9 19.6 32 22.4 C33.2 25.2 32.6 28.7 31 31.5 V32.5 C32.2 33 32.9 33.8 32.9 34.9 V35.1 C32.9 36.1 32.1 36.8 31.1 36.8 H13.9 C12.9 36.8 12.1 36.1 12.1 35.1 V34.9 C12.1 33.8 12.8 33 14 32.5 V31.5 C12.4 28.7 11.8 25.2 13 22.4 C14.1 19.6 17.1 18.4 19.7 19.5 C18.5 17.6 17.9 15.2 18.5 13 C19 11 20.6 9.5 22.5 9.5 Z' },
    { t: 'path', k: 'd', d: 'M19.5 19.5 C21.2 20.5 23.8 20.5 25.5 19.5 M22.5 20.5 V28 M14.5 29.5 C18.6 28 26.4 28 30.5 29.5 M14 33 H31' }
  ]
}

// Paint: 4-stop warm ivory / warm charcoal bodies + one subtle diagonal sheen (light from upper-left,
// warm core-shadow at lower-right) + the shared radial ground shadow. Matte, not plasticky.
const gradDefs =
  `<linearGradient id="${uid}-fillw" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#FCF5E6"/><stop offset=".40" stop-color="#F0E2C2"/><stop offset=".78" stop-color="#D8C298"/><stop offset="1" stop-color="#B89F70"/></linearGradient>` +
  `<linearGradient id="${uid}-fillb" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#5E5650"/><stop offset=".42" stop-color="#403935"/><stop offset=".78" stop-color="#262220"/><stop offset="1" stop-color="#171412"/></linearGradient>` +
  `<linearGradient id="${uid}-sheenw" x1="0" y1="0" x2=".85" y2="1">` +
  `<stop offset="0" stop-color="#FFFFFF" stop-opacity=".20"/><stop offset=".35" stop-color="#FFFFFF" stop-opacity=".06"/><stop offset=".65" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#5C4D2F" stop-opacity=".15"/></linearGradient>` +
  `<linearGradient id="${uid}-sheenb" x1="0" y1="0" x2=".85" y2="1">` +
  `<stop offset="0" stop-color="#FFFFFF" stop-opacity=".14"/><stop offset=".35" stop-color="#FFFFFF" stop-opacity=".04"/><stop offset=".65" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".28"/></linearGradient>` +
  `<radialGradient id="${uid}-gsh">` +
  `<stop offset="0" stop-color="#000" stop-opacity=".26"/><stop offset=".65" stop-color="#000" stop-opacity=".13"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`

function pieceGroup(color, type) {
  const white = color === 'w'
  const F = `url(#${uid}-fill${color})`
  const SH = `url(#${uid}-sheen${color})`
  const S = white ? '#3E382B' : '#0B0B0E'
  const D = white ? '#4A4436' : '#080809'
  const shadow = `<ellipse cx="22.5" cy="39.4" rx="${SHADOW_RX[type]}" ry="2.1" fill="url(#${uid}-gsh)"/>`
  const body = ART[type].map(pr => {
    if (pr.t === 'circle') {
      if (pr.k === 'e') return `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${D}"/>`
      return `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${F}" stroke="${S}" stroke-width="1.0"/>` +
             `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${SH}"/>`
    }
    if (pr.k === 'b') {
      return `<path d="${pr.d}" fill="${F}" stroke="${S}" stroke-width="1.0" stroke-linejoin="round"/>` +
             `<path d="${pr.d}" fill="${SH}"/>`
    }
    if (pr.k === 'x') {
      return `<path d="${pr.d}" fill="${F}" stroke="${S}" stroke-width="1.0" stroke-linejoin="round"/>`
    }
    return `<path d="${pr.d}" fill="none" stroke="${D}" stroke-opacity="${white ? 0.9 : 0.85}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>`
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