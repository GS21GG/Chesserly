// assets/accuracy.js
// Colors, weights and icons for move accuracy. Pure helpers, no Vue.

export const accuracyColors = {
  brilliant: '#03aea7', great: '#4c8cb5', best: '#6ad13f', excellent: '#90bc36',
  good: '#8eae83', book: '#ad8760', inaccuracy: '#f2bc43', mistake: '#f38800', blunder: '#FF0000'
}

export const accuracyWeights = {
  brilliant: 100, great: 100, best: 100, book: 100,
  excellent: 90, good: 80, inaccuracy: 20, mistake: 10, blunder: 0
}

export const classificationOrder = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder']

export const classificationMeta = {
  brilliant: { label: 'Brilliant', color: '#03aea7' },
  great: { label: 'Great', color: '#4c8cb5' },
  best: { label: 'Best', color: '#6ad13f' },
  excellent: { label: 'Excellent', color: '#90bc36' },
  good: { label: 'Good', color: '#8eae83' },
  book: { label: 'Book', color: '#ad8760' },
  inaccuracy: { label: 'Inaccuracy', color: '#f2bc43' },
  mistake: { label: 'Mistake', color: '#f38800' },
  blunder: { label: 'Blunder', color: '#FF0000' }
}

export function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function accColorForWeight(w) {
  if (w === null || w === undefined) return 'rgba(244,240,227,0.4)'
  if (w >= 95) return accuracyColors.great
  if (w >= 85) return accuracyColors.best
  if (w >= 75) return accuracyColors.excellent
  if (w >= 65) return accuracyColors.good
  if (w >= 45) return accuracyColors.inaccuracy
  if (w >= 20) return accuracyColors.mistake
  return accuracyColors.blunder
}

export function fmtAcc(v) {
  return v === null || v === undefined ? '—' : v.toFixed(1) + '%'
}

export function accuracyToClass(acc) {
  if (acc === null || acc === undefined) return null
  if (acc >= 95) return 'great'
  if (acc >= 85) return 'best'
  if (acc >= 75) return 'excellent'
  if (acc >= 65) return 'good'
  if (acc >= 45) return 'inaccuracy'
  if (acc >= 20) return 'mistake'
  return 'blunder'
}

// ----- Icons -----

const ICON_STROKE = 'fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"'
const ICON_Q = `<path d="M23 24C23 17 28 14 32 14C37 14 41 17 41 22C41 27 36 29 33 32C32 33 32 35 32 37" ${ICON_STROKE}/><circle cx="32" cy="46" r="3.5" fill="#fff"/>`
const iconEx = (x) => `<rect x="${x - 3.5}" y="13" width="7" height="24" rx="3.5" fill="#fff"/><circle cx="${x}" cy="47" r="4" fill="#fff"/>`

const ICON_BODY = {
  // Two bars, scaled down a bit so they have room inside the circle
  brilliant: `<g transform="translate(32 32) scale(.88) translate(-32 -32)">${iconEx(24)}${iconEx(40)}</g>`,
  great: iconEx(32),
  best: '<polygon points="32,18 36.1,28.3 47.2,29.1 38.7,36.2 41.4,46.9 32,41 22.6,46.9 25.3,36.2 16.8,29.1 27.9,28.3" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>',
  excellent: '<rect x="14" y="28" width="9" height="20" rx="2" fill="#fff"/><path d="M26 29L33 14Q35 11 38 13Q40 15 39 18L37 25H48Q52 25 52 29Q52 31 51 32Q52 34 51 36Q52 38 50 40Q50 43 47 44L47 46H29Q26 46 26 44Z" fill="#fff"/>',
  good: `<path d="M19 33L28 42L46 22" ${ICON_STROKE}/>`,
  book: '<path d="M14 21Q23 19 31 24V47Q23 42 14 44Z" fill="#fff"/><path d="M50 21Q41 19 33 24V47Q41 42 50 44Z" fill="#fff"/>',
  // "?" scaled to 0.85, "!" sized to the same height (y 15.5 to 48.5)
  inaccuracy: `<g transform="translate(-3.2 6.3) scale(.85)">${ICON_Q}</g><rect x="44" y="15.5" width="6" height="22" rx="3" fill="#fff"/><circle cx="47" cy="45" r="3.5" fill="#fff"/>`,
  mistake: ICON_Q,
  blunder: `<g transform="translate(1.7 11.4) scale(.68)">${ICON_Q}</g><g transform="translate(18.7 11.4) scale(.68)">${ICON_Q}</g>`
}

function shade(hex, amt) { // -1 darker ... 1 lighter
  const n = parseInt(hex.slice(1), 16)
  const f = c => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

const GLOW_ICONS = ['brilliant', 'great', 'best']
const symbolCache = {}

export function accuracySymbol(acc) {
  const body = ICON_BODY[acc]
  if (!body) return undefined
  if (symbolCache[acc]) return symbolCache[acc]
  const c = accuracyColors[acc]
  const hasGlow = GLOW_ICONS.includes(acc)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 72 72">
      <defs>
        <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${shade(c, 0.5)}"/>
          <stop offset="1" stop-color="${shade(c, -0.45)}"/>
        </linearGradient>
        <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${shade(c, 0.22)}"/>
          <stop offset="1" stop-color="${shade(c, -0.3)}"/>
        </linearGradient>
        <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".5"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <filter id="sym" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1.8" stdDeviation="1.3" flood-color="#000" flood-opacity=".4"/>
        </filter>
        ${hasGlow ? `<filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="${c}" flood-opacity=".75"/></filter>` : ''}
      </defs>
      <g ${hasGlow ? 'filter="url(#glow)"' : ''}>
        <circle cx="32" cy="32" r="30" fill="url(#rim)"/>
        <circle cx="32" cy="32" r="25.5" fill="url(#face)"/>
        <circle cx="32" cy="32" r="25.5" fill="none" stroke="${shade(c, -0.5)}" stroke-opacity=".6" stroke-width="1"/>
        <path d="M10 28C10 15 20 8 32 8C44 8 54 15 54 28C46 21 18 21 10 28Z" fill="url(#shine)"/>
      </g>
      <g filter="url(#sym)">${body}</g>
    </svg>`
  const url = 'data:image/svg+xml,' + encodeURIComponent(svg)
  symbolCache[acc] = url
  return url
}