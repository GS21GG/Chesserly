// assets/chessUtils.js
// Piece data, move formatting and game helpers. Pure functions, no Vue.

import { Chess } from 'chess.js'

export const PIECE_UNICODE = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛'
}

export const PIECE_MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9 }

export const pieceMetaLocal = [
  { key: 'p', label: 'Pawn', symbol: '♟' },
  { key: 'n', label: 'Knight', symbol: '♞' },
  { key: 'b', label: 'Bishop', symbol: '♝' },
  { key: 'r', label: 'Rook', symbol: '♜' },
  { key: 'q', label: 'Queen', symbol: '♛' },
  { key: 'k', label: 'King', symbol: '♚' }
]

export const moveBucketOrderLocal = ['1-10', '11-20', '21-30', '31-40', '41+']

export function prettyMove(move) {
  const pieces = { 'K': '♚', 'Q': '♛', 'R': '♜', 'B': '♝', 'N': '♞' }
  return move ? move.replace(/[KQRBN]/g, p => pieces[p]) : ''
}

export function formatCount(num) {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 10_000) return Math.round(num / 1000) + 'K'
  return num.toLocaleString()
}

export function calculateMaterialBalance(fen) {
  const parts = fen.split(' ')
  const board = parts[0]
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9 }
  let whiteMat = 0, blackMat = 0
  for (const char of board) {
    if (values[char.toLowerCase()]) {
      if (char === char.toUpperCase()) whiteMat += values[char.toLowerCase()]
      else blackMat += values[char.toLowerCase()]
    }
  }
  return { whiteMat, blackMat }
}

export function getGamePhases(uciList) {
  const c = new Chess()
  let openingEndPly = 12
  let endgameStartPly = Infinity
  for (let i = 0; i < uciList.length; i++) {
    c.move(uciList[i])
    const fen = c.fen()
    const { whiteMat, blackMat } = calculateMaterialBalance(fen)
    if ((whiteMat < 14 && blackMat < 14) || (whiteMat < 10 || blackMat < 10)) {
      if (i >= openingEndPly) { endgameStartPly = i + 1; break }
    }
  }
  return {
    opening: [0, Math.min(openingEndPly, uciList.length)],
    middlegame: [openingEndPly, Math.min(endgameStartPly, uciList.length)],
    endgame: [endgameStartPly, uciList.length]
  }
}

export function bucketLabel(moveNum) {
  if (moveNum <= 10) return '1-10'
  if (moveNum <= 20) return '11-20'
  if (moveNum <= 30) return '21-30'
  if (moveNum <= 40) return '31-40'
  return '41+'
}

export function toCpLocal(ev) {
  if (!ev) return null
  if (ev.type === 'mate') return Math.sign(ev.value) * 10000
  return ev.value
}

export function generatePgnHash(p) {
  let hash = 0
  for (let i = 0; i < p.length; i++) { hash = (hash << 5) - hash + p.charCodeAt(i); hash &= hash }
  return String(hash)
}