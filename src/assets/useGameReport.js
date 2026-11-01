// assets/useGameReport.js
// Read-only stats for the Game Report: accuracy, counts, phases, pieces, key moments.
import { computed } from 'vue'
import { accuracyWeights, classificationOrder, classificationMeta } from './accuracy.js'
import { moveBucketOrderLocal, pieceMetaLocal, toCpLocal, bucketLabel, getGamePhases } from './chessUtils.js'

export function useGameReport({ moveTree, treeVersion, jumpToNode, isReportMaximized }) {

  const gameReportStats = computed(() => {
    treeVersion.value
    function emptyCounts() { return classificationOrder.reduce((acc, key) => ({ ...acc, [key]: 0 }), {}) }
    const white = { counts: emptyCounts(), weightedSum: 0, moveCount: 0 }
    const black = { counts: emptyCounts(), weightedSum: 0, moveCount: 0 }
    let current = moveTree.children[0] ?? null
    let ply = 1
    while (current) {
      const side = ply % 2 === 1 ? white : black
      if (current.accuracy && side.counts.hasOwnProperty(current.accuracy)) {
        side.counts[current.accuracy]++
        side.weightedSum += accuracyWeights[current.accuracy] ?? 0
        side.moveCount++
      }
      current = current.children[0] ?? null
      ply++
    }
    const finalize = (side) => ({ counts: side.counts, accuracy: side.moveCount > 0 ? (side.weightedSum / side.moveCount) : null })
    return { white: finalize(white), black: finalize(black) }
  })

  const estimatedRatings = computed(() => {
    const estimate = (accuracy) => {
      if (accuracy === null) return null
      if (accuracy >= 90) return Math.round(2000 + (accuracy - 90) * 50)
      if (accuracy >= 70) return Math.round(1600 + (accuracy - 70) * 20)
      return Math.round(900 + accuracy * 10)
    }
    return {
      white: estimate(gameReportStats.value.white.accuracy),
      black: estimate(gameReportStats.value.black.accuracy)
    }
  })

  const reportBars = computed(() => {
    treeVersion.value
    return ['white', 'black'].map(sideKey => {
      const counts = gameReportStats.value[sideKey].counts
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const segments = classificationOrder
        .map(key => ({ key, count: counts[key], meta: classificationMeta[key], percent: total ? (counts[key] / total) * 100 : 0 }))
        .filter(s => s.count > 0)
      return { side: sideKey, total, segments }
    })
  })

  const gameExtendedStats = computed(() => {
    treeVersion.value
    const uciList = []
    let cur = moveTree.children[0] ?? null
    while (cur) { uciList.push(cur.uci); cur = cur.children[0] ?? null }
    if (uciList.length === 0) return null
    const phases = getGamePhases(uciList)
    const mkSide = () => ({
      checks: 0, captures: 0, cpLost: 0, swingsGained: 0,
      buckets: {},
      phases: { opening: { sum: 0, count: 0 }, middlegame: { sum: 0, count: 0 }, endgame: { sum: 0, count: 0 } },
      badSquares: {}, goodSquares: {}
    })
    const white = mkSide(), black = mkSide()
    let prev = moveTree
    let node = moveTree.children[0] ?? null
    let ply = 1
    while (node) {
      const side = ply % 2 === 1 ? white : black
      const other = ply % 2 === 1 ? black : white
      const w = node.accuracy ? (accuracyWeights[node.accuracy] ?? null) : null
      const before = toCpLocal(prev.analysisData?.eval)
      const after = toCpLocal(node.analysisData?.eval)
      const persp = ply % 2 === 1 ? 1 : -1
      const delta = (before !== null && after !== null) ? (after - before) * persp : null
      if (node.san?.includes('+') || node.san?.includes('#')) side.checks++
      if (node.san?.includes('x')) side.captures++
      if (delta !== null) {
        if (delta < 0) side.cpLost += Math.min(-delta, 1000)
        if (delta <= -150) other.swingsGained++
      }
      if (w !== null) {
        const label = bucketLabel(Math.ceil(ply / 2))
        if (!side.buckets[label]) side.buckets[label] = { sum: 0, count: 0 }
        side.buckets[label].sum += w
        side.buckets[label].count++
        for (const [phase, [start, end]] of Object.entries(phases)) {
          if (ply > start && ply <= end) {
            side.phases[phase].sum += w
            side.phases[phase].count++
          }
        }
      }
      prev = node
      node = node.children[0] ?? null
      ply++
    }
    const finalizeSide = (s) => ({
      ...s,
      cpLost: Math.round(s.cpLost / 100),
      buckets: moveBucketOrderLocal.map(label => {
        const b = s.buckets[label]
        return { label, acc: b && b.count ? b.sum / b.count : null, count: b ? b.count : 0 }
      }),
      phases: Object.fromEntries(['opening', 'middlegame', 'endgame'].map(key => {
        const p = s.phases[key]
        return [key, p.count ? p.sum / p.count : null]
      }))
    })
    return { white: finalizeSide(white), black: finalizeSide(black), totalPlies: uciList.length }
  })

  const keyMoments = computed(() => {
    treeVersion.value
    const moments = []
    let prev = moveTree
    let node = moveTree.children[0] ?? null
    let ply = 1
    while (node) {
      const before = toCpLocal(prev.analysisData?.eval)
      const after = toCpLocal(node.analysisData?.eval)
      const persp = ply % 2 === 1 ? 1 : -1
      if (before !== null && after !== null && node.accuracy) {
        const delta = (after - before) * persp
        const isError = ['blunder', 'mistake', 'inaccuracy'].includes(node.accuracy)
        const isStar = ['brilliant', 'great'].includes(node.accuracy)
        if (isError || isStar) {
          moments.push({
            nodeId: node.id, ply, san: node.san,
            side: ply % 2 === 1 ? 'white' : 'black',
            accuracy: node.accuracy,
            swing: Math.abs(delta)
          })
        }
      }
      prev = node
      node = node.children[0] ?? null
      ply++
    }
    return moments.sort((a, b) => b.swing - a.swing).slice(0, 8)
  })

  function jumpToMoment(m) {
    isReportMaximized.value = false
    jumpToNode(m.nodeId)
  }

  function jumpToClassification(side, key) {
    const stats = gameReportStats.value
    if (!stats || !stats[side] || stats[side].counts[key] === 0) return
    let node = moveTree.children[0] ?? null
    let ply = 1
    while (node) {
      const nodeSide = ply % 2 === 1 ? 'white' : 'black'
      if (nodeSide === side && node.accuracy === key) {
        if (isReportMaximized.value) isReportMaximized.value = false
        jumpToNode(node.id)
        return
      }
      node = node.children[0] ?? null
      ply++
    }
  }

  const gamePieceStats = computed(() => {
    treeVersion.value
    const mk = () => Object.fromEntries(pieceMetaLocal.map(p => [p.key, { count: 0, sum: 0 }]))
    const white = mk()
    const black = mk()
    let node = moveTree.children[0] ?? null
    let ply = 1
    while (node) {
      const side = ply % 2 === 1 ? white : black
      const w = node.accuracy ? (accuracyWeights[node.accuracy] ?? null) : null
      if (w !== null && node.san) {
        let piece = 'p'
        const firstChar = node.san[0]
        if (['N', 'B', 'R', 'Q', 'K'].includes(firstChar)) piece = firstChar.toLowerCase()
        if (side[piece]) {
          side[piece].count++
          side[piece].sum += w
        }
      }
      node = node.children[0] ?? null
      ply++
    }
    const avg = (s) => s.count > 0 ? s.sum / s.count : null
    return pieceMetaLocal.map(p => ({
      ...p,
      white: { count: white[p.key].count, acc: avg(white[p.key]) },
      black: { count: black[p.key].count, acc: avg(black[p.key]) }
    }))
  })

  return {
    gameReportStats,
    estimatedRatings,
    reportBars,
    gameExtendedStats,
    keyMoments,
    jumpToMoment,
    jumpToClassification,
    gamePieceStats
  }
}