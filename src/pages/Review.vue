<script setup>
  import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
  import Title from '../assets/Title.vue'
  import { Chess } from 'chess.js'
  import { useRouter } from 'vue-router'
  import { auth, db } from '../firebase'
  import { onAuthStateChanged } from 'firebase/auth'
  import {
    collection, addDoc, query, where, getDocs, serverTimestamp,
    deleteDoc, doc, orderBy
  } from 'firebase/firestore'

  const router = useRouter()
  const USERNAME_STORAGE_KEY = 'chesslab_username'
  const username = ref(localStorage.getItem(USERNAME_STORAGE_KEY) || '')

  // --- Apply theme instantly on script load to prevent refresh flashing ---
  const currentTheme = ref(localStorage.getItem('chesslab_theme') || 'midnight')
  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chesslab_theme', newTheme)
  }, { immediate: true })

  watch(username, (val) => localStorage.setItem(USERNAME_STORAGE_KEY, val))

  const sources = [
    { value: 'chess.com', label: 'Chess.com' },
    { value: 'lichess', label: 'Lichess' },
    { value: 'pgn', label: 'PGN' },
    { value: 'fen', label: 'FEN' },
    { value: 'library', label: 'Library' }
  ]

  // --- Month browser state ---
  const now = new Date()
  const NOW_YEAR = now.getFullYear()
  const NOW_MONTH = now.getMonth() + 1
  const MIN_YEAR = NOW_YEAR - 10

  const periodYear = ref(NOW_YEAR)
  const periodMonth = ref(NOW_MONTH)

  const games = ref([])
  const selectedGame = ref(null)
  const loading = ref(false)
  const error = ref(null)
  const info = ref(null) // non-error notes (e.g. Chess.com archive lag)
  const showChessComDelayWarning = ref(false)
  const gameUci = ref([])
  const reviewMoves = ref([])
  const reviewIndex = ref(0)
  const moveslist = ref([])
  const chess = new Chess()
  const importSite = ref('chess.com')
  const importMode = ref('last')

  const currentUser = ref(null)
  const savedGames = ref([])
  const saveStatus = ref('')

  // --- Browsing / filtering state (shared by fetched games + library) ---
  const tcFilter = ref('all')
  const opponentSearch = ref('')

  // --- Simple computed helpers for the UI ---
  const isOnlineSource = computed(() => importSite.value === 'chess.com' || importSite.value === 'lichess')

  const monthShort = computed(() =>
    new Date(periodYear.value, periodMonth.value - 1, 1).toLocaleString('default', { month: 'short' })
  )
  const monthLabel = computed(() =>
    new Date(periodYear.value, periodMonth.value - 1, 1).toLocaleString('default', { month: 'long' })
  )

  const isLatestPeriod = computed(() =>
    periodYear.value === NOW_YEAR && periodMonth.value === NOW_MONTH
  )

  const canGoPrevMonth = computed(() => periodYear.value > MIN_YEAR || periodMonth.value > 1)
  const canGoNextMonth = computed(() => !isLatestPeriod.value)
  const canGoPrevYear = computed(() => periodYear.value > MIN_YEAR)
  const canGoNextYear = computed(() => periodYear.value < NOW_YEAR)

  function clearSearch() {
    opponentSearch.value = ''
  }

  // --- Time control normalization (Chess.com + Lichess use different names) ---
  const TC_ORDER = ['ultrabullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence', 'daily', 'unknown']
  const TC_LABELS = {
    ultrabullet: 'UltraBullet',
    bullet: 'Bullet',
    blitz: 'Blitz',
    rapid: 'Rapid',
    classical: 'Classical',
    correspondence: 'Correspondence',
    daily: 'Daily',
    unknown: 'Other'
  }
  const tcKey = (g) => (g?.time_class || 'unknown').toLowerCase()

  // The list currently being browsed (library tab vs fetched results)
  const activeSource = computed(() => importSite.value === 'library' ? savedGames.value : games.value)

  const tcCounts = computed(() => {
    const counts = new Map()
    for (const g of activeSource.value) {
      counts.set(tcKey(g), (counts.get(tcKey(g)) || 0) + 1)
    }
    return counts
  })

  const timeControlTabs = computed(() => {
    const tabs = [{ value: 'all', label: 'All', count: activeSource.value.length }]
    for (const tc of TC_ORDER) {
      if (tcCounts.value.has(tc)) {
        tabs.push({ value: tc, label: TC_LABELS[tc] || tc, count: tcCounts.value.get(tc) })
      }
    }
    return tabs
  })

  const filteredGames = computed(() => {
    let list = activeSource.value
    if (tcFilter.value !== 'all') list = list.filter(g => tcKey(g) === tcFilter.value)
    const q = opponentSearch.value.trim().toLowerCase()
    if (q) {
      list = list.filter(g =>
        (g.white?.username || '').toLowerCase().includes(q) ||
        (g.black?.username || '').toLowerCase().includes(q)
      )
    }
    return list
  })

  const overallStats = computed(() => statsFor(filteredGames.value))

  const displayedGroups = computed(() => {
    const keys = tcFilter.value === 'all'
      ? TC_ORDER.filter(k => tcCounts.value.has(k))
      : [tcFilter.value]
    return keys
      .map(key => {
        const groupGames = filteredGames.value
          .filter(g => tcKey(g) === key)
          .sort((a, b) => sortValue(b) - sortValue(a))
        return { key, label: TC_LABELS[key] || key, games: groupGames, stats: statsFor(groupGames) }
      })
      .filter(g => g.games.length > 0)
  })

  function sortValue(g) {
    const d = g.date ? g.date.getTime() : 0
    return d || g.savedAt || 0
  }

  function statsFor(list) {
    const s = { w: 0, l: 0, d: 0 }
    for (const g of list) {
      const o = formatResult(g).outcome
      if (o === 'win') s.w++
      else if (o === 'loss') s.l++
      else s.d++
    }
    return s
  }

  async function fetchSavedGames() {
    if (!currentUser.value) return
    try {
      const q = query(
        collection(db, `users/${currentUser.value.uid}/games`),
        orderBy('createdAt', 'desc')
      )
      const querySnapshot = await getDocs(q)
      savedGames.value = querySnapshot.docs.map(d => {
        const data = d.data()
        return {
          id: d.id,
          pgn: data.pgn || '',
          time_class: data.time_class || 'unknown',
          savedAt: data.createdAt?.toMillis?.() || 0,
          date: typeof data.playedAt === 'number' ? new Date(data.playedAt) : null,
          white: {
            username: data.white?.username || 'White',
            rating: data.white?.rating || 0,
            result: data.white?.result || 'unknown'
          },
          black: {
            username: data.black?.username || 'Black',
            rating: data.black?.rating || 0,
            result: data.black?.result || 'unknown'
          }
        }
      })
    } catch (e) {
      console.error('Failed to fetch saved games:', e)
      savedGames.value = []
    }
  }

  function generatePgnHash(pgn) {
    let hash = 0
    for (let i = 0; i < pgn.length; i++) {
      const char = pgn.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash &= hash
    }
    return String(hash)
  }

  async function autoSaveGame() {
    if (!currentUser.value || !selectedGame.value) return
    try {
      const gamesRef = collection(db, `users/${currentUser.value.uid}/games`)
      const pgnHash = generatePgnHash(selectedGame.value.pgn)

      const dupQ = query(gamesRef, where('pgnHash', '==', pgnHash))
      const dupSnap = await getDocs(dupQ)
      if (!dupSnap.empty) return

      await addDoc(gamesRef, {
        pgn: selectedGame.value.pgn,
        pgnHash: pgnHash,
        white: selectedGame.value.white,
        black: selectedGame.value.black,
        time_class: selectedGame.value.time_class,
        playedAt: selectedGame.value.date ? selectedGame.value.date.getTime() : null,
        createdAt: serverTimestamp()
      })
      await fetchSavedGames()
    } catch (e) {
      console.error('Auto-save failed:', e)
      saveStatus.value = 'Could not save this game.'
      setTimeout(() => saveStatus.value = '', 2500)
    }
  }

  async function deleteSavedGame(gameId, event) {
    if (event) event.stopPropagation()
    if (!confirm('Delete this game?')) return
    try {
      await deleteDoc(doc(db, `users/${currentUser.value.uid}/games`, gameId))
      savedGames.value = savedGames.value.filter(g => g.id !== gameId)
      if (selectedGame.value?.id === gameId) selectedGame.value = null
    } catch (e) { console.error(e) }
  }

  const pgnText = ref('')
  const fenText = ref('')

  // --- Helper to clean PGNs before chess.js parses them ---
  function cleanPgn(pgn) {
    if (!pgn) return ''
    let cleaned = pgn
      .replace(/\{[^}]*\}/g, ' ')    // Remove comments
      .replace(/\$\d+/g, ' ')         // Remove NAGs
      .replace(/\s*e\.p\.\s*/g, ' ')  // Remove en passant annotations

    // Remove nested variations
    let prev
    do {
      prev = cleaned
      cleaned = cleaned.replace(/\([^()]*\)/g, ' ')
    } while (cleaned !== prev)

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim()
    return cleaned
  }

  function normalizeChessCom(g) {
    return {
      pgn: cleanPgn(g.pgn || ''),
      time_class: g.time_class || 'unknown',
      date: g.end_time ? new Date(g.end_time * 1000) : null,
      white: { username: g.white?.username || 'White', rating: g.white?.rating || 0, result: g.white?.result || 'unknown' },
      black: { username: g.black?.username || 'Black', rating: g.black?.rating || 0, result: g.black?.result || 'unknown' }
    }
  }

  function normalizeLichess(line) {
    const lGame = JSON.parse(line)
    let wRes = 'draw', bRes = 'draw'
    if (lGame.winner === 'white') { wRes = 'win'; bRes = 'lose' }
    else if (lGame.winner === 'black') { wRes = 'lose'; bRes = 'win' }
    const ts = lGame.lastMoveAt || lGame.createdAt
    return {
      pgn: cleanPgn(lGame.pgn || ''),
      time_class: lGame.speed || 'unknown',
      date: ts ? new Date(ts) : null,
      white: { username: lGame.players?.white?.user?.name || 'Anonymous', rating: lGame.players?.white?.rating || 0, result: wRes },
      black: { username: lGame.players?.black?.user?.name || 'Anonymous', rating: lGame.players?.black?.rating || 0, result: bRes }
    }
  }

  function bust(url) {
    return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
  }

  async function fetchChessComJson(url) {
    const res = await fetch(bust(url), { cache: 'no-store' })
    if (!res.ok) throw new Error(`Chess.com request failed (${res.status})`)
    return res.json()
  }

  async function fetchChessComRange(user, yr, mo) {
    const paddedMonth = String(mo).padStart(2, '0')
    const data = await fetchChessComJson(`https://api.chess.com/pub/player/${user}/games/${yr}/${paddedMonth}`)
    return (data.games || []).map(normalizeChessCom)
  }

  async function fetchChessComLast(user) {
    const now = new Date()
    let y = now.getUTCFullYear()
    let m = now.getUTCMonth() + 1

    const candidates = [[y, m]]
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
    candidates.push([y, m])

    for (const [yy, mm] of candidates) {
      try {
        const monthGames = await fetchChessComRange(user, yy, mm)
        if (monthGames.length) return [monthGames[monthGames.length - 1]]
      } catch (e) {
        // Month may not exist / no games — try the next candidate.
      }
    }

    const data = await fetchChessComJson(`https://api.chess.com/pub/player/${user}/games/archives`)
    const archives = data.archives || []
    if (!archives.length) throw new Error('No games found for this player.')
    const lastData = await fetchChessComJson(archives[archives.length - 1])
    const monthGames = (lastData.games || []).map(normalizeChessCom)
    if (!monthGames.length) throw new Error('No games found in the latest archive.')
    return [monthGames[monthGames.length - 1]]
  }

  async function fetchLichessRange(user, yr, mo) {
    const startDate = new Date(Date.UTC(yr, mo - 1, 1)).getTime()
    const endDate = new Date(Date.UTC(yr, mo, 1)).getTime()
    const res = await fetch(`https://lichess.org/api/games/user/${user}?since=${startDate}&until=${endDate}&pgnInJson=true`, {
      headers: { 'Accept': 'application/x-ndjson' },
      cache: 'no-store'
    })
    if (!res.ok) throw new Error('Failed to fetch from Lichess')
    const text = await res.text()
    if (!text.trim()) return []
    return text.trim().split('\n').map(normalizeLichess)
  }

  async function fetchLichessLast(user) {
    const res = await fetch(`https://lichess.org/api/games/user/${user}?max=1&pgnInJson=true`, {
      headers: { 'Accept': 'application/x-ndjson' },
      cache: 'no-store'
    })
    if (!res.ok) throw new Error('Failed to fetch from Lichess')
    const text = await res.text()
    if (!text.trim()) throw new Error('No games found for this player.')
    return [normalizeLichess(text.trim().split('\n')[0])]
  }

  function buildGameFromPgn(pgn) {
    const c = new Chess()
    const cleanedPgn = cleanPgn(pgn)

    const extractHeader = (key) => {
      const match = new RegExp(`\\[${key}\\s+"(.*?)"\\]`).exec(pgn)
      return match ? match[1] : ''
    }

    let parsedSuccessfully = false
    try {
      c.loadPgn(cleanedPgn)
      if (c.history().length > 0) parsedSuccessfully = true
    } catch (e) {
      console.warn('Standard loadPgn failed, attempting fallback recovery...', e.message)
    }

    if (parsedSuccessfully) {
      const headers = c.getHeaders?.() || {}
      const whiteName = headers.White || extractHeader('White') || 'White'
      const blackName = headers.Black || extractHeader('Black') || 'Black'
      const whiteElo = headers.WhiteElo || extractHeader('WhiteElo')
      const blackElo = headers.BlackElo || extractHeader('BlackElo')
      const result = headers.Result || extractHeader('Result') || '*'

      return {
        pgn: cleanedPgn,
        time_class: 'unknown',
        date: null,
        white: { username: whiteName, rating: Number(whiteElo) || 0, result: result === '1-0' ? 'win' : (result === '0-1' ? 'lose' : 'draw') },
        black: { username: blackName, rating: Number(blackElo) || 0, result: result === '0-1' ? 'win' : (result === '1-0' ? 'lose' : 'draw') }
      }
    }

    c.reset()
    const movesStr = cleanedPgn.replace(/\[.*?\]/gs, '').replace(/\d+\.(\.\.)?/g, ' ').replace(/(1-0|0-1|1\/2-1\/2|\*)/g, '').trim()
    const moves = movesStr.split(/\s+/).filter(m => m.length > 0)

    let validMovesApplied = 0
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]
      if (!move) continue
      try {
        c.move(move)
        validMovesApplied++
      } catch (err) {
        const fenParts = c.fen().split(' ')
        fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w'
        fenParts[3] = '-'
        const newFen = fenParts.join(' ')

        try {
          const tempBoard = new Chess(newFen)
          tempBoard.move(move)
          c.load(newFen)
          c.move(move)
          validMovesApplied++
        } catch (err2) {
          console.error(`Skipped unrecoverable invalid move: ${move}`)
          break
        }
      }
    }

    if (validMovesApplied === 0) throw new Error('No valid moves found in that PGN. Please check the format.')

    const whiteName = extractHeader('White') || 'White'
    const blackName = extractHeader('Black') || 'Black'
    const whiteElo = extractHeader('WhiteElo')
    const blackElo = extractHeader('BlackElo')
    const result = extractHeader('Result') || '*'

    const cleanMovesPgn = c.pgn()
    const headerStr = `[White "${whiteName}"]\n[Black "${blackName}"]\n[Result "${result}"]${whiteElo ? `\n[WhiteElo "${whiteElo}"]` : ''}${blackElo ? `\n[BlackElo "${blackElo}"]` : ''}`
    const finalPgn = `${headerStr}\n\n${cleanMovesPgn} ${result}`.trim()

    return {
      pgn: finalPgn,
      time_class: 'unknown',
      date: null,
      white: { username: whiteName, rating: Number(whiteElo) || 0, result: result === '1-0' ? 'win' : (result === '0-1' ? 'lose' : 'draw') },
      black: { username: blackName, rating: Number(blackElo) || 0, result: result === '0-1' ? 'win' : (result === '1-0' ? 'lose' : 'draw') }
    }
  }

  function validateFen(fen) {
    const c = new Chess()
    try { c.load(fen) } catch (e) { throw new Error('Could not read that FEN.') }
    return fen
  }

  // --- Month browser: load games for the chosen month ---
  let requestId = 0

  async function loadMonth() {
    if (!username.value) return
    const id = ++requestId
    loading.value = true
    error.value = null
    info.value = null
    showChessComDelayWarning.value = false
    games.value = []
    selectedGame.value = null
    tcFilter.value = 'all'
    try {
      const fetched = importSite.value === 'chess.com'
        ? await fetchChessComRange(username.value, periodYear.value, periodMonth.value)
        : await fetchLichessRange(username.value, periodYear.value, periodMonth.value)
      if (id !== requestId) return
      games.value = [...fetched].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
      if (games.value.length === 0) {
        error.value = `No games found for ${monthLabel.value} ${periodYear.value}.`
      }
    } catch (e) {
      if (id !== requestId) return
      error.value = e.message
      console.error(e)
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function shiftMonth(delta) {
    if (delta < 0 && !canGoPrevMonth.value) return
    if (delta > 0 && !canGoNextMonth.value) return
    let m = periodMonth.value + delta
    let y = periodYear.value
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    if (y < MIN_YEAR || y > NOW_YEAR) return
    if (y === NOW_YEAR && m > NOW_MONTH) return
    periodYear.value = y
    periodMonth.value = m
    loadMonth()
  }

  function shiftYear(delta) {
    const y = periodYear.value + delta
    if (y < MIN_YEAR || y > NOW_YEAR) return
    periodYear.value = y
    if (y === NOW_YEAR && periodMonth.value > NOW_MONTH) periodMonth.value = NOW_MONTH
    loadMonth()
  }

  // Arrow keys: ← → change month, ↑ ↓ change year (only in month mode, and not while typing)
  function onArrowKey(e) {
    if (!isOnlineSource.value || importMode.value !== 'range') return
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (e.key === 'ArrowLeft') { e.preventDefault(); shiftMonth(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); shiftMonth(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); shiftYear(1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); shiftYear(-1) }
  }

  // Wait a moment after typing a username before searching
  let usernameTimer = null
  watch(username, () => {
    if (importMode.value !== 'range' || !isOnlineSource.value) return
    clearTimeout(usernameTimer)
    usernameTimer = setTimeout(loadMonth, 700)
  })

  // Switching modes clears the old list. Month mode loads right away.
  watch(importMode, (mode) => {
    requestId++
    games.value = []
    selectedGame.value = null
    error.value = null
    info.value = null
    loading.value = false
    if (mode === 'range') loadMonth()
  })

  // Switching source clears the old list. Month mode reloads for the new site.
  watch(importSite, (site) => {
    tcFilter.value = 'all'
    opponentSearch.value = ''
    error.value = null
    info.value = null
    showChessComDelayWarning.value = false
    requestId++
    loading.value = false
    games.value = []
    selectedGame.value = null
    if ((site === 'chess.com' || site === 'lichess') && importMode.value === 'range') loadMonth()
  })

  onMounted(() => {
    onAuthStateChanged(auth, (user) => {
      currentUser.value = user
      if (user) fetchSavedGames()
      else savedGames.value = []
    })
    window.addEventListener('keydown', onArrowKey)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onArrowKey)
    clearTimeout(usernameTimer)
  })

  async function chessImport() {
    loading.value = true
    error.value = null
    info.value = null
    showChessComDelayWarning.value = false
    games.value = []
    selectedGame.value = null
    tcFilter.value = 'all'
    opponentSearch.value = ''
    try {
      if (importSite.value === 'pgn') {
        if (!pgnText.value.trim()) throw new Error('Paste a PGN first.')
        const game = buildGameFromPgn(pgnText.value.trim())
        games.value = [game]
        selectGame(game)
        return
      }
      if (importSite.value === 'fen') {
        if (!fenText.value.trim()) throw new Error('Paste a FEN first.')
        const fen = validateFen(fenText.value.trim())
        router.push({ path: '/', query: { fen } })
        return
      }
      if (!username.value) throw new Error('Enter a username first.')

      const lastGames = importSite.value === 'chess.com'
        ? await fetchChessComLast(username.value)
        : await fetchLichessLast(username.value)
      games.value = lastGames

      if (importSite.value === 'chess.com') {
        const lastDate = lastGames[0]?.date
        const ageMin = lastDate ? (Date.now() - lastDate.getTime()) / 60000 : Infinity
        if (ageMin > 1) {
          showChessComDelayWarning.value = true
          info.value = "Chess.com saves games in its public data for up to an hour. Your latest game may not show up yet."
        }
      }

      if (lastGames.length) selectGame(lastGames[0])

      if (games.value.length === 0) {
        error.value = 'No games found for that search.'
      }
    } catch (e) {
      error.value = e.message
      console.error(e)
    } finally {
      loading.value = false
    }
  }

  function isSelected(game) {
    if (!selectedGame.value) return false
    if (selectedGame.value === game) return true
    return !!game.id && selectedGame.value.id === game.id
  }

  function selectGame(game) {
    if (game && game.pgn) {
      game.pgn = cleanPgn(game.pgn)
    }

    selectedGame.value = game
    gameUci.value = convertPgnToUci(game.pgn)
    reviewMoves.value = gameUci.value
    reviewIndex.value = 0
    chess.reset()

    const tempChess = new Chess()
    moveslist.value = gameUci.value.map(uci => {
      const m = tempChess.move({ from: uci.substring(0, 2), to: uci.substring(2, 4), promotion: uci[4] })
      return m ? m.san : uci
    })
  }

  function convertPgnToUci(pgn) {
    const cleanedPgn = cleanPgn(pgn)
    if (!cleanedPgn) return []
    const c = new Chess()
    try {
      c.loadPgn(cleanedPgn)
    } catch (e) {
      console.error('convertPgnToUci PGN parse error:', e)
      return []
    }
    return c.history({ verbose: true }).map(move => {
      let uci = move.from + move.to
      if (move.promotion) uci += move.promotion
      return uci
    })
  }

  function formatDate(game) {
    if (!game?.date || isNaN(game.date.getTime())) return ''
    const d = game.date
    const sameYear = d.getFullYear() === new Date().getFullYear()
    return d.toLocaleDateString(undefined, sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: '2-digit' })
  }

  const LOSS_RESULTS = ['resigned', 'checkmated', 'abandoned', 'lose', 'timeout', 'kingofthehill', 'threecheck', 'bughousepartnerlose']

  function formatResult(game) {
    const myUsername = (username.value || '').trim().toLowerCase()
    const whiteUsername = (game.white?.username || '').toLowerCase()
    const blackUsername = (game.black?.username || '').toLowerCase()

    const matched = myUsername && (whiteUsername === myUsername || blackUsername === myUsername)
    const isWhite = matched ? whiteUsername === myUsername : true

    const me = isWhite ? (game.white || {}) : (game.black || {})
    const opponent = isWhite ? (game.black || {}) : (game.white || {})

    let result = '½-½'
    let outcome = 'draw'
    if (me.result === 'win') {
      result = isWhite ? '1-0' : '0-1'
      outcome = 'win'
    } else if (LOSS_RESULTS.includes(me.result)) {
      result = isWhite ? '0-1' : '1-0'
      outcome = 'loss'
    }

    return {
      opponent: opponent.username || 'Unknown',
      result,
      outcome,
      myColor: isWhite ? 'White' : 'Black',
      myRating: me.rating || 0,
      oppRating: opponent.rating || 0
    }
  }

  async function analyseGame() {
    if (!selectedGame.value || gameUci.value.length === 0) return

    if (currentUser.value) {
      saveStatus.value = 'Saving to library…'
      await autoSaveGame()
      saveStatus.value = 'Saved to library ✓'
      setTimeout(() => saveStatus.value = '', 2500)
    }

    const moveString = gameUci.value.join('-')

    const myUsername = (username.value || '').trim().toLowerCase()
    const whiteUsername = (selectedGame.value.white?.username || '').toLowerCase()
    const blackUsername = (selectedGame.value.black?.username || '').toLowerCase()
    const matched = myUsername && (whiteUsername === myUsername || blackUsername === myUsername)
    const myColor = matched ? (whiteUsername === myUsername ? 'white' : 'black') : 'white'

    router.push({
      path: '/',
      query: {
        moves: moveString,
        white: selectedGame.value.white.username,
        black: selectedGame.value.black.username,
        whiteRating: selectedGame.value.white.rating,
        blackRating: selectedGame.value.black.rating,
        pgn: selectedGame.value.pgn,
        myColor
      }
    })
  }
</script>

<template>
  <div class="page-layout">
    <Title />

    <main class="import-shell">
      <h1 class="page-title">Import a game</h1>

      <div class="card">
        <!-- Source tabs -->
        <nav class="source-tabs" role="tablist" aria-label="Game source">
          <button
            v-for="s in sources"
            :key="s.value"
            type="button"
            role="tab"
            class="source-tab"
            :class="{ active: importSite === s.value }"
            :aria-selected="importSite === s.value"
            @click="importSite = s.value"
          >
            {{ s.label }}
            <span
              v-if="s.value === 'library' && savedGames.length"
              class="tab-count"
            >{{ savedGames.length }}</span>
          </button>
        </nav>

        <!-- Chess.com / Lichess controls -->
        <section v-if="isOnlineSource" class="controls">
          <div class="mode-switch">
            <button
              type="button"
              :class="{ active: importMode === 'last' }"
              @click="importMode = 'last'"
            >Latest game</button>
            <span class="mode-sep">/</span>
            <button
              type="button"
              :class="{ active: importMode === 'range' }"
              @click="importMode = 'range'"
            >By month</button>
          </div>

          <div class="control-row">
            <input
              v-model.trim="username"
              class="input grow"
              placeholder="Username"
              aria-label="Username"
              autocomplete="off"
              spellcheck="false"
              @keyup.enter="importMode === 'range' ? loadMonth() : chessImport()"
            />

            <button
              v-if="importMode === 'last'"
              class="btn"
              :disabled="loading"
              @click="chessImport"
            >
              <span v-if="loading" class="spinner"></span>
              {{ loading ? 'Loading…' : 'Get game' }}
            </button>

            <div v-else class="month-nav">
              <div class="stepper">
                <button
                  type="button"
                  class="step"
                  :disabled="!canGoPrevMonth || loading"
                  aria-label="Previous month"
                  title="Previous month (←)"
                  @click="shiftMonth(-1)"
                >‹</button>
                <span class="step-value">{{ monthShort }}</span>
                <button
                  type="button"
                  class="step"
                  :disabled="!canGoNextMonth || loading"
                  aria-label="Next month"
                  title="Next month (→)"
                  @click="shiftMonth(1)"
                >›</button>
              </div>

              <div class="stepper">
                <button
                  type="button"
                  class="step"
                  :disabled="!canGoPrevYear || loading"
                  aria-label="Previous year"
                  title="Previous year (↓)"
                  @click="shiftYear(-1)"
                >‹</button>
                <span class="step-value year">{{ periodYear }}</span>
                <button
                  type="button"
                  class="step"
                  :disabled="!canGoNextYear || loading"
                  aria-label="Next year"
                  title="Next year (↑)"
                  @click="shiftYear(1)"
                >›</button>
              </div>

              <span class="spinner-slot"><span v-if="loading" class="spinner small"></span></span>
            </div>
          </div>
        </section>

        <!-- PGN -->
        <section v-if="importSite === 'pgn'" class="controls">
          <textarea
            v-model="pgnText"
            class="input textarea"
            rows="5"
            aria-label="PGN"
            placeholder='Paste a PGN here&#10;[Event "Casual Game"]&#10;1. e4 e5 2. Nf3 Nc6 3. Bb5 ...'
          ></textarea>
          <div class="actions-right">
            <button class="btn" :disabled="loading" @click="chessImport">
              <span v-if="loading" class="spinner"></span>
              {{ loading ? 'Reading…' : 'Load PGN' }}
            </button>
          </div>
        </section>

        <!-- FEN -->
        <section v-if="importSite === 'fen'" class="controls">
          <div class="control-row">
            <input
              v-model="fenText"
              class="input grow mono"
              aria-label="FEN"
              placeholder="Paste a FEN, e.g. rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
              spellcheck="false"
              @keyup.enter="chessImport"
            />
            <button class="btn" :disabled="loading" @click="chessImport">
              <span v-if="loading" class="spinner"></span>
              {{ loading ? 'Loading…' : 'Load' }}
            </button>
          </div>
        </section>

        <!-- Library empty states -->
        <section v-if="importSite === 'library' && !currentUser" class="empty">
          <p class="empty-title">Log in to see your library</p>
          <p class="empty-text">Use the login button at the top right corner.</p>
        </section>
        <section v-else-if="importSite === 'library' && savedGames.length === 0" class="empty">
          <p class="empty-title">Your library is empty</p>
          <p class="empty-text">Analyse a game and it will be saved here.</p>
        </section>

        <!-- Notices -->
        <div v-if="error" class="notice error">{{ error }}</div>
        <div v-if="info" class="notice warn">
          <p>{{ info }}</p>
          <button
            v-if="showChessComDelayWarning"
            type="button"
            class="link-btn"
            @click="importSite = 'pgn'"
          >Paste a PGN instead</button>
        </div>
        <div v-if="saveStatus" class="notice ok">{{ saveStatus }}</div>

        <!-- Results -->
        <section v-if="activeSource.length" class="results">
          <div class="results-bar">
            <div class="record">
              <span class="w">{{ overallStats.w }}W</span>
              <span class="l">{{ overallStats.l }}L</span>
              <span class="d">{{ overallStats.d }}D</span>
              <span class="count">
                · <template v-if="activeSource.length > 1">{{ filteredGames.length }} of {{ activeSource.length }}</template><template v-else>1 game</template>
              </span>
            </div>

            <div v-if="activeSource.length > 1" class="search-wrap">
              <input
                v-model="opponentSearch"
                class="input search"
                placeholder="Search player"
                aria-label="Search by player"
                spellcheck="false"
              />
              <button
                v-if="opponentSearch"
                type="button"
                class="clear-btn"
                aria-label="Clear search"
                @click="clearSearch"
              >×</button>
            </div>
          </div>

          <div v-if="timeControlTabs.length > 2" class="tc-tabs">
            <button
              v-for="tab in timeControlTabs"
              :key="tab.value"
              type="button"
              class="tc-tab"
              :class="[tab.value, { active: tcFilter === tab.value }]"
              @click="tcFilter = tab.value"
            >
              {{ tab.label }}<span class="tc-count">{{ tab.count }}</span>
            </button>
          </div>

          <div class="groups">
            <div v-for="group in displayedGroups" :key="group.key" class="group">
              <header v-if="displayedGroups.length > 1" class="group-head">
                <span class="group-name">{{ group.label }}</span>
                <span class="group-line"></span>
                <span class="group-stats">{{ group.stats.w }}W {{ group.stats.l }}L {{ group.stats.d }}D</span>
              </header>

              <div
                v-for="(game, i) in group.games"
                :key="group.key + '-' + i"
                class="row"
                :class="[formatResult(game).outcome, { selected: isSelected(game) }]"
                role="button"
                tabindex="0"
                @click="selectGame(game)"
                @keydown.enter.prevent="selectGame(game)"
              >
                <span
                  class="piece"
                  :title="'You played ' + formatResult(game).myColor.toLowerCase()"
                >{{ formatResult(game).myColor === 'White' ? '♔' : '♚' }}</span>

                <span class="opponent">{{ formatResult(game).opponent }}</span>

                <span class="meta">
                  <template v-if="formatDate(game)">{{ formatDate(game) }}<i>·</i></template>{{ formatResult(game).myRating }}<i>/</i>{{ formatResult(game).oppRating }}
                </span>

                <span class="result">{{ formatResult(game).result }}</span>

                <button
                  v-if="game.id"
                  type="button"
                  class="delete"
                  aria-label="Delete game"
                  title="Delete game"
                  @click="deleteSavedGame(game.id, $event)"
                >×</button>
              </div>
            </div>
          </div>

          <p v-if="filteredGames.length === 0" class="no-match">No games match your filters.</p>
        </section>
      </div>

      <!-- Selected game bar -->
      <div v-if="selectedGame && importSite !== 'fen'" class="selection-bar">
        <span class="sel-players">
          {{ selectedGame.white.username }} <em>{{ selectedGame.white.rating }}</em>
          <span class="vs">vs</span>
          {{ selectedGame.black.username }} <em>{{ selectedGame.black.rating }}</em>
        </span>
        <button class="btn" @click="analyseGame">Analyse →</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

  .page-layout {
    --ink: #f4f0e3;
    --ink-soft: rgba(244, 240, 227, 0.7);
    --ink-faint: rgba(244, 240, 227, 0.42);
    --line: rgba(255, 255, 255, 0.07);
    --line-strong: rgba(255, 255, 255, 0.14);
    --win: #8fc06a;
    --loss: #d9736a;
    --draw: #d9b36a;
    --gold: var(--text-highlight, #d9b382);

    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    padding: clamp(0.5rem, 2vw, 1rem);
    box-sizing: border-box;
    color: var(--ink);
  }

  @media (min-width: 768px) {
    .page-layout { grid-template-columns: auto minmax(0, 1fr); gap: 1.25rem; }
  }

  .import-shell {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
    padding-bottom: 3.5rem;
  }

  .page-title {
    margin: 0.1rem 0 0;
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(1.7rem, 4vw, 2.2rem);
    font-weight: 700;
    letter-spacing: 0.01em;
    color: #f5f5dc;
    line-height: 1.1;
  }

  /* ---------- One card for everything ---------- */
  .card {
    border-radius: 14px;
    border: 1px solid var(--line);
    background: linear-gradient(145deg, var(--panel-1, #262421), var(--panel-2, #1e1c18));
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  /* ---------- Tabs with an underline ---------- */
  .source-tabs {
    display: flex;
    gap: 0.15rem;
    padding: 0 0.6rem;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
    scrollbar-width: none;
  }

  .source-tabs::-webkit-scrollbar { display: none; }

  .source-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.8rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--ink-faint);
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s ease;
  }

  .source-tab:hover { color: var(--ink-soft); }
  .source-tab.active { color: var(--ink); }

  .source-tab.active::after {
    content: '';
    position: absolute;
    left: 0.75rem;
    right: 0.75rem;
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--gold);
  }

  .tab-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.68rem;
    color: var(--gold);
  }

  /* ---------- Controls ---------- */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.9rem 1rem;
  }

  .mode-switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
  }

  .mode-switch button {
    padding: 0;
    border: none;
    background: none;
    color: var(--ink-faint);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .mode-switch button:hover { color: var(--ink-soft); }
  .mode-switch button.active { color: var(--ink); }
  .mode-sep { color: var(--ink-faint); opacity: 0.5; }

  .control-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }

  .input {
    box-sizing: border-box;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.28);
    color: var(--ink);
    font: inherit;
    font-size: 0.9rem;
    transition: border-color 0.15s ease;
  }

  .input::placeholder { color: var(--ink-faint); }
  .input:focus { outline: none; border-color: var(--gold); }

  .input.grow { flex: 1 1 10rem; min-width: 0; }

  .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; }

  .textarea {
    width: 100%;
    resize: vertical;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .actions-right { display: flex; justify-content: flex-end; }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.5rem 1.1rem;
    border: none;
    border-radius: 8px;
    background: var(--btn-active, #5a6b3d);
    color: #f5f5dc;
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
    transition: background 0.15s ease, transform 0.1s ease, opacity 0.15s ease;
  }

  .btn:hover:not(:disabled) { background: var(--btn-idle, #6b7d49); }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }

  .spinner {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    border: 2px solid rgba(245, 245, 220, 0.3);
    border-top-color: #f5f5dc;
    animation: spin 0.7s linear infinite;
  }

  .spinner.small {
    border-color: rgba(217, 179, 130, 0.25);
    border-top-color: var(--gold);
  }

  .spinner-slot { display: inline-flex; width: 0.8rem; height: 0.8rem; flex: 0 0 auto; }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ---------- Month steppers ---------- */
  .month-nav {
    display: inline-flex;
    align-items: center;
    gap: 1rem;
    flex: 0 0 auto;
  }

  .stepper { display: inline-flex; align-items: center; }

  .step {
    width: 1.7rem;
    height: 1.9rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .step:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); color: var(--ink); }
  .step:disabled { opacity: 0.25; cursor: not-allowed; }

  .step-value {
    min-width: 2.5rem;
    text-align: center;
    font-weight: 600;
    font-size: 0.92rem;
  }

  .step-value.year {
    min-width: 3rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.86rem;
    color: var(--gold);
  }

  /* ---------- Notices ---------- */
  .notice {
    margin: 0 1rem 0.8rem;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid;
    border-radius: 4px 8px 8px 4px;
    font-size: 0.83rem;
    line-height: 1.4;
  }

  .notice p { margin: 0; }
  .notice.error { color: #f0b4ac; border-color: var(--loss); background: rgba(217, 115, 106, 0.1); }
  .notice.warn {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem 1rem;
    color: #e8c98a;
    border-color: var(--draw);
    background: rgba(217, 179, 106, 0.08);
  }
  .notice.ok { color: #b9dc97; border-color: var(--win); background: rgba(143, 192, 106, 0.1); }

  .link-btn {
    padding: 0;
    border: none;
    background: none;
    color: #f4d58f;
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  /* ---------- Empty states ---------- */
  .empty { padding: 2rem 1rem; text-align: center; }
  .empty-title { margin: 0 0 0.2rem; font-family: 'Cormorant Garamond', serif; font-size: 1.25rem; font-weight: 700; color: #f5f5dc; }
  .empty-text { margin: 0; font-size: 0.83rem; color: var(--ink-faint); }

  /* ---------- Results ---------- */
  .results { border-top: 1px solid var(--line); }

  .results-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
  }

  .record {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .record .w { color: var(--win); }
  .record .l { color: var(--loss); }
  .record .d { color: var(--draw); }
  .record .count { color: var(--ink-faint); font-weight: 500; }

  .search-wrap { position: relative; flex: 0 1 10rem; min-width: 0; }
  .search { width: 100%; padding: 0.3rem 1.7rem 0.3rem 0.6rem; font-size: 0.8rem; }

  .clear-btn {
    position: absolute;
    right: 0.2rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.4rem;
    height: 1.4rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .clear-btn:hover { color: var(--ink); }

  /* time control tabs: plain text */
  .tc-tabs {
    display: flex;
    gap: 1rem;
    padding: 0 1rem 0.5rem;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tc-tabs::-webkit-scrollbar { display: none; }

  .tc-tab {
    flex: 0 0 auto;
    padding: 0.15rem 0;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--ink-faint);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .tc-tab:hover { color: var(--ink-soft); }
  .tc-tab.active { color: var(--ink); border-bottom-color: var(--tc, var(--gold)); }

  .tc-count {
    margin-left: 0.3rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.66rem;
    opacity: 0.6;
  }

  .tc-tab.all { --tc: #f4f0e3; }
  .tc-tab.ultrabullet { --tc: #ff6b6b; }
  .tc-tab.bullet { --tc: #ff9f43; }
  .tc-tab.blitz { --tc: #f2c14e; }
  .tc-tab.rapid { --tc: #8fc06a; }
  .tc-tab.classical { --tc: #6aa8d9; }
  .tc-tab.correspondence, .tc-tab.daily { --tc: #a78bdb; }
  .tc-tab.unknown { --tc: #9a9a9a; }

  .groups {
    max-height: 56vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 1rem 0.25rem;
  }

  .group-name {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-weight: 700;
    color: var(--gold);
  }

  .group-line { flex: 1; height: 1px; background: var(--line); }

  .group-stats {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.66rem;
    color: var(--ink-faint);
  }

  /* ---------- Game rows: simple list, no boxes ---------- */
  .row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.5rem 1rem 0.5rem 0.85rem;
    border-left: 3px solid transparent;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    outline: none;
    transition: background 0.12s ease;
  }

  .row:last-child { border-bottom: none; }
  .row:hover { background: rgba(255, 255, 255, 0.04); }
  .row:focus-visible { background: rgba(255, 255, 255, 0.06); }

  .row.win { border-left-color: var(--win); }
  .row.loss { border-left-color: var(--loss); }
  .row.draw { border-left-color: var(--draw); }

  .row.selected { background: rgba(217, 179, 130, 0.1); }

  .piece {
    flex: 0 0 auto;
    width: 1.1rem;
    text-align: center;
    font-size: 1.05rem;
    line-height: 1;
    color: var(--ink-soft);
  }

  .opponent {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    flex: 0 0 auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    color: var(--ink-faint);
    white-space: nowrap;
  }

  .meta i { font-style: normal; margin: 0 0.3rem; opacity: 0.6; }

  .result {
    flex: 0 0 auto;
    min-width: 2.4rem;
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .row.win .result { color: var(--win); }
  .row.loss .result { color: var(--loss); }
  .row.draw .result { color: var(--draw); }

  .delete {
    flex: 0 0 auto;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-faint);
    font-size: 1.05rem;
    line-height: 1;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .delete:hover { background: rgba(217, 115, 106, 0.15); color: #ffb0a8; }

  .no-match { margin: 0; padding: 1rem; text-align: center; font-size: 0.83rem; color: var(--ink-faint); }

  /* ---------- Selected game bar ---------- */
  .selection-bar {
    position: sticky;
    bottom: 0.6rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.6rem 0.55rem 1rem;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    border-top: 2px solid var(--gold);
    background: var(--panel-1, #262421);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
    z-index: 10;
  }

  .sel-players {
    min-width: 0;
    font-size: 0.86rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sel-players em {
    font-style: normal;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--ink-faint);
  }

  .sel-players .vs { margin: 0 0.35rem; color: var(--ink-faint); font-weight: 400; }

  /* ---------- Small screens ---------- */
  @media (max-width: 560px) {
    .controls { padding: 0.8rem; }
    .control-row .btn { flex: 1 1 100%; }
    .month-nav { flex: 1 1 100%; justify-content: space-between; }
    .meta { display: none; }
    .results-bar, .tc-tabs { padding-left: 0.8rem; padding-right: 0.8rem; }
    .search-wrap { flex-basis: 7rem; }
    .row { padding-right: 0.8rem; }
  }
</style>