<script setup>
  import { ref, computed, onMounted, watch } from 'vue'
  import Title from '../assets/Title.vue'
  import { auth, db } from '../firebase'
  import { onAuthStateChanged } from 'firebase/auth'
  import { collection, query, orderBy, getDocs } from 'firebase/firestore'

  // --- Theme Management ---
  const currentTheme = ref(localStorage.getItem('chesslab_theme') || 'midnight')
  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chesslab_theme', newTheme)
  }, { immediate: true })

  // --- User & State ---
  const currentUser = ref(null)
  const insights = ref([])
  const loading = ref(true)
  const activeTab = ref('overview')
  const isPremium = ref(false)
  const premiumChecked = ref(true)

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'moves', label: 'Move classes' },
    { id: 'colors', label: 'Colors' },
    { id: 'pieces', label: 'Pieces' },
    { id: 'openings', label: 'Openings' },
    { id: 'stamina', label: 'Stamina' },
    { id: 'playstyle', label: 'Playstyle' },
    { id: 'heatmap', label: 'Heatmap' }
  ]

  onMounted(() => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser.value = user
        await fetchInsights()
      } else {
        currentUser.value = null
        insights.value = []
      }
      loading.value = false
    })
  })

  async function fetchInsights() {
    if (!currentUser.value) return
    try {
      const q = query(
        collection(db, `users/${currentUser.value.uid}/games`),
        orderBy('createdAt', 'desc')
      )
      const querySnapshot = await getDocs(q)
      insights.value = querySnapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(game => game.insights && game.insights.overallAccuracy !== null)
    } catch (e) {
      console.error("Failed to load insights:", e)
    }
  }

  // --- Helper: normalize player field (string or object) ---
  function normalizePlayer(p) {
    if (!p) return { username: 'Unknown', rating: 0, result: 'unknown' }
    if (typeof p === 'string') return { username: p, rating: 0, result: 'unknown' }
    return { username: p.username || 'Unknown', rating: p.rating || 0, result: p.result || 'unknown' }
  }

  function getAccuracyMeta(acc) {
    if (acc === null || acc === undefined) return { label: 'N/A', icon: null, color: '#666' }
    if (acc >= 95) return { label: 'Brilliant', icon: '/moveClassifications/brilliant.png', color: '#03aea7' }
    if (acc >= 90) return { label: 'Great', icon: '/moveClassifications/great.png', color: '#8eae83' }
    if (acc >= 80) return { label: 'Best', icon: '/moveClassifications/best.png', color: '#6ad13f' }
    if (acc >= 70) return { label: 'Excellent', icon: '/moveClassifications/excellent.png', color: '#90bc36' }
    if (acc >= 60) return { label: 'Good', icon: '/moveClassifications/good.png', color: '#f2bc43' }
    if (acc >= 50) return { label: 'Inaccuracy', icon: '/moveClassifications/inaccuracy.png', color: '#f2bc43' }
    if (acc >= 40) return { label: 'Mistake', icon: '/moveClassifications/mistake.png', color: '#f38800' }
    return { label: 'Blunder', icon: '/moveClassifications/blunder.png', color: '#FF0000' }
  }

  // --- Core Stats ---
  const totalGames = computed(() => insights.value.length)
  const totalMoves = computed(() => insights.value.reduce((sum, g) => sum + (g.insights?.totalMoves || 0), 0))

  const overallAccuracy = computed(() => {
    const gamesWithAcc = insights.value.filter(g => g.insights?.overallAccuracy !== null)
    if (gamesWithAcc.length === 0) return null
    const sum = gamesWithAcc.reduce((acc, g) => acc + g.insights.overallAccuracy, 0)
    return (sum / gamesWithAcc.length).toFixed(1)
  })

  const overallMeta = computed(() => getAccuracyMeta(overallAccuracy.value ? parseFloat(overallAccuracy.value) : null))

  // --- Performance by Color ---
  const colorPerformance = computed(() => {
    const colors = {
      white: { games: 0, win: 0, loss: 0, draw: 0, accs: [], blunders: 0 },
      black: { games: 0, win: 0, loss: 0, draw: 0, accs: [], blunders: 0 }
    }
    insights.value.forEach(g => {
      const c = g.insights?.myColor
      if (!c || !colors[c]) return
      colors[c].games++
      colors[c].accs.push(g.insights.overallAccuracy || 0)
      colors[c].blunders += (g.insights.moveCounts?.blunder || 0) + (g.insights.moveCounts?.mistake || 0)
      const player = normalizePlayer(c === 'white' ? g.white : g.black)
      const myRes = player.result
      if (myRes === 'win') colors[c].win++
      else if (['lose', 'loss', 'checkmated', 'resigned', 'abandoned'].includes(myRes)) colors[c].loss++
      else colors[c].draw++
    })
    const calcAcc = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null
    return {
      white: { ...colors.white, avgAcc: calcAcc(colors.white.accs) },
      black: { ...colors.black, avgAcc: calcAcc(colors.black.accs) }
    }
  })

  // --- Piece Performance ---
  const pieceMeta = [
    { key: 'p', label: 'Pawn', symbol: '♟', color: '#cccccc' },
    { key: 'n', label: 'Knight', symbol: '♞', color: '#a8d97a' },
    { key: 'b', label: 'Bishop', symbol: '♝', color: '#7ec8e3' },
    { key: 'r', label: 'Rook', symbol: '♜', color: '#f0d0a3' },
    { key: 'q', label: 'Queen', symbol: '♛', color: '#d9b382' },
    { key: 'k', label: 'King', symbol: '♚', color: '#f5f5dc' },
  ]

  const pieceStats = computed(() => {
    const totals = { p: { count: 0, sum: 0 }, n: { count: 0, sum: 0 }, b: { count: 0, sum: 0 }, r: { count: 0, sum: 0 }, q: { count: 0, sum: 0 }, k: { count: 0, sum: 0 } }
    insights.value.forEach(g => {
      if (g.insights?.pieceStats) {
        for (const key in totals) {
          totals[key].count += g.insights.pieceStats[key]?.count || 0
          totals[key].sum += g.insights.pieceStats[key]?.sum || 0
        }
      }
    })
    return totals
  })

  const totalPieceMoves = computed(() => Object.values(pieceStats.value).reduce((a, b) => a + b.count, 0))

  const pieceData = computed(() => {
    return pieceMeta.map(p => {
      const stats = pieceStats.value[p.key]
      const avgAcc = stats.count > 0 ? (stats.sum / stats.count).toFixed(1) : null
      const movePercent = totalPieceMoves.value > 0 ? ((stats.count / totalPieceMoves.value) * 100).toFixed(1) : 0
      return { ...p, count: stats.count, avgAcc: avgAcc ? parseFloat(avgAcc) : null, meta: avgAcc ? getAccuracyMeta(parseFloat(avgAcc)) : getAccuracyMeta(null), movePercent }
    })
  })

  // --- Game Length Stats ---
  const gameLengthStats = computed(() => {
    const buckets = {
      short: { label: 'Short (<20)', games: 0, win: 0, loss: 0, draw: 0, accs: [], blunders: 0 },
      medium: { label: 'Medium (20-40)', games: 0, win: 0, loss: 0, draw: 0, accs: [], blunders: 0 },
      long: { label: 'Long (40+)', games: 0, win: 0, loss: 0, draw: 0, accs: [], blunders: 0 }
    }
    insights.value.forEach(g => {
      const moves = g.insights?.totalMoves || 0
      const c = g.insights?.myColor
      if (!c) return
      const bucket = moves < 20 ? 'short' : moves <= 40 ? 'medium' : 'long'
      buckets[bucket].games++
      buckets[bucket].accs.push(g.insights.overallAccuracy || 0)
      buckets[bucket].blunders += (g.insights.moveCounts?.blunder || 0) + (g.insights.moveCounts?.mistake || 0)
      const player = normalizePlayer(c === 'white' ? g.white : g.black)
      const myRes = player.result
      if (myRes === 'win') buckets[bucket].win++
      else if (['lose', 'loss', 'checkmated', 'resigned', 'abandoned'].includes(myRes)) buckets[bucket].loss++
      else buckets[bucket].draw++
    })
    return Object.values(buckets).map(b => ({
      ...b,
      avgAcc: b.accs.length ? (b.accs.reduce((a, b) => a + b, 0) / b.accs.length).toFixed(1) : null
    }))
  })

  // --- Move-Number Accuracy Buckets ---
  const moveBucketOrder = ['1-10', '11-20', '21-30', '31-40', '41+']
  const moveBucketData = computed(() => {
    const agg = {}
    moveBucketOrder.forEach(k => { agg[k] = { sum: 0, count: 0 } })
    insights.value.forEach(g => {
      const mb = g.insights?.moveBuckets
      if (!mb) return
      for (const key of moveBucketOrder) {
        if (mb[key]) {
          agg[key].sum += mb[key].sum || 0
          agg[key].count += mb[key].count || 0
        }
      }
    })
    return moveBucketOrder.map(k => ({
      label: k,
      avgAcc: agg[k].count > 0 ? (agg[k].sum / agg[k].count).toFixed(1) : null,
      count: agg[k].count,
      meta: agg[k].count > 0 ? getAccuracyMeta(agg[k].sum / agg[k].count) : getAccuracyMeta(null)
    }))
  })

  const hasMoveBuckets = computed(() => moveBucketData.value.some(b => b.count > 0))

  // --- Recent Games Strip ---
  const recentGames = computed(() => {
    return insights.value.slice(0, 5).map(g => {
      const c = g.insights?.myColor || 'white'
      const player = normalizePlayer(c === 'white' ? g.white : g.black)
      const opponent = normalizePlayer(c === 'white' ? g.black : g.white)
      let outcome = 'draw'
      if (player.result === 'win') outcome = 'win'
      else if (['lose', 'loss', 'checkmated', 'resigned', 'abandoned'].includes(player.result)) outcome = 'loss'
      const acc = g.insights?.overallAccuracy
      return {
        id: g.id,
        opponent: opponent.username,
        outcome,
        accuracy: acc !== null && acc !== undefined ? acc.toFixed(1) : '—',
        accMeta: getAccuracyMeta(acc),
        opening: g.insights?.opening || 'Unknown',
        myColor: c
      }
    })
  })

  // --- Accuracy Sparkline (bigger chart, last point as % so we can draw it in HTML) ---
  const sparklineData = computed(() => {
    const games = [...insights.value].reverse().filter(g => g.insights?.overallAccuracy !== null)
    if (games.length < 2) return null
    const accs = games.map(g => g.insights.overallAccuracy)
    const min = Math.min(...accs) - 5
    const max = Math.max(...accs) + 5
    const range = max - min || 1
    const w = 600, h = 140, pad = 8
    const coords = accs.map((a, i) => ({
      x: pad + (i / (accs.length - 1)) * (w - pad * 2),
      y: h - pad - ((a - min) / range) * (h - pad * 2)
    }))
    const points = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    const last = coords[coords.length - 1]
    const area = `${pad},${h} ${points} ${last.x.toFixed(1)},${h}`
    return {
      points, area, width: w, height: h,
      lastAcc: accs[accs.length - 1].toFixed(1),
      lastX: (last.x / w) * 100,
      lastY: (last.y / h) * 100,
      games: accs.length,
      high: Math.max(...accs).toFixed(1),
      low: Math.min(...accs).toFixed(1)
    }
  })

  // --- Coach Digest ---
  const coachDigest = computed(() => {
    if (insights.value.length < 3) return null
    const lines = []

    // Worst phase
    const pa = phaseAccuracy.value
    const phases = [
      { name: 'opening', val: pa.opening.val ? parseFloat(pa.opening.val) : null },
      { name: 'middlegame', val: pa.middlegame.val ? parseFloat(pa.middlegame.val) : null },
      { name: 'endgame', val: pa.endgame.val ? parseFloat(pa.endgame.val) : null }
    ].filter(p => p.val !== null)
    if (phases.length > 0) {
      const worst = phases.reduce((a, b) => a.val < b.val ? a : b)
      const best = phases.reduce((a, b) => a.val > b.val ? a : b)
      if (best.val - worst.val > 5) {
        lines.push(`Your ${worst.name} accuracy (${worst.val.toFixed(1)}%) trails your ${best.name} (${best.val.toFixed(1)}%) by ${(best.val - worst.val).toFixed(1)} points. Focus training there.`)
      }
    }

    // Blunder rate
    const totalBlunders = moveCounts.value.blunder + moveCounts.value.mistake
    const perGame = totalBlunders / (totalGames.value || 1)
    if (perGame > 2) {
      lines.push(`You average ${perGame.toFixed(1)} mistakes+blunders per game. Reducing this to under 1.5 would be the single biggest rating gain available.`)
    }

    // Move-bucket cliff
    if (hasMoveBuckets.value) {
      const withAcc = moveBucketData.value.filter(b => b.avgAcc !== null)
      if (withAcc.length >= 2) {
        let biggestDrop = 0, dropLabel = ''
        for (let i = 1; i < withAcc.length; i++) {
          const drop = parseFloat(withAcc[i - 1].avgAcc) - parseFloat(withAcc[i].avgAcc)
          if (drop > biggestDrop) { biggestDrop = drop; dropLabel = `moves ${withAcc[i].label}` }
        }
        if (biggestDrop > 5) {
          lines.push(`Your accuracy drops ${biggestDrop.toFixed(1)}% around ${dropLabel} — likely time pressure. Practice longer time controls or train endgame technique.`)
        }
      }
    }

    // Trend
    if (trend.value) {
      if (trend.value.direction === 'up') lines.push(`You're improving: +${trend.value.delta}% accuracy over your last ${RECENT_WINDOW} games. Keep going.`)
      else if (trend.value.direction === 'down') lines.push(`Accuracy is down ${Math.abs(parseFloat(trend.value.delta))}% recently. Consider reviewing your last few losses before playing more.`)
    }

    if (lines.length === 0) lines.push('Your stats look balanced. Keep analyzing games and doing your puzzles to maintain momentum.')

    return lines
  })

  // --- Playstyle Radar (v2) ---
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
  const shrink50 = (value, sample, full) => 50 + (value - 50) * Math.min(1, sample / full)

  const playstyleAgg = computed(() => {
    const games = insights.value.filter(g => g.insights?.playstyle?.v === 2)
    if (games.length === 0) return null
    const s = {
      games: games.length, myMoves: 0, checks: 0, captures: 0, forcingMoves: 0, sacrifices: 0,
      inducedErrors: 0, brilliantPlus: 0, bookMoves: 0,
      errInacc: 0, errMist: 0, errBlund: 0,
      cpLost: 0, cpWon: 0, swingsFor: 0, swingsAgainst: 0,
      defendSum: 0, defendCount: 0, attackSum: 0, attackCount: 0,
      openingAccSum: 0, openingAccW: 0, openingMoves: 0,
      endDeltaSum: 0, endDeltaW: 0, endgamesReached: 0, endgameWins: 0
    }
    games.forEach(g => {
      const p = g.insights.playstyle
      const overall = g.insights.overallAccuracy
      const pa = g.insights.phaseAccuracy || {}
      const pc = p.phaseCounts || {}
      s.myMoves += p.myMoves || 0
      s.checks += p.checks || 0
      s.captures += p.captures || 0
      s.forcingMoves += p.forcingMoves || 0
      s.sacrifices += p.sacrifices || 0
      s.inducedErrors += p.inducedErrors || 0
      s.brilliantPlus += p.brilliantPlus || 0
      s.bookMoves += p.bookMoves || 0
      s.errInacc += p.errors?.inaccuracy || 0
      s.errMist += p.errors?.mistake || 0
      s.errBlund += p.errors?.blunder || 0
      s.cpLost += p.cpLost || 0
      s.cpWon += p.cpWon || 0
      s.swingsFor += p.bigSwingsFor || 0
      s.swingsAgainst += p.bigSwingsAgainst || 0
      s.defendSum += p.defendSum || 0
      s.defendCount += p.defendCount || 0
      s.attackSum += p.attackSum || 0
      s.attackCount += p.attackCount || 0
      if (pa.opening != null && pc.opening > 0) { s.openingAccSum += pa.opening * pc.opening; s.openingAccW += pc.opening; s.openingMoves += pc.opening }
      if (pa.endgame != null && pc.endgame > 0 && overall != null) { s.endDeltaSum += (pa.endgame - overall) * pc.endgame; s.endDeltaW += pc.endgame }
      if (p.reachedEndgame) { s.endgamesReached++; if (p.result === 'win') s.endgameWins++ }
    })
    return s
  })

  const legacyPlaystyleGames = computed(() =>
    insights.value.filter(g => g.insights?.playstyle && g.insights.playstyle.v !== 2).length
  )

  const playstyleData = computed(() => {
    const s = playstyleAgg.value
    if (!s || s.myMoves === 0) return null
    const pm = (v) => v / s.myMoves
    const aggression = clamp(pm(s.checks) * 220 + pm(s.captures) * 90 + pm(s.sacrifices) * 280 + pm(s.brilliantPlus) * 150)
    const tactics = clamp(pm(s.inducedErrors) * 120 + pm(s.swingsFor) * 300 + pm(s.brilliantPlus) * 140 + pm(s.cpWon) * 1.2)
    const errLoad = pm(s.errInacc + 2.5 * s.errMist + 5 * s.errBlund)
    const solidity = clamp(100 - errLoad * 60 - pm(s.swingsAgainst) * 250 - pm(s.cpLost) * 0.8)
    const defendAvg = s.defendCount > 0 ? s.defendSum / s.defendCount : 50
    const resilience = clamp(shrink50(defendAvg, s.defendCount, 15))
    const endDeltaAvg = s.endDeltaW > 0 ? s.endDeltaSum / s.endDeltaW : 0
    let endgame = shrink50(50 + endDeltaAvg * 2.2, s.endDeltaW, 25)
    if (s.endgamesReached > 0) endgame = 0.65 * endgame + 0.35 * (s.endgameWins / s.endgamesReached) * 100
    endgame = clamp(endgame)
    const openingAvg = s.openingAccW > 0 ? s.openingAccSum / s.openingAccW : 50
    const opening = clamp(shrink50(openingAvg, s.openingMoves, 40) + pm(s.bookMoves) * 60)
    return [
      { axis: 'Aggression', value: aggression },
      { axis: 'Tactics', value: tactics },
      { axis: 'Solidity', value: solidity },
      { axis: 'Resilience', value: resilience },
      { axis: 'Endgame', value: endgame },
      { axis: 'Opening', value: opening }
    ]
  })

  const radarPoints = computed(() => {
    const data = playstyleData.value
    if (!data) return ''
    const n = data.length, center = 100, radius = 72
    return data.map((d, i) => {
      const angle = (i * (360 / n) - 90) * Math.PI / 180
      return `${center + (d.value / 100) * radius * Math.cos(angle)},${center + (d.value / 100) * radius * Math.sin(angle)}`
    }).join(' ')
  })

  const radarVertices = computed(() => {
    const data = playstyleData.value
    if (!data) return []
    const n = data.length, center = 100, radius = 72
    return data.map((d, i) => {
      const angle = (i * (360 / n) - 90) * Math.PI / 180
      return { x: center + (d.value / 100) * radius * Math.cos(angle), y: center + (d.value / 100) * radius * Math.sin(angle) }
    })
  })

  const radarAxes = computed(() => {
    const n = playstyleData.value?.length || 6
    const center = 100, radius = 72
    return Array.from({ length: n }).map((_, i) => {
      const angle = (i * (360 / n) - 90) * Math.PI / 180
      return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) }
    })
  })

  const radarGrid = computed(() => {
    const n = playstyleData.value?.length || 6
    const center = 100, radius = 72
    return [0.25, 0.5, 0.75, 1].map(level =>
      Array.from({ length: n }).map((_, i) => {
        const angle = (i * (360 / n) - 90) * Math.PI / 180
        return `${center + level * radius * Math.cos(angle)},${center + level * radius * Math.sin(angle)}`
      }).join(' ')
    )
  })

  const radarLabels = computed(() => {
    const data = playstyleData.value
    if (!data) return []
    const n = data.length, center = 100, radius = 88
    return data.map((d, i) => {
      const angle = (i * (360 / n) - 90) * Math.PI / 180
      return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle), label: d.axis, value: d.value.toFixed(0) }
    })
  })

  const playstyleNote = computed(() => {
    const s = playstyleAgg.value
    const data = playstyleData.value
    if (!s || !data) return null
    const sorted = [...data].sort((a, b) => b.value - a.value)
    const top = sorted[0], second = sorted[1]
    const g = s.games
    const f1 = (v) => (v / g).toFixed(1)
    const f2 = (v) => (v / g).toFixed(2)
    const c = {
      forcing: f1(s.forcingMoves), checks: f1(s.checks), captures: f1(s.captures), sacs: f2(s.sacrifices),
      brill: f1(s.brilliantPlus), induced: f1(s.inducedErrors), swingsFor: f2(s.swingsFor), swingsAgainst: f2(s.swingsAgainst),
      errors: f1(s.errMist + s.errBlund),
      attack: s.attackCount > 0 ? (s.attackSum / s.attackCount).toFixed(1) : '—',
      defend: s.defendCount > 0 ? (s.defendSum / s.defendCount).toFixed(1) : '—',
      defendMoves: s.defendCount,
      endDelta: s.endDeltaW > 0 ? (s.endDeltaSum / s.endDeltaW).toFixed(1) : '—',
      conv: s.endgamesReached > 0 ? Math.round((s.endgameWins / s.endgamesReached) * 100) : null,
      opening: s.openingAccW > 0 ? (s.openingAccSum / s.openingAccW).toFixed(1) : '—',
      book: f1(s.bookMoves)
    }
    const notes = {
      Aggression: { title: 'The Firebrand', body: () => `You average ${c.forcing} forcing moves per game — ${c.checks} checks and ${c.captures} captures — and offer ${c.sacs} compensated sacrifices per game. You don't wait for sharp positions, you create them. The classic warning applies: attacks need fuel. When the initiative stalls, make sure you're not left a pawn down with a dead position.` },
      Tactics: { title: 'The Calculator', body: () => `Your strong moves are genuinely uncomfortable to answer — opponents crack for ${c.induced} weighted errors per game right after you find a good move, and the eval bar swings ≥1.5 pawns your way ${c.swingsFor} times per game (${c.brill} brilliant/great moves per game). You're at your best in concrete sequences — just watch the clock.` },
      Solidity: { title: 'The Fortress', body: () => `You hand opponents almost nothing: ${c.errors} mistakes-plus-blunders per game and only ${c.swingsAgainst} eval collapses per game.${c.attack !== '—' ? ` And when you're pressing, you keep composure — ${c.attack}% accuracy with a clear advantage.` : ''} The one risk: against lower-rated opponents, ultra-solid play can dissipate winning chances.` },
      Resilience: { title: 'The Escape Artist', body: () => `A rare skill: when the engine says you're clearly worse, you still find ${c.defend}% accuracy across ${c.defendMoves} defensive moves. Most players collapse under that pressure — you dig in and make them prove it.` },
      Endgame: { title: 'The Technician', body: () => {
        if (c.endDelta === '—') return `Your games rarely reach an endgame yet, so this score rests on a small sample. When you hold a small edge, consider trading toward the fourth phase.`
        const above = Number(c.endDelta) >= 0
        const diff = Math.abs(Number(c.endDelta)).toFixed(1)
        const convLine = c.conv !== null ? `, and you convert ${c.conv}% of endgame-reaching games into wins` : ''
        return `Your endgame accuracy sits ${diff}% ${above ? 'above' : 'below'} your overall accuracy${convLine}. ${above ? 'Trade into endgames earlier when you have the option.' : 'Start with rook endgames — they are the most common and the most trainable.'}`
      }},
      Opening: { title: 'The Scholar', body: () => `You score ${c.opening}% accuracy in the opening with ${c.book} book moves per game — you know your lines and trust them. The next step: make sure the middlegame doesn't run on autopilot once theory ends.` }
    }
    const t = notes[top.axis]
    return { title: t.title, trait: top.axis, body: t.body(), secondary: top.value - second.value < 15 ? `You also show strong ${second.axis.toLowerCase()} tendencies.` : null }
  })

  const playstyleFormulas = [
    { axis: 'Aggression', formula: 'Checks (×2.2), captures (×0.9), compensated sacrifices (×2.8) and brilliant/great moves (×1.5) per own move.' },
    { axis: 'Tactics', formula: 'Weighted opponent errors induced after your strong moves, plus ≥1.5-pawn eval swings in your favor and centipawns won per move.' },
    { axis: 'Solidity', formula: 'Starts at 100 and subtracts your inaccuracies, mistakes (×2.5), blunders (×5), eval collapses and centipawns lost per own move.' },
    { axis: 'Resilience', formula: 'Average move accuracy while defending positions where you stand ≥1.5 pawns worse. Small samples regress toward 50.' },
    { axis: 'Endgame', formula: 'Endgame accuracy relative to your overall accuracy (move-weighted), blended 65/35 with your win rate in endgame-reaching games.' },
    { axis: 'Opening', formula: 'Move-weighted opening-phase accuracy plus a bonus for book-move frequency, regressed toward 50 on small samples.' }
  ]

  // --- Trend ---
  const RECENT_WINDOW = 5
  const trend = computed(() => {
    const withAcc = insights.value.filter(g => g.insights?.overallAccuracy !== null)
    if (withAcc.length < 4) return null
    const recent = withAcc.slice(0, RECENT_WINDOW)
    const older = withAcc.slice(RECENT_WINDOW)
    if (older.length === 0) return null
    const avg = (arr) => arr.reduce((a, g) => a + g.insights.overallAccuracy, 0) / arr.length
    const delta = avg(recent) - avg(older)
    return { delta: delta.toFixed(1), direction: delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat' }
  })

  const trendText = computed(() => {
    if (!trend.value) return ''
    const d = Math.abs(parseFloat(trend.value.delta)).toFixed(1)
    if (trend.value.direction === 'up') return `${d} points above your earlier games`
    if (trend.value.direction === 'down') return `${d} points below your earlier games`
    return 'Steady compared with your earlier games'
  })

  // --- Phase Accuracy ---
  const phaseAccuracy = computed(() => {
    const phases = { opening: [], middlegame: [], endgame: [] }
    insights.value.forEach(g => {
      if (g.insights?.phaseAccuracy) {
        if (g.insights.phaseAccuracy.opening !== null) phases.opening.push(g.insights.phaseAccuracy.opening)
        if (g.insights.phaseAccuracy.middlegame !== null) phases.middlegame.push(g.insights.phaseAccuracy.middlegame)
        if (g.insights.phaseAccuracy.endgame !== null) phases.endgame.push(g.insights.phaseAccuracy.endgame)
      }
    })
    const calc = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null
    let oAcc = calc(phases.opening), mAcc = calc(phases.middlegame), eAcc = calc(phases.endgame)
    return {
      opening: { val: oAcc, meta: getAccuracyMeta(oAcc ? parseFloat(oAcc) : null), n: phases.opening.length },
      middlegame: { val: mAcc, meta: getAccuracyMeta(mAcc ? parseFloat(mAcc) : null), n: phases.middlegame.length },
      endgame: { val: eAcc, meta: getAccuracyMeta(eAcc ? parseFloat(eAcc) : null), n: phases.endgame.length }
    }
  })

  // --- Move Counts ---
  const moveCounts = computed(() => {
    const totals = { brilliant: 0, great: 0, best: 0, book: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    insights.value.forEach(g => { if (g.insights?.moveCounts) { for (const key in totals) totals[key] += g.insights.moveCounts[key] || 0 } })
    return totals
  })

  const moveCountsWithAvg = computed(() => {
    const totals = { brilliant: 0, great: 0, best: 0, book: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    insights.value.forEach(g => { if (g.insights?.moveCounts) { for (const key in totals) totals[key] += g.insights.moveCounts[key] || 0 } })
    const games = totalGames.value || 1
    return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { total: v, avg: v / games }]))
  })

  const moveCountsTotal = computed(() => Object.values(moveCounts.value).reduce((a, b) => a + b, 0))
  const classificationOrder = ['brilliant', 'great', 'best', 'book', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']

  // --- Classification Meta ---
  const classificationMeta = {
    brilliant: { label: 'Brilliant', color: '#03aea7', icon: '/moveClassifications/brilliant.png' },
    great: { label: 'Great', color: '#4c8cb5', icon: '/moveClassifications/great.png' },
    best: { label: 'Best', color: '#6ad13f', icon: '/moveClassifications/best.png' },
    book: { label: 'Book', color: '#ad8760', icon: '/moveClassifications/book.png' },
    excellent: { label: 'Excellent', color: '#90bc36', icon: '/moveClassifications/excellent.png' },
    good: { label: 'Good', color: '#8eae83', icon: '/moveClassifications/good.png' },
    inaccuracy: { label: 'Inaccuracy', color: '#f2bc43', icon: '/moveClassifications/inaccuracy.png' },
    mistake: { label: 'Mistake', color: '#f38800', icon: '/moveClassifications/mistake.png' },
    blunder: { label: 'Blunder', color: '#FF0000', icon: '/moveClassifications/blunder.png' }
  }

  const moveCountsBarSegments = computed(() => {
    const total = moveCountsTotal.value
    if (!total) return []
    return classificationOrder
      .map(key => ({ key, count: moveCounts.value[key], percent: (moveCounts.value[key] / total) * 100, meta: classificationMeta[key] }))
      .filter(seg => seg.count > 0)
  })

  // --- Heatmap ---
  function generateHeatmapData(type) {
    const squareKey = type === 'bad' ? 'blunderSquares' : 'goodSquares'
    const squares = {}
    let max = 0
    insights.value.forEach(g => {
      if (g.insights?.[squareKey]) {
        for (const sq in g.insights[squareKey]) {
          squares[sq] = (squares[sq] || 0) + g.insights[squareKey][sq]
          if (squares[sq] > max) max = squares[sq]
        }
      }
    })
    return { squares, max }
  }

  function generateBoardData(heatmap) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const ranks = [8, 7, 6, 5, 4, 3, 2, 1]
    const rows = []
    for (const rank of ranks) {
      const row = []
      for (const file of files) {
        const sq = `${file}${rank}`
        const count = heatmap.squares[sq] || 0
        const intensity = heatmap.max > 0 ? count / heatmap.max : 0
        row.push({ sq, count, intensity })
      }
      rows.push(row)
    }
    return rows
  }

  const badHeatmap = computed(() => generateHeatmapData('bad'))
  const totalBadMoves = computed(() => Object.values(badHeatmap.value.squares).reduce((a, b) => a + b, 0))
  const badBoardSquares = computed(() => generateBoardData(badHeatmap.value))

  const goodHeatmap = computed(() => generateHeatmapData('good'))
  const totalGoodMoves = computed(() => Object.values(goodHeatmap.value.squares).reduce((a, b) => a + b, 0))
  const goodBoardSquares = computed(() => generateBoardData(goodHeatmap.value))

  const selectedSquare = ref(null)
  function tapSquare(sq) {
    selectedSquare.value = selectedSquare.value?.sq === sq.sq ? null : sq
  }

  // Heatmap drill-down: games where this square appears
  const heatmapDrillDown = computed(() => {
    if (!selectedSquare.value) return []
    const sq = selectedSquare.value.sq
    const isBad = badHeatmap.value.squares[sq] > 0
    const key = isBad ? 'blunderSquares' : 'goodSquares'
    return insights.value.filter(g => g.insights?.[key]?.[sq]).map(g => {
      const c = g.insights?.myColor || 'white'
      const opponent = normalizePlayer(c === 'white' ? g.black : g.white)
      const player = normalizePlayer(c === 'white' ? g.white : g.black)
      let outcome = 'draw'
      if (player.result === 'win') outcome = 'win'
      else if (['lose', 'loss', 'checkmated', 'resigned', 'abandoned'].includes(player.result)) outcome = 'loss'
      return { id: g.id, opponent: opponent.username, outcome, accuracy: g.insights?.overallAccuracy?.toFixed(1) || '—', count: g.insights[key][sq] }
    })
  })

  // --- Openings ---
  const allOpenings = computed(() => {
    const counts = {}
    insights.value.forEach(g => {
      const name = g.insights?.opening && g.insights.opening !== "Unknown Opening" ? g.insights.opening : "Unrecognized Opening"
      if (!counts[name]) counts[name] = { name, count: 0, accuracy: [], win: 0, loss: 0, draw: 0, asWhite: { count: 0, win: 0, loss: 0, draw: 0 }, asBlack: { count: 0, win: 0, loss: 0, draw: 0 }, games: [] }
      const o = counts[name]
      o.count++
      if (g.insights?.overallAccuracy !== null) o.accuracy.push(g.insights.overallAccuracy)
      const c = g.insights?.myColor || 'white'
      const player = normalizePlayer(c === 'white' ? g.white : g.black)
      const opponent = normalizePlayer(c === 'white' ? g.black : g.white)
      let outcome = 'draw'
      if (player.result === 'win') outcome = 'win'
      else if (['lose', 'loss', 'checkmated', 'resigned', 'abandoned'].includes(player.result)) outcome = 'loss'
      o[outcome]++
      const colorKey = c === 'white' ? 'asWhite' : 'asBlack'
      o[colorKey].count++
      o[colorKey][outcome]++
      o.games.push({ id: g.id, opponent: opponent.username, outcome, accuracy: g.insights?.overallAccuracy?.toFixed(1) || '—', myColor: c })
    })
    return Object.values(counts)
      .map(o => ({
        ...o,
        avgAccuracy: o.accuracy.length ? (o.accuracy.reduce((a, b) => a + b, 0) / o.accuracy.length).toFixed(1) : null,
        meta: o.accuracy.length ? getAccuracyMeta(o.accuracy.reduce((a, b) => a + b, 0) / o.accuracy.length) : getAccuracyMeta(null)
      }))
      .sort((a, b) => b.count - a.count)
  })

  const worstOpening = computed(() => {
    const candidates = allOpenings.value.filter(o => o.count >= 5 && o.avgAccuracy !== null)
    if (candidates.length === 0) return null
    return candidates.reduce((worst, o) => parseFloat(o.avgAccuracy) < parseFloat(worst.avgAccuracy) ? o : worst)
  })

  const expandedOpening = ref(null)
  function toggleOpening(name) {
    expandedOpening.value = expandedOpening.value === name ? null : name
  }

  // --- Tab gating ---
  function setTab(tab) { activeTab.value = tab }
</script>

<template>
  <div class="page-layout">
    <Title />
    <div class="content-area">
      <div class="insights-card">
        <header class="card-header">
          <h1 class="insights-title">Insights</h1>
          <p class="insights-subtitle">What your analyzed games say about how you play.</p>
        </header>

        <div v-if="loading" class="empty-state">
          <div class="loading-spinner"><div class="spinner-ring"></div><div class="spinner-ring"></div><div class="spinner-ring"></div></div>
          <p>Crunching the numbers…</p>
        </div>
        <div v-else-if="!currentUser" class="empty-state"><p>Log in to see your insights.</p></div>
        <div v-else-if="insights.length === 0" class="empty-state"><p>No data yet. Analyze a game from your library and your insights will show up here.</p></div>

        <div v-else class="dashboard-layout">
          <nav class="side-nav" aria-label="Insights sections">
            <button
              v-for="t in tabs"
              :key="t.id"
              type="button"
              class="nav-btn"
              :class="{ active: activeTab === t.id }"
              :aria-current="activeTab === t.id ? 'page' : undefined"
              @click="setTab(t.id)"
            >{{ t.label }}</button>
          </nav>

          <div class="tab-content-area">
            <div class="tab-panel">

              <!-- OVERVIEW -->
              <template v-if="activeTab === 'overview'">
                <section class="hero">
                  <div class="hero-main">
                    <span class="muted">Overall accuracy</span>
                    <span class="hero-value" :style="{ color: overallMeta.color }">{{ overallAccuracy !== null ? overallAccuracy : '—' }}<small v-if="overallAccuracy !== null">%</small></span>
                    <div class="hero-sub">
                      <img v-if="overallMeta.icon" :src="overallMeta.icon" class="hero-icon" alt="" />
                      <span>{{ overallMeta.label }} on average</span>
                    </div>
                    <p v-if="trend" class="trend" :class="trend.direction">{{ trendText }}</p>
                  </div>
                  <dl class="hero-facts">
                    <div><dt>Games</dt><dd>{{ totalGames }}</dd></div>
                    <div><dt>Moves analyzed</dt><dd>{{ totalMoves }}</dd></div>
                    <div><dt>Mistakes and blunders</dt><dd class="loss-text">{{ moveCounts.blunder + moveCounts.mistake }}</dd></div>
                  </dl>
                </section>

                <section v-if="sparklineData" class="block">
                  <h3 class="block-title">Accuracy over time</h3>
                  <div class="chart">
                    <svg :viewBox="`0 0 ${sparklineData.width} ${sparklineData.height}`" preserveAspectRatio="none" class="chart-svg">
                      <line x1="0" :y1="sparklineData.height * 0.25" :x2="sparklineData.width" :y2="sparklineData.height * 0.25" class="chart-grid" />
                      <line x1="0" :y1="sparklineData.height * 0.5" :x2="sparklineData.width" :y2="sparklineData.height * 0.5" class="chart-grid" />
                      <line x1="0" :y1="sparklineData.height * 0.75" :x2="sparklineData.width" :y2="sparklineData.height * 0.75" class="chart-grid" />
                      <polygon :points="sparklineData.area" class="chart-area" />
                      <polyline :points="sparklineData.points" class="chart-line" />
                    </svg>
                    <span class="chart-dot" :style="{ left: sparklineData.lastX + '%', top: sparklineData.lastY + '%' }"></span>
                  </div>
                  <div class="chart-foot">
                    <span>Oldest of {{ sparklineData.games }} games</span>
                    <span>Best {{ sparklineData.high }}%, worst {{ sparklineData.low }}%</span>
                    <span>Latest {{ sparklineData.lastAcc }}%</span>
                  </div>
                </section>

                <section v-if="coachDigest" class="block">
                  <h3 class="block-title">What to work on</h3>
                  <ul class="notes">
                    <li v-for="(line, i) in coachDigest" :key="i">{{ line }}</li>
                  </ul>
                </section>

                <section v-if="recentGames.length" class="block">
                  <h3 class="block-title">Recent games</h3>
                  <div class="table">
                    <div class="trow thead recent-grid">
                      <span>Result</span><span>Opponent</span><span class="hide-sm">Opening</span><span class="right">Accuracy</span>
                    </div>
                    <div v-for="rg in recentGames" :key="rg.id" class="trow recent-grid">
                      <span class="result" :class="rg.outcome">{{ rg.outcome === 'win' ? 'Won' : rg.outcome === 'loss' ? 'Lost' : 'Draw' }}</span>
                      <span class="cell-strong ellipsis">{{ rg.opponent }}</span>
                      <span class="muted ellipsis hide-sm">{{ rg.opening }}</span>
                      <span class="right num" :style="{ color: rg.accMeta.color }">{{ rg.accuracy }}%</span>
                    </div>
                  </div>
                </section>

                <section class="block">
                  <h3 class="block-title">Accuracy by phase</h3>
                  <div class="phase-list">
                    <div class="phase-row" v-for="(phase, key) in phaseAccuracy" :key="key">
                      <span class="phase-name">{{ key.charAt(0).toUpperCase() + key.slice(1) }}</span>
                      <div class="bar"><div class="bar-fill" :style="{ width: (phase.val || 0) + '%', background: phase.meta.color }"></div></div>
                      <span class="phase-val num" :style="{ color: phase.meta.color }">{{ phase.val !== null ? phase.val + '%' : '—' }}</span>
                      <span class="phase-n muted">{{ phase.n }} game{{ phase.n === 1 ? '' : 's' }}</span>
                    </div>
                  </div>
                </section>

                <section v-if="hasMoveBuckets" class="block">
                  <h3 class="block-title">Accuracy by move number</h3>
                  <div class="columns">
                    <div v-for="b in moveBucketData" :key="b.label" class="column" :class="{ empty: !b.avgAcc }">
                      <span class="column-val num" :style="{ color: b.meta.color }">{{ b.avgAcc ? b.avgAcc + '%' : '—' }}</span>
                      <div class="column-track"><div class="column-fill" :style="{ height: (b.avgAcc || 0) + '%', background: b.meta.color }"></div></div>
                      <span class="column-label">Moves {{ b.label }}</span>
                      <span class="column-n muted">{{ b.count }} played</span>
                    </div>
                  </div>
                </section>
              </template>

              <!-- MOVE CLASSES -->
              <template v-if="activeTab === 'moves'">
                <section class="block first">
                  <h3 class="block-title">How your {{ moveCountsTotal }} moves were rated</h3>
                  <div class="stack" v-if="moveCountsBarSegments.length">
                    <div v-for="seg in moveCountsBarSegments" :key="seg.key" class="stack-seg" :style="{ width: seg.percent + '%', background: seg.meta.color }" :title="`${seg.meta.label}: ${seg.count} (${seg.percent.toFixed(1)}%)`"></div>
                  </div>
                </section>
                <section class="block">
                  <div class="table">
                    <div class="trow thead class-grid">
                      <span></span><span>Rating</span><span class="right">Moves</span><span class="right hide-sm">Share</span><span class="right">Per game</span>
                    </div>
                    <div v-for="(meta, key) in classificationMeta" :key="key" class="trow class-grid">
                      <img :src="meta.icon" class="class-icon" :alt="meta.label" />
                      <span class="cell-strong" :style="{ color: meta.color }">{{ meta.label }}</span>
                      <span class="right num">{{ moveCountsWithAvg[key].total }}</span>
                      <span class="right num muted hide-sm">{{ moveCountsTotal ? ((moveCounts[key] / moveCountsTotal) * 100).toFixed(1) + '%' : '—' }}</span>
                      <span class="right num muted">{{ moveCountsWithAvg[key].avg.toFixed(2) }}</span>
                    </div>
                  </div>
                </section>
              </template>

              <!-- COLORS -->
              <template v-if="activeTab === 'colors'">
                <div class="split">
                  <section v-for="side in ['white', 'black']" :key="side" class="split-col">
                    <div class="split-head">
                      <span class="swatch" :class="side"></span>
                      <h3 class="block-title tight">As {{ side }}</h3>
                    </div>
                    <span class="big-num" :style="{ color: colorPerformance[side].avgAcc ? getAccuracyMeta(parseFloat(colorPerformance[side].avgAcc)).color : 'inherit' }">{{ colorPerformance[side].avgAcc ? colorPerformance[side].avgAcc + '%' : '—' }}</span>
                    <span class="muted">average accuracy</span>
                    <dl class="facts">
                      <div><dt>Games</dt><dd>{{ colorPerformance[side].games }}</dd></div>
                      <div><dt>Mistakes and blunders</dt><dd class="loss-text">{{ colorPerformance[side].blunders }}</dd></div>
                    </dl>
                    <div class="wld-bar">
                      <div class="wld-segment win" :style="{ width: (colorPerformance[side].games > 0 ? (colorPerformance[side].win / colorPerformance[side].games) * 100 : 0) + '%' }"></div>
                      <div class="wld-segment draw" :style="{ width: (colorPerformance[side].games > 0 ? (colorPerformance[side].draw / colorPerformance[side].games) * 100 : 0) + '%' }"></div>
                      <div class="wld-segment loss" :style="{ width: (colorPerformance[side].games > 0 ? (colorPerformance[side].loss / colorPerformance[side].games) * 100 : 0) + '%' }"></div>
                    </div>
                    <div class="wld-legend">
                      <span><i class="dot win"></i>Won {{ colorPerformance[side].win }}</span>
                      <span><i class="dot draw"></i>Drew {{ colorPerformance[side].draw }}</span>
                      <span><i class="dot loss"></i>Lost {{ colorPerformance[side].loss }}</span>
                    </div>
                  </section>
                </div>
              </template>

              <!-- PIECES -->
              <template v-if="activeTab === 'pieces'">
                <section class="block first">
                  <div class="table">
                    <div class="trow thead piece-grid">
                      <span></span><span>Piece</span><span class="hide-sm">Moves</span><span>Accuracy</span>
                    </div>
                    <div v-for="p in pieceData" :key="p.key" class="trow piece-grid">
                      <span class="piece-symbol" :style="{ color: p.color }">{{ p.symbol }}</span>
                      <span class="cell-strong">{{ p.label }}</span>
                      <span class="muted num hide-sm">{{ p.count }} ({{ p.movePercent }}%)</span>
                      <span class="piece-acc">
                        <span class="bar"><span class="bar-fill" :style="{ width: (p.avgAcc || 0) + '%', background: p.meta.color }"></span></span>
                        <span class="num piece-val" :style="{ color: p.meta.color }">{{ p.avgAcc !== null ? p.avgAcc + '%' : '—' }}</span>
                      </span>
                    </div>
                  </div>
                </section>
              </template>

              <!-- OPENINGS -->
              <template v-if="activeTab === 'openings'">
                <p v-if="worstOpening" class="callout">
                  Your weakest opening with 5 or more games is <strong>{{ worstOpening.name }}</strong>: {{ worstOpening.avgAccuracy }}% accuracy over {{ worstOpening.count }} games.
                </p>
                <section class="block" :class="{ first: !worstOpening }">
                  <div class="openings-list">
                    <div v-for="opening in allOpenings" :key="opening.name" class="opening-block">
                      <button type="button" class="opening-row" :aria-expanded="expandedOpening === opening.name" @click="toggleOpening(opening.name)">
                        <span class="opening-name">{{ opening.name }}</span>
                        <span class="opening-games muted num">{{ opening.count }} game{{ opening.count === 1 ? '' : 's' }}</span>
                        <span class="opening-acc num" v-if="opening.avgAccuracy" :style="{ color: opening.meta.color }">{{ opening.avgAccuracy }}%</span>
                        <svg class="chevron" :class="{ open: expandedOpening === opening.name }" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                      <div v-if="expandedOpening === opening.name" class="opening-detail">
                        <div class="opening-wld-row">
                          <div class="wld-mini"><span class="wld-mini-label">Overall</span><span class="wld-mini-vals num"><span class="w">W {{ opening.win }}</span><span class="d">D {{ opening.draw }}</span><span class="l">L {{ opening.loss }}</span></span></div>
                          <div class="wld-mini"><span class="wld-mini-label">As white</span><span class="wld-mini-vals num"><span class="w">W {{ opening.asWhite.win }}</span><span class="d">D {{ opening.asWhite.draw }}</span><span class="l">L {{ opening.asWhite.loss }}</span></span></div>
                          <div class="wld-mini"><span class="wld-mini-label">As black</span><span class="wld-mini-vals num"><span class="w">W {{ opening.asBlack.win }}</span><span class="d">D {{ opening.asBlack.draw }}</span><span class="l">L {{ opening.asBlack.loss }}</span></span></div>
                        </div>
                        <div class="table">
                          <div v-for="og in opening.games" :key="og.id" class="trow og-grid">
                            <span class="result" :class="og.outcome">{{ og.outcome === 'win' ? 'Won' : og.outcome === 'loss' ? 'Lost' : 'Draw' }}</span>
                            <span class="cell-strong ellipsis">{{ og.opponent }}</span>
                            <span class="muted">{{ og.myColor === 'white' ? 'White' : 'Black' }}</span>
                            <span class="right num muted">{{ og.accuracy }}%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </template>

              <!-- STAMINA -->
              <template v-if="activeTab === 'stamina'">
                <div class="split three">
                  <section v-for="bucket in gameLengthStats" :key="bucket.label" class="split-col">
                    <h3 class="block-title tight">{{ bucket.label }}</h3>
                    <span class="big-num" :style="{ color: bucket.avgAcc ? getAccuracyMeta(parseFloat(bucket.avgAcc)).color : 'inherit' }">{{ bucket.avgAcc ? bucket.avgAcc + '%' : '—' }}</span>
                    <span class="muted">{{ bucket.games }} game{{ bucket.games === 1 ? '' : 's' }}</span>
                    <div class="wld-bar">
                      <div class="wld-segment win" :style="{ width: (bucket.games > 0 ? (bucket.win / bucket.games) * 100 : 0) + '%' }"></div>
                      <div class="wld-segment draw" :style="{ width: (bucket.games > 0 ? (bucket.draw / bucket.games) * 100 : 0) + '%' }"></div>
                      <div class="wld-segment loss" :style="{ width: (bucket.games > 0 ? (bucket.loss / bucket.games) * 100 : 0) + '%' }"></div>
                    </div>
                    <div class="wld-legend">
                      <span><i class="dot win"></i>{{ bucket.win }}</span>
                      <span><i class="dot draw"></i>{{ bucket.draw }}</span>
                      <span><i class="dot loss"></i>{{ bucket.loss }}</span>
                    </div>
                    <dl class="facts">
                      <div><dt>Mistakes and blunders</dt><dd class="loss-text">{{ bucket.blunders }}</dd></div>
                    </dl>
                  </section>
                </div>
              </template>

              <!-- PLAYSTYLE -->
              <template v-if="activeTab === 'playstyle'">
                <template v-if="playstyleData">
                  <p class="muted lead" v-if="playstyleAgg">Based on {{ playstyleAgg.games }} analyzed game{{ playstyleAgg.games === 1 ? '' : 's' }} and {{ playstyleAgg.myMoves }} of your moves.</p>
                  <div class="playstyle-top">
                    <div class="radar-container">
                      <svg viewBox="-12 -4 224 208" class="radar-svg" role="img" aria-label="Playstyle radar chart">
                        <polygon v-for="(points, i) in radarGrid" :key="i" :points="points" fill="none" class="radar-ring" />
                        <line v-for="(a, i) in radarAxes" :key="'ax-' + i" x1="100" y1="100" :x2="a.x" :y2="a.y" class="radar-axis" />
                        <polygon v-if="radarPoints" :points="radarPoints" class="radar-shape" />
                        <circle v-for="(v, i) in radarVertices" :key="'v-' + i" :cx="v.x" :cy="v.y" r="2.6" class="radar-dot" />
                        <text v-for="label in radarLabels" :key="label.label" :x="label.x" :y="label.y" text-anchor="middle" dominant-baseline="middle" class="radar-label">{{ label.label }}</text>
                      </svg>
                    </div>
                    <div class="playstyle-traits">
                      <div v-for="d in playstyleData" :key="d.axis" class="trait-row">
                        <span class="trait-name">{{ d.axis }}</span>
                        <div class="bar"><div class="bar-fill accent" :style="{ width: d.value + '%' }"></div></div>
                        <span class="trait-val num">{{ d.value.toFixed(0) }}</span>
                      </div>
                    </div>
                  </div>
                  <section class="block" v-if="playstyleNote">
                    <h3 class="note-title">{{ playstyleNote.title }}</h3>
                    <p class="muted tag">Strongest trait: {{ playstyleNote.trait }}</p>
                    <p class="prose">{{ playstyleNote.body }}</p>
                    <p class="prose muted" v-if="playstyleNote.secondary">{{ playstyleNote.secondary }}</p>
                  </section>
                  <details class="block formulas">
                    <summary>How each trait is calculated</summary>
                    <div v-for="f in playstyleFormulas" :key="f.axis" class="formula-row">
                      <span class="formula-axis">{{ f.axis }}</span>
                      <span class="formula-text">{{ f.formula }}</span>
                    </div>
                    <p class="fineprint">Each trait is scored from 0 to 100 on its own, so the values don't add up to 100.</p>
                    <p class="fineprint" v-if="legacyPlaystyleGames > 0">{{ legacyPlaystyleGames }} game{{ legacyPlaystyleGames === 1 ? '' : 's' }} analyzed before this update use the old playstyle profile and aren't included.</p>
                  </details>
                </template>
                <div v-else class="panel-empty">
                  <p v-if="legacyPlaystyleGames > 0">Your {{ legacyPlaystyleGames }} saved game{{ legacyPlaystyleGames === 1 ? '' : 's' }} use the old playstyle profile. Re-analyze them from your library to see your full profile.</p>
                  <p v-else>Not enough data for a playstyle profile yet. Analyze a few more games.</p>
                </div>
              </template>

              <!-- HEATMAP -->
              <template v-if="activeTab === 'heatmap'">
                <div class="heatmap-panel">
                  <div class="heatmap-boards-container">
                    <div class="heatmap-instance">
                      <div class="heatmap-header">
                        <h3 class="block-title tight bad-color">Mistakes and blunders</h3>
                        <span class="muted num">{{ totalBadMoves }} on the board</span>
                      </div>
                      <div class="heatmap-board">
                        <div class="heatmap-rank-labels" aria-hidden="true"><span v-for="r in 8" :key="r">{{ 9 - r }}</span></div>
                        <div class="heatmap-grid-area">
                          <div class="heatmap-grid">
                            <div class="heatmap-row" v-for="row in badBoardSquares" :key="row[0].sq[1]">
                              <button v-for="sq in row" :key="sq.sq" type="button" class="heatmap-square bad"
                                :class="{ light: (sq.sq.charCodeAt(0) + sq.sq.charCodeAt(1)) % 2 === 0, dark: (sq.sq.charCodeAt(0) + sq.sq.charCodeAt(1)) % 2 !== 0, active: sq.intensity > 0, selected: selectedSquare?.sq === sq.sq }"
                                :style="{ '--intensity': sq.intensity }" :title="`${sq.sq}: ${sq.count} mistake${sq.count === 1 ? '' : 's'}`" @click="tapSquare(sq)">
                                <span v-if="sq.count > 0" class="sq-count">{{ sq.count }}</span>
                              </button>
                            </div>
                          </div>
                          <div class="heatmap-file-labels" aria-hidden="true"><span v-for="f in ['a','b','c','d','e','f','g','h']" :key="f">{{ f }}</span></div>
                        </div>
                      </div>
                    </div>
                    <div class="heatmap-instance">
                      <div class="heatmap-header">
                        <h3 class="block-title tight good-color">Strong moves</h3>
                        <span class="muted num">{{ totalGoodMoves }} on the board</span>
                      </div>
                      <div class="heatmap-board">
                        <div class="heatmap-rank-labels" aria-hidden="true"><span v-for="r in 8" :key="r">{{ 9 - r }}</span></div>
                        <div class="heatmap-grid-area">
                          <div class="heatmap-grid">
                            <div class="heatmap-row" v-for="row in goodBoardSquares" :key="row[0].sq[1]">
                              <button v-for="sq in row" :key="sq.sq" type="button" class="heatmap-square good"
                                :class="{ light: (sq.sq.charCodeAt(0) + sq.sq.charCodeAt(1)) % 2 === 0, dark: (sq.sq.charCodeAt(0) + sq.sq.charCodeAt(1)) % 2 !== 0, active: sq.intensity > 0, selected: selectedSquare?.sq === sq.sq }"
                                :style="{ '--intensity': sq.intensity }" :title="`${sq.sq}: ${sq.count} strong move${sq.count === 1 ? '' : 's'}`" @click="tapSquare(sq)">
                                <span v-if="sq.count > 0" class="sq-count">{{ sq.count }}</span>
                              </button>
                            </div>
                          </div>
                          <div class="heatmap-file-labels" aria-hidden="true"><span v-for="f in ['a','b','c','d','e','f','g','h']" :key="f">{{ f }}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="selectedSquare" class="heatmap-drilldown">
                    <h4 class="drilldown-title">{{ selectedSquare.sq }}: {{ selectedSquare.count }} move{{ selectedSquare.count === 1 ? '' : 's' }}</h4>
                    <div v-if="heatmapDrillDown.length" class="table">
                      <div v-for="dg in heatmapDrillDown" :key="dg.id" class="trow dg-grid">
                        <span class="result" :class="dg.outcome">{{ dg.outcome === 'win' ? 'Won' : dg.outcome === 'loss' ? 'Lost' : 'Draw' }}</span>
                        <span class="cell-strong ellipsis">{{ dg.opponent }}</span>
                        <span class="muted num">{{ dg.count }}× here</span>
                        <span class="right num muted">{{ dg.accuracy }}%</span>
                      </div>
                    </div>
                    <p v-else class="muted">No game details for this square.</p>
                  </div>
                  <p v-else class="muted center">Tap a square to see which games it came from.</p>
                </div>
              </template>

            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  .page-layout {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    padding: clamp(0.5rem, 3vw, 1rem);
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
    justify-self: center;
    min-width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  @media (min-width: 768px) {
    .page-layout { grid-template-columns: auto 1fr; gap: 1.5rem; }
  }

  .content-area {
    display: flex;
    justify-content: stretch;
    width: 100%;
    min-width: 0;
  }

  /* ===== Card + design tokens ============================================== */
  .insights-card {
    --accent: var(--text-highlight, #d9b382);
    --ink: #f4f0e3;
    --ink-2: rgba(244, 240, 227, 0.68);
    --ink-3: rgba(244, 240, 227, 0.42);
    --line: rgba(244, 240, 227, 0.09);
    --win: #8fd97a;
    --loss: #ff8a80;
    --draw: #d9b36a;

    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    height: calc(100vh - 2rem);
    max-height: 920px;
    overflow: hidden;
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--panel-1, #262421);
    font-variant-numeric: tabular-nums;
  }

  .card-header {
    flex-shrink: 0;
    padding: clamp(1.25rem, 3vw, 2rem) clamp(1.25rem, 3vw, 2rem) 1.1rem;
    border-bottom: 1px solid var(--line);
  }

  .insights-title {
    margin: 0;
    font-size: clamp(1.7rem, 3.4vw, 2.3rem);
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.1;
    color: var(--ink);
  }

  .insights-subtitle {
    margin: 0.35rem 0 0;
    font-size: 0.95rem;
    color: var(--ink-2);
  }

  /* ===== Shared bits ======================================================= */
  .muted { color: var(--ink-3); }
  .num { font-variant-numeric: tabular-nums; }
  .right { text-align: right; justify-self: end; }
  .center { text-align: center; }
  .loss-text { color: var(--loss); }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .cell-strong { font-weight: 600; color: var(--ink); }

  .insights-card :is(button, summary):focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 1rem;
    padding: 2rem;
    color: var(--ink-2);
    text-align: center;
  }

  .panel-empty {
    max-width: 420px;
    margin: 2rem auto;
    text-align: center;
    color: var(--ink-2);
    font-size: 0.95rem;
    line-height: 1.55;
  }

  .loading-spinner { position: relative; width: 52px; height: 52px; }
  .spinner-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid transparent;
    border-top-color: var(--accent);
    animation: spinRing 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
  }
  .spinner-ring:nth-child(2) { inset: 7px; border-top-color: #a8d97a; animation-duration: 1.6s; animation-direction: reverse; }
  .spinner-ring:nth-child(3) { inset: 14px; border-top-color: var(--ink); animation-duration: 2s; }
  @keyframes spinRing { to { transform: rotate(360deg); } }

  /* ===== Layout: side nav + content ======================================== */
  .dashboard-layout {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .side-nav {
    flex: 0 0 11.5rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 1rem 0.75rem;
    border-right: 1px solid var(--line);
    overflow-y: auto;
    scrollbar-width: none;
  }
  .side-nav::-webkit-scrollbar { display: none; }

  .nav-btn {
    text-align: left;
    padding: 0.6rem 0.85rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 0.92rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .nav-btn:hover { background: rgba(255, 255, 255, 0.045); color: var(--ink); }
  .nav-btn.active {
    background: rgba(255, 255, 255, 0.075);
    color: var(--ink);
    font-weight: 600;
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .tab-content-area {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: clamp(1.1rem, 3vw, 2rem);
    scrollbar-width: thin;
    scrollbar-color: rgba(194, 197, 170, 0.35) transparent;
  }

  .tab-panel {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 780px;
    margin: 0 auto;
    width: 100%;
  }

  /* Section blocks: separated by a hairline, no boxes */
  .block { padding-top: 1.75rem; border-top: 1px solid var(--line); }
  .block.first { padding-top: 0; border-top: none; }
  .block-title {
    margin: 0 0 1rem;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .block-title.tight { margin: 0; }
  .lead { margin: 0; font-size: 0.9rem; }

  /* ===== Overview hero ===================================================== */
  .hero {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2rem;
    align-items: end;
  }

  .hero-main { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }

  .hero-value {
    font-size: clamp(4rem, 11vw, 6.5rem);
    font-weight: 600;
    letter-spacing: -0.05em;
    line-height: 0.92;
  }
  .hero-value small {
    font-size: 0.38em;
    font-weight: 500;
    letter-spacing: 0;
    margin-left: 0.12em;
    opacity: 0.7;
  }

  .hero-sub { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; color: var(--ink-2); font-size: 0.95rem; }
  .hero-icon { width: 22px; height: 22px; }

  .trend { margin: 0; font-size: 0.88rem; color: var(--ink-3); }
  .trend.up { color: var(--win); }
  .trend.down { color: var(--loss); }

  .hero-facts, .facts { margin: 0; display: flex; flex-direction: column; }
  .hero-facts div, .facts div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 2rem;
    padding: 0.6rem 0;
    border-top: 1px solid var(--line);
  }
  .hero-facts div:first-child, .facts div:first-child { border-top: none; }
  .hero-facts dt, .facts dt { font-size: 0.88rem; color: var(--ink-2); }
  .hero-facts dd, .facts dd { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; }
  .hero-facts { min-width: 14rem; }

  /* ===== Chart ============================================================= */
  .chart { position: relative; height: 150px; }
  .chart-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }
  .chart-grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 3 5; vector-effect: non-scaling-stroke; }
  .chart-area { fill: var(--accent); opacity: 0.1; }
  .chart-line { fill: none; stroke: var(--accent); stroke-width: 2.25; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .chart-dot {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--panel-1, #262421);
    box-shadow: 0 0 0 1px var(--accent);
    transform: translate(-50%, -50%);
  }
  .chart-foot { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.7rem; font-size: 0.8rem; color: var(--ink-3); flex-wrap: wrap; }

  /* ===== Notes ============================================================= */
  .notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .notes li {
    padding: 0.85rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--ink-2);
    max-width: 62ch;
  }
  .notes li:first-child { border-top: none; padding-top: 0; }

  /* ===== Tables ============================================================ */
  .table { display: flex; flex-direction: column; }
  .trow {
    display: grid;
    align-items: center;
    gap: 0.9rem;
    padding: 0.7rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.92rem;
  }
  .trow:first-child { border-top: none; }
  .trow.thead { font-size: 0.8rem; color: var(--ink-3); padding-top: 0; padding-bottom: 0.5rem; }

  .recent-grid { grid-template-columns: 3.4rem minmax(0, 1fr) minmax(0, 1.2fr) 4.5rem; }
  .class-grid { grid-template-columns: 1.6rem minmax(0, 1fr) 4rem 4.5rem 4.5rem; }
  .piece-grid { grid-template-columns: 2rem 5.5rem minmax(0, 9rem) minmax(0, 1fr); }
  .og-grid { grid-template-columns: 3.4rem minmax(0, 1fr) 4rem 4rem; }
  .dg-grid { grid-template-columns: 3.4rem minmax(0, 1fr) 5rem 4rem; }

  .result { font-weight: 600; font-size: 0.88rem; }
  .result.win { color: var(--win); }
  .result.loss { color: var(--loss); }
  .result.draw { color: var(--draw); }

  .class-icon { width: 22px; height: 22px; }
  .piece-symbol { font-size: 1.7rem; line-height: 1; }
  .piece-acc { display: flex; align-items: center; gap: 0.8rem; }
  .piece-val { width: 3.6rem; text-align: right; font-weight: 600; flex-shrink: 0; }

  /* ===== Bars ============================================================== */
  .bar { flex: 1; height: 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.07); overflow: hidden; display: block; }
  .bar-fill { display: block; height: 100%; border-radius: 999px; transition: width 0.4s ease; }
  .bar-fill.accent { background: var(--accent); }

  .phase-list { display: flex; flex-direction: column; }
  .phase-row {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr) 4rem 5rem;
    align-items: center;
    gap: 1rem;
    padding: 0.8rem 0;
    border-top: 1px solid var(--line);
  }
  .phase-row:first-child { border-top: none; padding-top: 0; }
  .phase-name { font-weight: 500; color: var(--ink); }
  .phase-val { text-align: right; font-weight: 600; font-size: 1.05rem; }
  .phase-n { font-size: 0.8rem; text-align: right; }

  /* Vertical columns for move-number buckets */
  .columns { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.75rem; align-items: end; }
  .column { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
  .column.empty { opacity: 0.4; }
  .column-val { font-size: 0.95rem; font-weight: 600; }
  .column-track { width: 100%; max-width: 3.2rem; height: 110px; display: flex; align-items: flex-end; background: rgba(255, 255, 255, 0.05); border-radius: 6px; overflow: hidden; }
  .column-fill { width: 100%; border-radius: 6px 6px 0 0; transition: height 0.4s ease; }
  .column-label { font-size: 0.82rem; color: var(--ink-2); }
  .column-n { font-size: 0.74rem; }

  /* Stacked bar */
  .stack { display: flex; width: 100%; height: 14px; border-radius: 999px; overflow: hidden; gap: 2px; }
  .stack-seg { height: 100%; }

  /* ===== Colors / Stamina columns ========================================= */
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .split.three { grid-template-columns: repeat(3, 1fr); }
  .split-col { display: flex; flex-direction: column; gap: 0.35rem; padding: 0 1.75rem; border-left: 1px solid var(--line); min-width: 0; }
  .split-col:first-child { padding-left: 0; border-left: none; }
  .split-col:last-child { padding-right: 0; }
  .split-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.9rem; }
  .swatch { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
  .swatch.white { background: #f4f0e3; }
  .swatch.black { background: #1a1a1a; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3); }
  .big-num { font-size: clamp(2.2rem, 5vw, 3rem); font-weight: 600; letter-spacing: -0.04em; line-height: 1; margin-top: 0.8rem; }
  .split-col .block-title.tight { margin-bottom: 0.2rem; }
  .split-col .facts { margin-top: 1rem; }

  .wld-bar { display: flex; width: 100%; height: 8px; border-radius: 999px; overflow: hidden; gap: 2px; margin-top: 1rem; background: rgba(255, 255, 255, 0.05); }
  .wld-segment { height: 100%; transition: width 0.4s ease; }
  .wld-segment.win { background: var(--win); }
  .wld-segment.draw { background: var(--draw); }
  .wld-segment.loss { background: var(--loss); }
  .wld-legend { display: flex; flex-wrap: wrap; gap: 0.9rem; margin-top: 0.6rem; font-size: 0.8rem; color: var(--ink-2); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.35rem; }
  .dot.win { background: var(--win); }
  .dot.draw { background: var(--draw); }
  .dot.loss { background: var(--loss); }

  /* ===== Openings ========================================================== */
  .callout {
    margin: 0;
    padding: 0.2rem 0 0.2rem 1rem;
    border-left: 3px solid var(--loss);
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--ink-2);
  }
  .callout strong { color: var(--ink); }

  .openings-list { display: flex; flex-direction: column; }
  .opening-block { border-top: 1px solid var(--line); }
  .opening-block:first-child { border-top: none; }

  .opening-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 4rem 1.2rem;
    align-items: center;
    gap: 1rem;
    width: 100%;
    padding: 0.9rem 0;
    border: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .opening-row:hover .opening-name { color: var(--accent); }
  .opening-name { font-weight: 600; font-size: 0.95rem; word-break: break-word; transition: color 0.15s ease; }
  .opening-games { font-size: 0.85rem; white-space: nowrap; }
  .opening-acc { font-weight: 600; text-align: right; }
  .chevron { color: var(--ink-3); transition: transform 0.2s ease; }
  .chevron.open { transform: rotate(180deg); }

  .opening-detail { padding: 0.25rem 0 1.1rem; }
  .opening-wld-row { display: flex; gap: 2rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
  .wld-mini { display: flex; flex-direction: column; gap: 0.2rem; }
  .wld-mini-label { font-size: 0.8rem; color: var(--ink-3); }
  .wld-mini-vals { display: flex; gap: 0.7rem; font-size: 0.9rem; font-weight: 600; }
  .wld-mini-vals .w { color: var(--win); }
  .wld-mini-vals .d { color: var(--draw); }
  .wld-mini-vals .l { color: var(--loss); }

  /* ===== Playstyle ========================================================= */
  .playstyle-top { display: grid; grid-template-columns: 300px 1fr; gap: 2rem; align-items: center; }
  .radar-container { width: 100%; max-width: 300px; aspect-ratio: 224 / 208; }
  .radar-svg { width: 100%; height: 100%; overflow: visible; }
  .radar-ring { stroke: var(--line); stroke-width: 1; }
  .radar-axis { stroke: var(--line); stroke-width: 1; }
  .radar-shape { fill: var(--accent); fill-opacity: 0.16; stroke: var(--accent); stroke-width: 1.75; stroke-linejoin: round; }
  .radar-dot { fill: var(--accent); }
  .radar-label { font-size: 8.5px; font-weight: 500; fill: var(--ink-2); }

  .playstyle-traits { display: flex; flex-direction: column; gap: 0.95rem; min-width: 0; }
  .trait-row { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr) 2rem; align-items: center; gap: 0.9rem; }
  .trait-name { font-size: 0.92rem; color: var(--ink-2); }
  .trait-val { text-align: right; font-weight: 600; }

  .note-title { margin: 0; font-size: 1.35rem; font-weight: 650; letter-spacing: -0.02em; color: var(--ink); }
  .tag { margin: 0.2rem 0 0.9rem; font-size: 0.85rem; }
  .prose { margin: 0 0 0.7rem; max-width: 62ch; font-size: 0.95rem; line-height: 1.6; color: var(--ink-2); }

  .formulas summary { cursor: pointer; font-size: 0.95rem; font-weight: 600; color: var(--ink); list-style: none; display: flex; align-items: center; gap: 0.5rem; }
  .formulas summary::-webkit-details-marker { display: none; }
  .formulas summary::after { content: "+"; color: var(--ink-3); font-weight: 500; }
  .formulas[open] summary::after { content: "−"; }
  .formulas[open] summary { margin-bottom: 0.9rem; }
  .formula-row { display: grid; grid-template-columns: 6.5rem 1fr; gap: 1rem; padding: 0.6rem 0; border-top: 1px solid var(--line); font-size: 0.88rem; line-height: 1.5; }
  .formula-axis { font-weight: 600; color: var(--ink); }
  .formula-text { color: var(--ink-2); }
  .fineprint { margin: 0.7rem 0 0; font-size: 0.82rem; line-height: 1.5; color: var(--ink-3); }

  /* ===== Heatmap =========================================================== */
  .heatmap-panel { display: flex; flex-direction: column; align-items: center; gap: 1.5rem; }
  .heatmap-boards-container { display: flex; gap: 2.25rem; width: 100%; justify-content: center; flex-wrap: wrap; }
  .heatmap-instance { flex: 1; min-width: 240px; max-width: 360px; display: flex; flex-direction: column; gap: 0.8rem; }
  .heatmap-header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
  .heatmap-header .muted { font-size: 0.82rem; }
  .bad-color { color: var(--loss); }
  .good-color { color: var(--win); }

  .heatmap-board { display: flex; gap: 8px; width: 100%; }
  .heatmap-rank-labels { display: flex; flex-direction: column; justify-content: space-around; width: 10px; padding-bottom: 20px; box-sizing: border-box; color: var(--ink-3); font-size: 0.75rem; }
  .heatmap-grid-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .heatmap-grid { display: flex; flex-direction: column; aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; }
  .heatmap-row { display: flex; flex: 1; }

  .heatmap-square {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    position: relative;
    border: none;
    padding: 0;
    margin: 0;
    font-family: inherit;
  }
  .heatmap-square.light { background: var(--board-light, #f0d9b5); }
  .heatmap-square.dark { background: var(--board-dark, #b58863); }
  .heatmap-square.bad.active { background: color-mix(in srgb, #ff2828 calc(var(--intensity) * 70%), var(--board-dark, #b58863)); }
  .heatmap-square.bad.light.active { background: color-mix(in srgb, #ff2828 calc(var(--intensity) * 70%), var(--board-light, #f0d9b5)); }
  .heatmap-square.good.active { background: color-mix(in srgb, #4fbf2c calc(var(--intensity) * 70%), var(--board-dark, #b58863)); }
  .heatmap-square.good.light.active { background: color-mix(in srgb, #4fbf2c calc(var(--intensity) * 70%), var(--board-light, #f0d9b5)); }
  .heatmap-square:hover, .heatmap-square:focus-visible { outline: 2px solid #fff; outline-offset: -2px; z-index: 2; }
  .heatmap-square.selected { outline: 2px solid var(--accent); outline-offset: -2px; z-index: 2; }
  .sq-count { text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75); }

  .heatmap-file-labels { display: flex; justify-content: space-around; height: 20px; align-items: flex-end; color: var(--ink-3); font-size: 0.75rem; }

  .heatmap-drilldown { width: 100%; max-width: 520px; padding-top: 1.25rem; border-top: 1px solid var(--line); }
  .drilldown-title { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 600; color: var(--ink); }

  /* ===== Small screens ===================================================== */
  @media (max-width: 760px) {
    .insights-card { height: calc(100vh - 1.5rem); }
    .dashboard-layout { flex-direction: column; }
    .side-nav {
      flex: 0 0 auto;
      flex-direction: row;
      gap: 0.25rem;
      padding: 0.5rem 0.75rem;
      border-right: none;
      border-bottom: 1px solid var(--line);
      overflow-x: auto;
      overflow-y: hidden;
    }
    .nav-btn.active { box-shadow: inset 0 -2px 0 var(--accent); }

    .hero { grid-template-columns: 1fr; gap: 1.25rem; }
    .hero-facts { min-width: 0; }
    .split, .split.three { grid-template-columns: 1fr; gap: 1.75rem; }
    .split-col, .split-col:last-child { padding: 0; border-left: none; }
    .split-col + .split-col { padding-top: 1.75rem; border-top: 1px solid var(--line); }
    .playstyle-top { grid-template-columns: 1fr; justify-items: center; }
    .playstyle-traits { width: 100%; }
    .hide-sm { display: none; }
    .recent-grid { grid-template-columns: 3.4rem minmax(0, 1fr) 4.5rem; }
    .class-grid { grid-template-columns: 1.6rem minmax(0, 1fr) 3.5rem 4.5rem; }
    .piece-grid { grid-template-columns: 2rem 5rem minmax(0, 1fr); }
    .phase-row { grid-template-columns: 5.5rem minmax(0, 1fr) 3.4rem; }
    .phase-n { display: none; }
    .opening-row { grid-template-columns: minmax(0, 1fr) 3.6rem 1.2rem; }
    .opening-games { display: none; }
    .formula-row { grid-template-columns: 1fr; gap: 0.2rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar-fill, .column-fill, .wld-segment, .chevron, .nav-btn { transition: none; }
    .spinner-ring { animation-duration: 3s; }
  }
</style>