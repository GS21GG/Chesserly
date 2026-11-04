<script setup>
  import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
  import Title from '../assets/Title.vue'
  import { Chess } from 'chess.js'
  import { useRouter } from 'vue-router'
  import { auth, db } from '../firebase'
  import { onAuthStateChanged } from 'firebase/auth'
  import {
    collection, addDoc, query, where, getDocs, serverTimestamp,
    deleteDoc, doc, orderBy, limit, startAfter
  } from 'firebase/firestore'

  const router = useRouter()
  const USERNAME_STORAGE_KEY = 'chesslab_username'
  const LIBRARY_PAGE_SIZE = 20
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
  const info = ref(null)
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

  // --- Library paging (saves Firestore reads) ---
  const lastDoc = ref(null)
  const hasMore = ref(false)
  const libraryLoaded = ref(false)
  const libraryLoading = ref(false)

  // --- Browsing / filtering state (shared by fetched games + library) ---
  const tcFilter = ref('all')
  const opponentSearch = ref('')

  const isOnlineSource = computed(() => importSite.value === 'chess.com' || importSite.value === 'lichess')
  const isLibrary = computed(() => importSite.value === 'library')

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

  const activeSource = computed(() => isLibrary.value ? savedGames.value : games.value)

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

  // Work out each row once, instead of calling formatResult many times in the template
  const rows = computed(() =>
    filteredGames.value.map((game, i) => ({ game, key: game.id || `g-${i}`, ...formatResult(game) }))
  )

  const overallStats = computed(() => {
    const s = { w: 0, l: 0, d: 0 }
    for (const r of rows.value) {
      if (r.outcome === 'win') s.w++
      else if (r.outcome === 'loss') s.l++
      else s.d++
    }
    return s
  })

  const countLabel = computed(() => {
    const total = activeSource.value.length
    if (total <= 1) return '1 game'
    const plus = isLibrary.value && hasMore.value ? '+' : ''
    return filteredGames.value.length === total
      ? `${total}${plus} games`
      : `${filteredGames.value.length} of ${total}${plus}`
  })

  // --- Library (Firestore) ---
  function mapSavedDoc(d) {
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
  }

  // First call loads page 1. fetchSavedGames(true) loads the next page.
  async function fetchSavedGames(more = false) {
    if (!currentUser.value || libraryLoading.value) return
    libraryLoading.value = true
    try {
      const parts = [orderBy('createdAt', 'desc'), limit(LIBRARY_PAGE_SIZE)]
      if (more && lastDoc.value) parts.push(startAfter(lastDoc.value))

      const snap = await getDocs(
        query(collection(db, `users/${currentUser.value.uid}/games`), ...parts)
      )
      const page = snap.docs.map(mapSavedDoc)
      savedGames.value = more ? [...savedGames.value, ...page] : page
      if (snap.docs.length) lastDoc.value = snap.docs[snap.docs.length - 1]
      hasMore.value = snap.docs.length === LIBRARY_PAGE_SIZE
      libraryLoaded.value = true
    } catch (e) {
      console.error('Failed to fetch saved games:', e)
    } finally {
      libraryLoading.value = false
    }
  }

  function resetLibrary() {
    savedGames.value = []
    lastDoc.value = null
    hasMore.value = false
    libraryLoaded.value = false
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
      const g = selectedGame.value
      const gamesRef = collection(db, `users/${currentUser.value.uid}/games`)
      const pgnHash = generatePgnHash(g.pgn)

      const dupSnap = await getDocs(query(gamesRef, where('pgnHash', '==', pgnHash), limit(1)))
      if (!dupSnap.empty) return

      const created = await addDoc(gamesRef, {
        pgn: g.pgn,
        pgnHash,
        white: g.white,
        black: g.black,
        time_class: g.time_class,
        playedAt: g.date ? g.date.getTime() : null,
        createdAt: serverTimestamp()
      })

      // Add it to the list locally. No need to read the library again.
      if (libraryLoaded.value) {
        savedGames.value = [{
          id: created.id,
          pgn: g.pgn,
          time_class: g.time_class || 'unknown',
          savedAt: Date.now(),
          date: g.date || null,
          white: g.white,
          black: g.black
        }, ...savedGames.value]
      }
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
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\$\d+/g, ' ')
      .replace(/\s*e\.p\.\s*/g, ' ')

    let prev
    do {
      prev = cleaned
      cleaned = cleaned.replace(/\([^()]*\)/g, ' ')
    } while (cleaned !== prev)

    return cleaned.replace(/\s+/g, ' ').trim()
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

  // Switching source clears the old list. The library loads only when you open it.
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
    if (site === 'library' && currentUser.value && !libraryLoaded.value) fetchSavedGames()
    if ((site === 'chess.com' || site === 'lichess') && importMode.value === 'range') loadMonth()
  })

  onMounted(() => {
    onAuthStateChanged(auth, (user) => {
      currentUser.value = user
      resetLibrary()
      if (user && isLibrary.value) fetchSavedGames()
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
    <Title/>

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
          >{{ s.label }}</button>
        </nav>

        <!-- Chess.com / Lichess -->
        <section v-if="isOnlineSource" class="controls">
          <div class="segmented" role="group" aria-label="Import mode">
            <button type="button" :class="{ active: importMode === 'last' }" @click="importMode = 'last'">Latest game</button>
            <button type="button" :class="{ active: importMode === 'range' }" @click="importMode = 'range'">By month</button>
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

            <button v-if="importMode === 'last'" class="btn" :disabled="loading" @click="chessImport">
              <span v-if="loading" class="spinner"></span>
              {{ loading ? 'Loading…' : 'Get game' }}
            </button>

            <div v-else class="month-nav">
              <div class="stepper">
                <button type="button" class="step" :disabled="!canGoPrevMonth || loading" aria-label="Previous month" title="Previous month (←)" @click="shiftMonth(-1)">‹</button>
                <span class="step-value">{{ monthShort }}</span>
                <button type="button" class="step" :disabled="!canGoNextMonth || loading" aria-label="Next month" title="Next month (→)" @click="shiftMonth(1)">›</button>
              </div>
              <div class="stepper">
                <button type="button" class="step" :disabled="!canGoPrevYear || loading" aria-label="Previous year" title="Previous year (↓)" @click="shiftYear(-1)">‹</button>
                <span class="step-value year">{{ periodYear }}</span>
                <button type="button" class="step" :disabled="!canGoNextYear || loading" aria-label="Next year" title="Next year (↑)" @click="shiftYear(1)">›</button>
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

        <!-- Library states -->
        <section v-if="isLibrary && !currentUser" class="empty">
          <p class="empty-title">Log in to see your library</p>
          <p class="empty-text">Use the login button at the top right corner.</p>
        </section>
        <section v-else-if="isLibrary && libraryLoading && !savedGames.length" class="empty">
          <span class="spinner small"></span>
        </section>
        <section v-else-if="isLibrary && libraryLoaded && !savedGames.length" class="empty">
          <p class="empty-title">Your library is empty</p>
          <p class="empty-text">Analyse a game and it will be saved here.</p>
        </section>

        <!-- Notices -->
        <div v-if="error" class="notice error">{{ error }}</div>
        <div v-if="info" class="notice warn">
          <p>{{ info }}</p>
          <button v-if="showChessComDelayWarning" type="button" class="link-btn" @click="importSite = 'pgn'">Paste a PGN instead</button>
        </div>
        <div v-if="saveStatus" class="notice ok">{{ saveStatus }}</div>

        <!-- Results -->
        <section v-if="activeSource.length" class="results">
          <div class="results-bar">
            <div class="record">
              <span class="w">{{ overallStats.w }}W</span>
              <span class="l">{{ overallStats.l }}L</span>
              <span class="d">{{ overallStats.d }}D</span>
              <span class="count">{{ countLabel }}</span>
            </div>

            <div v-if="activeSource.length > 1" class="search-wrap">
              <input v-model="opponentSearch" class="input search" placeholder="Search player" aria-label="Search by player" spellcheck="false" />
              <button v-if="opponentSearch" type="button" class="clear-btn" aria-label="Clear search" @click="clearSearch">×</button>
            </div>
          </div>

          <div v-if="rows.length" class="winbar" aria-hidden="true">
            <span class="w" :style="{ flexGrow: overallStats.w }"></span>
            <span class="d" :style="{ flexGrow: overallStats.d }"></span>
            <span class="l" :style="{ flexGrow: overallStats.l }"></span>
          </div>

          <div v-if="timeControlTabs.length > 2" class="chips">
            <button
              v-for="tab in timeControlTabs"
              :key="tab.value"
              type="button"
              class="chip"
              :class="{ active: tcFilter === tab.value }"
              @click="tcFilter = tab.value"
            >{{ tab.label }}<span class="chip-count">{{ tab.count }}</span></button>
          </div>

          <div class="list">
            <div
              v-for="r in rows"
              :key="r.key"
              class="row"
              :class="[r.outcome, { selected: isSelected(r.game) }]"
              role="button"
              tabindex="0"
              @click="selectGame(r.game)"
              @keydown.enter.prevent="selectGame(r.game)"
            >
              <span class="dot" :class="r.myColor.toLowerCase()" :title="'You played ' + r.myColor.toLowerCase()"></span>

              <span class="who">
                <span class="opponent">{{ r.opponent }}</span>
                <span class="rating">{{ r.oppRating }}</span>
              </span>

              <span class="meta">
                {{ TC_LABELS[tcKey(r.game)] }}<template v-if="formatDate(r.game)"> · {{ formatDate(r.game) }}</template>
              </span>

              <span class="result">{{ r.result }}</span>

              <button
                v-if="r.game.id"
                type="button"
                class="delete"
                aria-label="Delete game"
                title="Delete game"
                @click="deleteSavedGame(r.game.id, $event)"
              >×</button>
            </div>

            <p v-if="rows.length === 0" class="no-match">No games match your filters.</p>
          </div>

          <button
            v-if="isLibrary && hasMore"
            type="button"
            class="more-btn"
            :disabled="libraryLoading"
            @click="fetchSavedGames(true)"
          >
            <span v-if="libraryLoading" class="spinner small"></span>
            {{ libraryLoading ? 'Loading…' : 'View more' }}
          </button>
        </section>
      </div>

      <!-- Selected game bar -->
      <div v-if="selectedGame && importSite !== 'fen'" class="selection-bar">
        <span class="sel-players">
          {{ selectedGame.white.username }} <em>{{ selectedGame.white.rating }}</em>
          <span class="vs">vs</span>
          {{ selectedGame.black.username }} <em>{{ selectedGame.black.rating }}</em>
        </span>
        <button class="btn" @click="analyseGame">Analyse</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');

  .page-layout {
    --ink: #eeeae0;
    --ink-soft: rgba(238, 234, 224, 0.64);
    --ink-faint: rgba(238, 234, 224, 0.38);
    --line: rgba(255, 255, 255, 0.06);
    --line-strong: rgba(255, 255, 255, 0.12);
    --surface: var(--panel-1, #1f1e1b);
    --win: #9bc77c;
    --loss: #d98a80;
    --draw: #d4b77a;
    --gold: var(--text-highlight, #d9b382);

    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    padding: clamp(0.75rem, 2vw, 1.25rem);
    box-sizing: border-box;
    color: var(--ink);
  }

  @media (min-width: 768px) {
    .page-layout { grid-template-columns: auto minmax(0, 1fr); gap: 1.5rem; }
  }

  .import-shell {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
    padding-bottom: 4rem;
  }

  .page-title {
    margin: 0.25rem 0 0;
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }

  .card {
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface);
    overflow: hidden;
  }

  /* ---------- Source tabs ---------- */
  .source-tabs {
    display: flex;
    gap: 1.25rem;
    padding: 0 1.25rem;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
    scrollbar-width: none;
  }
  .source-tabs::-webkit-scrollbar { display: none; }

  .source-tab {
    position: relative;
    padding: 0.95rem 0;
    border: none;
    background: transparent;
    color: var(--ink-faint);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s ease;
  }
  .source-tab:hover { color: var(--ink-soft); }
  .source-tab.active { color: var(--ink); }
  .source-tab.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    background: var(--ink);
  }

  /* ---------- Controls ---------- */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1.25rem;
  }

  .segmented {
    display: inline-flex;
    align-self: flex-start;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.25);
  }
  .segmented button {
    padding: 0.3rem 0.8rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-faint);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .segmented button:hover { color: var(--ink-soft); }
  .segmented button.active { background: rgba(255, 255, 255, 0.08); color: var(--ink); }

  .control-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }

  .input {
    box-sizing: border-box;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--ink);
    font: inherit;
    font-size: 0.9rem;
    transition: border-color 0.15s ease;
  }
  .input::placeholder { color: var(--ink-faint); }
  .input:focus { outline: none; border-color: var(--line-strong); }
  .input.grow { flex: 1 1 10rem; min-width: 0; }
  .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; }

  .textarea {
    width: 100%;
    resize: vertical;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem;
    line-height: 1.55;
  }

  .actions-right { display: flex; justify-content: flex-end; }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.6rem 1.1rem;
    border: none;
    border-radius: 9px;
    background: var(--btn-active, #5a6b3d);
    color: #f5f5dc;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
    transition: background 0.15s ease, opacity 0.15s ease;
  }
  .btn:hover:not(:disabled) { background: var(--btn-idle, #6b7d49); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinner {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    border: 1.5px solid rgba(245, 245, 220, 0.25);
    border-top-color: #f5f5dc;
    animation: spin 0.7s linear infinite;
  }
  .spinner.small { border-color: rgba(255, 255, 255, 0.12); border-top-color: var(--ink-soft); }
  .spinner-slot { display: inline-flex; width: 0.75rem; height: 0.75rem; flex: 0 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ---------- Month steppers ---------- */
  .month-nav { display: inline-flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .step {
    width: 1.6rem;
    height: 1.7rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-faint);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .step:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); color: var(--ink); }
  .step:disabled { opacity: 0.2; cursor: not-allowed; }

  .step-value { min-width: 2.4rem; text-align: center; font-weight: 500; font-size: 0.875rem; }
  .step-value.year { min-width: 3rem; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: var(--ink-soft); }

  /* ---------- Notices ---------- */
  .notice {
    margin: 0 1.25rem 1rem;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .notice p { margin: 0; }
  .notice.error { color: var(--loss); background: rgba(217, 138, 128, 0.08); }
  .notice.warn {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem 1rem;
    color: var(--draw);
    background: rgba(212, 183, 122, 0.08);
  }
  .notice.ok { color: var(--win); background: rgba(155, 199, 124, 0.08); }

  .link-btn {
    padding: 0;
    border: none;
    background: none;
    color: var(--ink);
    font: inherit;
    font-weight: 500;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  /* ---------- Empty states ---------- */
  .empty { display: flex; flex-direction: column; align-items: center; padding: 2.5rem 1rem; text-align: center; }
  .empty-title { margin: 0 0 0.3rem; font-size: 1rem; font-weight: 600; color: var(--ink); }
  .empty-text { margin: 0; font-size: 0.82rem; color: var(--ink-faint); }

  /* ---------- Results ---------- */
  .results { border-top: 1px solid var(--line); }

  .results-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.25rem 0.75rem;
  }

  .record {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .record .w { color: var(--win); }
  .record .l { color: var(--loss); }
  .record .d { color: var(--draw); }
  .record .count { margin-left: 0.25rem; color: var(--ink-faint); font-weight: 500; }

  .search-wrap { position: relative; flex: 0 1 9rem; min-width: 0; }
  .search { width: 100%; padding: 0.3rem 1.6rem 0.3rem 0.6rem; font-size: 0.78rem; }

  .clear-btn {
    position: absolute;
    right: 0.2rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.3rem;
    height: 1.3rem;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--ink-faint);
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }
  .clear-btn:hover { color: var(--ink); }

  /* thin win / draw / loss bar */
  .winbar {
    display: flex;
    height: 2px;
    margin: 0 1.25rem 1rem;
    border-radius: 2px;
    overflow: hidden;
    background: var(--line);
  }
  .winbar span { flex-basis: 0; min-width: 0; }
  .winbar .w { background: var(--win); }
  .winbar .d { background: var(--draw); }
  .winbar .l { background: var(--loss); }

  /* time control filter chips */
  .chips {
    display: flex;
    gap: 1rem;
    padding: 0 1.25rem 0.9rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .chips::-webkit-scrollbar { display: none; }

  .chip {
    flex: 0 0 auto;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-faint);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .chip:hover { color: var(--ink-soft); }
  .chip.active { color: var(--ink); }
  .chip-count { margin-left: 0.3rem; font-family: 'JetBrains Mono', monospace; font-size: 0.66rem; opacity: 0.6; }

  /* ---------- Game rows ---------- */
  .list {
    max-height: 56vh;
    overflow-y: auto;
    border-top: 1px solid var(--line);
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 1.25rem;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    outline: none;
    transition: background 0.12s ease;
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: rgba(255, 255, 255, 0.03); }
  .row:focus-visible { background: rgba(255, 255, 255, 0.05); }
  .row.selected { background: rgba(255, 255, 255, 0.05); }

  /* shows the colour you played */
  .dot {
    flex: 0 0 auto;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    border: 1px solid var(--ink-faint);
  }
  .dot.white { background: var(--ink); border-color: var(--ink); }
  .dot.black { background: #111; }

  .who { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 0.5rem; }

  .opponent {
    min-width: 0;
    font-weight: 500;
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rating { flex: 0 0 auto; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: var(--ink-faint); }

  .meta { flex: 0 0 auto; font-size: 0.74rem; color: var(--ink-faint); white-space: nowrap; }

  .result {
    flex: 0 0 auto;
    min-width: 2.4rem;
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.76rem;
    font-weight: 600;
  }
  .row.win .result { color: var(--win); }
  .row.loss .result { color: var(--loss); }
  .row.draw .result { color: var(--draw); }

  /* delete button only appears on hover (always visible on touch screens) */
  .delete {
    flex: 0 0 auto;
    width: 1.4rem;
    height: 1.4rem;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--ink-faint);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease;
  }
  .row:hover .delete, .row:focus-within .delete { opacity: 1; }
  .delete:hover { color: var(--loss); }
  @media (hover: none) { .delete { opacity: 1; } }

  .no-match { margin: 0; padding: 1.25rem; text-align: center; font-size: 0.82rem; color: var(--ink-faint); }

  .more-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.85rem;
    border: none;
    border-top: 1px solid var(--line);
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .more-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.03); color: var(--ink); }
  .more-btn:disabled { opacity: 0.6; cursor: default; }

  /* ---------- Selected game bar ---------- */
  .selection-bar {
    position: sticky;
    bottom: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.5rem 0.5rem 1rem;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    z-index: 10;
  }

  .sel-players {
    min-width: 0;
    font-size: 0.85rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sel-players em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; font-weight: 500; color: var(--ink-faint); }
  .sel-players .vs { margin: 0 0.35rem; color: var(--ink-faint); font-weight: 400; }

  /* ---------- Small screens ---------- */
  @media (max-width: 560px) {
    .controls { padding: 1rem; }
    .control-row .btn { flex: 1 1 100%; }
    .month-nav { flex: 1 1 100%; justify-content: space-between; }
    .meta { display: none; }
    .results-bar, .chips, .row, .source-tabs { padding-left: 1rem; padding-right: 1rem; }
    .winbar { margin-left: 1rem; margin-right: 1rem; }
    .notice { margin-left: 1rem; margin-right: 1rem; }
    .search-wrap { flex-basis: 7rem; }
  }
</style>