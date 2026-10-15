<script setup>
  import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
  import { Chess } from 'chess.js'
  import { TheChessboard } from 'vue3-chessboard'
  import { auth, db } from '../firebase'
  import { onAuthStateChanged } from 'firebase/auth'
  import { collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc } from 'firebase/firestore'
  import 'vue3-chessboard/style.css'
  import Title from "../assets/Title.vue"
  import SettingsPanel from "../assets/SettingsPanel.vue"
  import { startEngine, getEvaluation, cancelAnalysis } from "../engine/engine.js"
  import { useRoute, useRouter } from 'vue-router'
  import moveSfx from '../assets/sounds/move.mp3'
  import captureSfx from '../assets/sounds/capture.mp3'
  import checkSfx from '../assets/sounds/check.mp3'
  import castleSfx from '../assets/sounds/castle.mp3'
  import promoteSfx from '../assets/sounds/promote.mp3'

  const currentTheme = ref(localStorage.getItem('chesslab_theme') || 'midnight')
  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chesslab_theme', newTheme)
  }, { immediate: true })

  let boardReady = false
  let engineReady = false

  onMounted(async () => {
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)
    loadSounds()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('click', closeContextMenu)
    window.addEventListener('scroll', closeContextMenu, true)
    activeTab.value = 'moves'
    await startEngine()
    engineReady = true
    if (route.query.fen) {
      await loadFen(route.query.fen)
      await getAccuracy()
    } else if (route.query.moves) {
      await tryLoadImportedGame()
    } else {
      await getAccuracy()
    }
    recalcCapturedPieces()
    rebuildEvalHistory()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('pointerdown', unlockAudio)
    window.removeEventListener('keydown', unlockAudio)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('click', closeContextMenu)
    window.removeEventListener('scroll', closeContextMenu, true)
    clearTimeout(toastTimeout)
    clearTimeout(longPressTimer)
    document.body.style.overflow = ''
  })

  const route = useRoute()
  const router = useRouter()
  const isSettingsOpen = ref(false)
  const isFlipped = computed(() => (rotate.value / 180) % 2 === 1)
  const chess = new Chess()
  const greedyChess = new Chess()
  const excellentChess = new Chess()
  const bestChess = new Chess()
  const thirdChess = new Chess()
  const DEPTH_STORAGE_KEY = 'chesslab_targetDepth'

  function loadStoredDepth() {
    const stored = Number(localStorage.getItem(DEPTH_STORAGE_KEY))
    return stored >= 10 && stored <= 30 ? stored : 10
  }

  const moveData = shallowRef(null)
  const boardAPI = shallowRef(null)
  const isAnalyzing = ref(false)
  const isImporting = ref(false)
  const importProgress = ref({ current: 0, total: 0 })
  let importCancelled = false
  const currentDepth = ref(10)
  const targetDepth = ref(loadStoredDepth())
  const height = ref(47.75)
  const cp = ref(0)
  const rotate = ref(0)
  const isAccuracy = ref(" ")
  const color = ref(" ")
  const sanLine = ref([])
  const bestMoveSan = ref('')
  const excellentSanLine = ref([])
  const treeVersion = ref(0)
  const movesListUCI = ref([])
  const lastMoveSquare = ref(null)
  const lastMoveFromSquare = ref(null)
  const lastMoveAccuracy = ref(null)
  const boardRef = ref(null)
  const movesListRef = ref(null)
  const movesScrollRef = ref(null)
  const thirdSanLine = ref([])
  const soundOn = ref(true)
  const bestArrowSquares = ref(null)
  const toastMessage = ref('')
  const activeTab = ref('moves')
  const contextMenu = ref({ visible: false, x: 0, y: 0, nodeId: null })
  const shareMenuOpen = ref(false)
  const lineStart = ref({ turn: 'w', num: 1 })

  function numberedLine(sans) {
    let { turn, num } = lineStart.value
    return sans.map((san, i) => {
      let prefix = ''
      if (turn === 'w') prefix = `${num}.`
      else if (i === 0) prefix = `${num}... `
      if (turn === 'b') num++
      turn = turn === 'w' ? 'b' : 'w'
      return { san, prefix }
    })
  }

  const soundUrls = { move: moveSfx, capture: captureSfx, check: checkSfx, castle: castleSfx, promote: promoteSfx }
  const audioBuffers = {}
  let audioCtx = null
  let masterGain = null

  function getAudioCtx() {
    if (audioCtx) return audioCtx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    audioCtx = new AC()
    masterGain = audioCtx.createGain()
    masterGain.gain.value = 0.6
    masterGain.connect(audioCtx.destination)
    return audioCtx
  }

  async function loadSounds() {
    const ctx = getAudioCtx()
    if (!ctx) return
    await Promise.all(Object.entries(soundUrls).map(async ([name, url]) => {
      try {
        const res = await fetch(url)
        audioBuffers[name] = await ctx.decodeAudioData(await res.arrayBuffer())
      } catch (e) {}
    }))
  }

  function unlockAudio() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume()
  }

  // --- Engine Toggle & MultiPV State ---
  const isEngineEnabled = ref(true)
  const BEST_ARROW_STORAGE_KEY = 'chesslab_showBestArrow'

  function loadStoredBestArrowSetting() {
    const stored = localStorage.getItem(BEST_ARROW_STORAGE_KEY)
    if (stored === null) return true
    return stored === 'true'
  }
  const showBestArrow = ref(loadStoredBestArrowSetting())

  // ===== BEST MOVE ARROW (green, for any move that was not the best) =====
  const NOT_BEST = ['good', 'excellent', 'inaccuracy', 'mistake', 'blunder']
  const CASTLE_FIX = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' }

  // Reads straight from the current node, and clears old arrows first.
  // So it is safe to call it at any time.
  function drawBestArrow() {
    if (!boardAPI.value) return
    boardAPI.value.hideMoves()
    if (!showBestArrow.value) return
    const node = currentNode.value
    const data = node.analysisData
    if (!node.san || !data?.best_move || !NOT_BEST.includes(data.move_accuracy)) return
    const best = CASTLE_FIX[data.best_move] ?? data.best_move
    boardAPI.value.drawMove(best.slice(0, 2), best.slice(2, 4), 'green')
  }

  watch(showBestArrow, (enabled) => {
    localStorage.setItem(BEST_ARROW_STORAGE_KEY, String(enabled))
    drawBestArrow()
  })

  function loadStoredMultiPV() {
    const stored = Number(localStorage.getItem('chesslab_multiPV'))
    if (stored >= 1 && stored <= 3) return stored
    localStorage.setItem('chesslab_multiPV', '1')
    return 1
  }

  function handleBoardClick() {
    setTimeout(drawBestArrow, 50)
  }

  const analysisMultiPV = ref(loadStoredMultiPV())
  watch(analysisMultiPV, (val) => {
    localStorage.setItem('chesslab_multiPV', String(val))
    if (isEngineEnabled.value) getAccuracy()
  })

  watch(isEngineEnabled, () => {
    if (isImporting.value) return
    getAccuracy()
  })

  function requestAnalysisForNewMove() {
    if (isImporting.value) return
    if (!isEngineEnabled.value) {
      isEngineEnabled.value = true
    } else {
      getAccuracy()
    }
  }

  const whiteName = ref('White')
  const blackName = ref('Black')
  const whiteRating = ref(null)
  const blackRating = ref(null)
  const hasPlayerInfo = ref(false)
  const gameResult = ref(null)
  if (route.query.pgn) {
    const match = route.query.pgn.match(/\[Result\s+"([^"]+)"\]/)
    if (match) gameResult.value = match[1]
  }

  const opening = ref("")
  const openingEco = ref("")
  const explorerStats = shallowRef(null)
  const explorerMoves = shallowRef([])
  const explorerLoading = ref(false)
  const explorerError = ref("")
  const explorerDb = ref('masters')

  const accuracyColors = {
    brilliant: '#03aea7', great: '#4c8cb5', best: '#6ad13f', excellent: '#90bc36',
    good: '#8eae83', book: '#ad8760', inaccuracy: '#f2bc43', mistake: '#f38800', blunder: '#FF0000'
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.replace('#', ''), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }

  const lastMoveHighlightColor = computed(() => {
    const c = accuracyColors[lastMoveAccuracy.value]
    return c ? hexToRgba(c, 0.35) : null
  })

  watch([lastMoveFromSquare, lastMoveSquare], ([from, to]) => {
    if (!boardAPI.value) return
    boardAPI.value.setConfig({ lastMove: from && to ? [from, to] : undefined })
  })

  function isExplorerOutOfBook(node, db) {
    let n = node
    while (n) {
      if (n.explorerOutOfBook && n.explorerOutOfBook[db]) return true
      n = n.parent
    }
    return false
  }

  function markNodeOutOfBook(db) {
    if (!currentNode.value.explorerOutOfBook) currentNode.value.explorerOutOfBook = {}
    currentNode.value.explorerOutOfBook[db] = true
  }

  function getLastOpening(node) {
    let n = node
    while (n) {
      if (n.lastOpening) return n.lastOpening
      n = n.parent
    }
    return null
  }

  let savedExplorerScrollTop = 0

  async function importLichessExplorer() {
    const isExplorer = activeTab.value === 'explorer' && movesScrollRef.value
    if (isExplorer) {
      savedExplorerScrollTop = movesScrollRef.value.scrollTop
    }

    const restoreScroll = () => {
      if (isExplorer && movesScrollRef.value) {
        nextTick(() => {
          if (movesScrollRef.value) {
            movesScrollRef.value.scrollTop = savedExplorerScrollTop
          }
        })
      }
    }

    if (isExplorerOutOfBook(currentNode.value, explorerDb.value)) {
      const last = getLastOpening(currentNode.value)
      if (last) {
        opening.value = last.name
        openingEco.value = last.eco
      } else {
        opening.value = movesListUCI.value.length === 0 ? "Starting position" : "Out of book"
        openingEco.value = ""
      }
      explorerStats.value = null
      explorerMoves.value = []
      explorerError.value = ""
      explorerLoading.value = false

      restoreScroll()
      return
    }

    explorerLoading.value = true
    explorerError.value = ""

    const uciList = movesListUCI.value
    if (uciList.length > 40) {
      markNodeOutOfBook(explorerDb.value)
      const last = getLastOpening(currentNode.value)
      if (last) {
        opening.value = last.name
        openingEco.value = last.eco
      } else {
        opening.value = `${explorerDb.value === 'masters' ? 'Master' : 'Player'} games limit reached (max 40 moves)`
        openingEco.value = ""
      }
      explorerLoading.value = false

      restoreScroll()
      return
    }

    const bookList = uciList.join(",")
    const dbParam = explorerDb.value
    const url = bookList
      ? `../../api/explorer?db=${dbParam}&play=${encodeURIComponent(bookList)}`
      : `../../api/explorer?db=${dbParam}`

    try {
      const response = await fetch(url)

      if (response.status === 204) {
        markNodeOutOfBook(explorerDb.value)
        const last = getLastOpening(currentNode.value)
        if (last) {
          opening.value = last.name
          openingEco.value = last.eco
        } else {
          opening.value = `No ${explorerDb.value === 'masters' ? 'master' : 'player'} games at this position`
          openingEco.value = ""
        }
        explorerStats.value = null
        explorerMoves.value = []
        explorerError.value = ""
        return
      }

      if (!response.ok) {
        explorerError.value = `Explorer error (${response.status})`
        explorerStats.value = null
        explorerMoves.value = []
        return
      }

      const data = await response.json()

      if (data.opening) {
        opening.value = data.opening.name
        openingEco.value = data.opening.eco
        currentNode.value.lastOpening = {
          name: data.opening.name,
          eco: data.opening.eco
        }
      } else {
        const last = getLastOpening(currentNode.value.parent)
        if (last) {
          opening.value = last.name
          openingEco.value = last.eco
        } else {
          opening.value = uciList.length === 0 ? "Starting position" : "Out of book"
          openingEco.value = ""
        }
      }

      const total = (data.white ?? 0) + (data.draws ?? 0) + (data.black ?? 0)
      if (total === 0 && uciList.length > 0) {
        markNodeOutOfBook(explorerDb.value)
      }

      explorerStats.value = total > 0 ? {
        white: Math.round((data.white / total) * 100),
        draws: Math.round((data.draws / total) * 100),
        black: Math.round((data.black / total) * 100),
        total
      } : null

      explorerMoves.value = (data.moves ?? [])
        .map(m => {
          const moveTotal = (m.white ?? 0) + (m.draws ?? 0) + (m.black ?? 0)
          return {
            san: m.san, uci: m.uci, total: moveTotal,
            percent: total > 0 ? Math.round((moveTotal / total) * 100) : 0,
            white: moveTotal > 0 ? Math.round((m.white / moveTotal) * 100) : 0,
            draws: moveTotal > 0 ? Math.round((m.draws / moveTotal) * 100) : 0,
            black: moveTotal > 0 ? Math.round((m.black / moveTotal) * 100) : 0,
          }
        })
        .sort((a, b) => b.total - a.total)

      explorerError.value = ""
    } catch (error) {
      console.warn("Explorer fetch failed:", error)
      explorerError.value = "No connection to explorer"
      explorerStats.value = null
      explorerMoves.value = []
    } finally {
      explorerLoading.value = false

      // Restore scroll after loading finishes (covers success, errors, and 204s)
      restoreScroll()
    }
  }

  function playExplorerMove(uci) {
    if (isImporting.value) return
    const result = applyUciMove(uci)
    if (!result) return
    soundForLastMove(result)
    boardAPI.value.setPosition(chess.fen())
    requestAnalysisForNewMove()
  }

  if (route.query.white || route.query.black) {
    hasPlayerInfo.value = true
    if (route.query.white) whiteName.value = route.query.white
    if (route.query.black) blackName.value = route.query.black
    if (route.query.whiteRating) whiteRating.value = route.query.whiteRating
    if (route.query.blackRating) blackRating.value = route.query.blackRating
  }

  const isWhiteWinner = computed(() => gameResult.value === '1-0')
  const isBlackWinner = computed(() => gameResult.value === '0-1')

  const topPlayer = computed(() => {
    const isWhite = isFlipped.value
    return {
      name: isWhite ? whiteName.value : blackName.value,
      rating: isWhite ? whiteRating.value : blackRating.value,
      side: isWhite ? 'white' : 'black',
      isWinner: isWhite ? isWhiteWinner.value : isBlackWinner.value
    }
  })

  const bottomPlayer = computed(() => {
    const isWhite = !isFlipped.value
    return {
      name: isWhite ? whiteName.value : blackName.value,
      rating: isWhite ? whiteRating.value : blackRating.value,
      side: isWhite ? 'white' : 'black',
      isWinner: isWhite ? isWhiteWinner.value : isBlackWinner.value
    }
  })

  let longPressTimer = null
  let longPressTriggered = false
  let toastTimeout = null
  let lastPress = 0

  const moveTree = {
    id: 0, san: null, uci: null, fen: chess.fen(),
    accuracy: null, analysisData: null, parent: null, children: []
  }
  let nodeIdCounter = 1
  const nodeMap = { 0: moveTree }
  const currentNode = shallowRef(moveTree)

  const renderedMoves = computed(() => {
    treeVersion.value
    const rows = []
    function makeCell(node, moveNum, showAsStart, depth) {
      const isWhite = moveNum % 2 === 1
      return {
        key: `cell-${node.id}`, node,
        displayNum: Math.ceil(moveNum / 2),
        isWhite, showNum: isWhite || showAsStart, variant: depth > 0
      }
    }
    function walk(startNode, moveNum, depth = 0, isStartOfLine = true) {
      let current = startNode
      let ply = moveNum
      let firstRow = true
      if (!current.san) {
        if (current.children.length === 0) return
        walk(current.children[0], ply, depth, isStartOfLine)
        for (const variant of current.children.slice(1)) walk(variant, ply, depth + 1, true)
        return
      }
      while (current) {
        const mainReply = current.children[0] ?? null
        rows.push({
          key: `row-${current.id}`, depth,
          cells: [
            makeCell(current, ply, firstRow && isStartOfLine, depth),
            mainReply ? makeCell(mainReply, ply + 1, false, depth) : null
          ]
        })
        for (const variant of current.children.slice(1)) walk(variant, ply + 1, depth + 1, true)
        if (mainReply) for (const variant of mainReply.children.slice(1)) walk(variant, ply + 2, depth + 1, true)
        if (!mainReply) break
        current = mainReply.children[0] ?? null
        ply += 2
        firstRow = false
      }
    }
    walk(moveTree, 1)
    return rows
  })

  function deleteMove(nodeId) {
    const node = nodeMap[nodeId]
    if (!node || node.parent === null) return
    const parent = node.parent
    const idx = parent.children.indexOf(node)
    if (idx !== -1) parent.children.splice(idx, 1)
    function collectIds(n, ids) { ids.push(n.id); for (const child of n.children) collectIds(child, ids); return ids }
    const idsToRemove = collectIds(node, [])
    const currentWasRemoved = idsToRemove.includes(currentNode.value.id)
    for (const id of idsToRemove) delete nodeMap[id]
    treeVersion.value++
    if (currentWasRemoved) jumpToNode(parent.id)
  }

  function showContextMenu(x, y, nodeId) {
    const menuWidth = 160, menuHeight = 44
    contextMenu.value = {
      visible: true,
      x: Math.min(x, window.innerWidth - menuWidth - 8),
      y: Math.min(y, window.innerHeight - menuHeight - 8),
      nodeId
    }
  }
  function closeContextMenu() { contextMenu.value.visible = false; shareMenuOpen.value = false }
  function openContextMenu(event, nodeId) { showContextMenu(event.clientX, event.clientY, nodeId) }
  function handleDeleteFromMenu() {
    if (contextMenu.value.nodeId !== null) deleteMove(contextMenu.value.nodeId)
    closeContextMenu()
  }

  function handleTouchStart(event, nodeId) {
    longPressTriggered = false
    longPressTimer = setTimeout(() => {
      longPressTriggered = true
      const touch = event.touches[0]
      showContextMenu(touch.clientX, touch.clientY, nodeId)
      if (navigator.vibrate) navigator.vibrate(10)
    }, 500)
  }
  function cancelLongPress() { clearTimeout(longPressTimer) }

  function handleCellClick(nodeId) {
    if (longPressTriggered) { longPressTriggered = false; return }
    jumpToNode(nodeId)
  }

  function toggleShareMenu(event) {
    if (event) event.stopPropagation()
    shareMenuOpen.value = !shareMenuOpen.value
  }

  function playSound(type) {
    if (!soundOn.value || !audioCtx) return
    const buffer = audioBuffers[type]
    if (!buffer) return
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const src = audioCtx.createBufferSource()
    src.buffer = buffer
    src.connect(masterGain)
    src.start(0)
  }

  function soundForLastMove(sanMove) {
    if (!sanMove) return
    const san = sanMove.san || ''
    const isCapture = !!sanMove.captured
    const isCheck = san.includes('+') || san.includes('#')
    const isCastle = san.includes('O-O') || san.includes('0-0')
    const isPromotion = !!sanMove.promotion
    let primarySound = 'move'
    if (isCapture) primarySound = 'capture'
    else if (isCastle) primarySound = 'castle'
    else if (isPromotion) primarySound = 'promote'
    playSound(primarySound)
    if (isCheck) {
      setTimeout(() => playSound('check'), 120)
    }
  }

  watch(currentNode, () => { if (activeTab.value === 'explorer') importLichessExplorer() }, { immediate: true })
  watch(activeTab, (newTab) => { if (newTab === 'explorer') importLichessExplorer() })
  watch(explorerDb, () => { importLichessExplorer() })

  function showToast(message) {
    toastMessage.value = message
    clearTimeout(toastTimeout)
    toastTimeout = setTimeout(() => { toastMessage.value = '' }, 1800)
  }

  async function copyToClipboard(text, label) {
    try { await navigator.clipboard.writeText(text); showToast(`${label} copied to clipboard`) }
    catch (e) { showToast(`Couldn't copy ${label.toLowerCase()}`) }
  }
  function copyPGN() { copyToClipboard(chess.pgn() || '(no moves yet)', 'PGN') }
  function copyFEN() { copyToClipboard(chess.fen(), 'FEN') }

  async function onBoardCreated(api) {
    boardAPI.value = api
    chess.reset()
    boardAPI.value.setPosition(chess.fen())
    boardReady = true
    await tryLoadImportedGame()
  }

  // ===== CAPTURED PIECES & MATERIAL ADVANTAGE ==============================
  const PIECE_UNICODE = {
    wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕',
    bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛'
  }
  const PIECE_MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9 }
  const capturedByWhite = ref([])
  const capturedByBlack = ref([])
  const materialDiff = ref(0)

  function recalcCapturedPieces() {
    const wCap = []
    const bCap = []
    let wMat = 0, bMat = 0
    const uciPath = []
    let n = currentNode.value
    while (n.parent !== null) { uciPath.unshift(n.uci); n = n.parent }
    const tracker = new Chess()
    if (moveTree.fen && moveTree.fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
      try { tracker.load(moveTree.fen) } catch (e) { tracker.reset() }
    }
    for (const uci of uciPath) {
      let m
      try { m = tracker.move(uci) } catch (e) { break }
      if (m && m.captured) {
        const capturedColor = m.color === 'w' ? 'b' : 'w'
        const key = capturedColor + m.captured
        if (m.color === 'w') {
          wCap.push(key)
          wMat += PIECE_MATERIAL[m.captured] || 0
        } else {
          bCap.push(key)
          bMat += PIECE_MATERIAL[m.captured] || 0
        }
      }
    }
    const sortDesc = (a, b) => (PIECE_MATERIAL[b[1]] || 0) - (PIECE_MATERIAL[a[1]] || 0)
    capturedByWhite.value = wCap.sort(sortDesc)
    capturedByBlack.value = bCap.sort(sortDesc)
    materialDiff.value = wMat - bMat
  }

  // ===== EVALUATION HISTORY GRAPH (Lichess-style area chart) =============
  const EVAL_GRAPH_W = 1000
  const EVAL_GRAPH_H = 300
  const evalHistory = ref([])
  const graphHoverIdx = ref(-1)

  function rebuildEvalHistory() {
    const history = [{ ply: 0, cp: 0, graphCp: 0, accuracy: null, nodeId: 0, san: null, evalText: '0.00' }]
    let node = moveTree.children[0] ?? null
    let ply = 1
    while (node) {
      const data = node.analysisData
      let cp = 0, graphCp = 0, evalText = '…'
      if (data?.eval) {
        if (data.eval.type === 'cp') {
          cp = data.eval.value
          graphCp = Math.max(-1500, Math.min(1500, cp))
          evalText = `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`
        } else if (data.eval.type === 'mate') {
          cp = data.eval.value > 0 ? 800 : -800
          graphCp = data.eval.value > 0 ? 1500 : -1500
          evalText = `${data.eval.value > 0 ? '+M' : '-M'}${Math.abs(data.eval.value)}`
        }
      }
      history.push({ ply, cp, graphCp, accuracy: node.accuracy || null, nodeId: node.id, san: node.san, evalText })
      node = node.children[0] ?? null
      ply++
    }
    evalHistory.value = history
  }

  function evalGraphY(graphCp) {
    const p = 1 / (1 + Math.exp(-graphCp / 300))
    return EVAL_GRAPH_H * (1 - p)
  }

  const evalGraphGeom = computed(() => {
    const pts = evalHistory.value
    if (pts.length < 2) return null
    const step = EVAL_GRAPH_W / (pts.length - 1)
    const coords = pts.map((pt, i) => {
      const y = evalGraphY(pt.graphCp)
      return {
        ...pt,
        x: i * step,
        y,
        xPct: ((i * step) / EVAL_GRAPH_W) * 100,
        yPct: (y / EVAL_GRAPH_H) * 100
      }
    })
    const line = coords.reduce((d, c, i) => {
      if (i === 0) return `M${c.x.toFixed(1)},${c.y.toFixed(1)}`
      const p = coords[i - 1]
      const mx = ((p.x + c.x) / 2).toFixed(1)
      return `${d} C${mx},${p.y.toFixed(1)} ${mx},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`
    }, '')
    const whiteArea = `${line} L${EVAL_GRAPH_W},${EVAL_GRAPH_H} L0,${EVAL_GRAPH_H} Z`
    const blackArea = `${line} L${EVAL_GRAPH_W},0 L0,0 Z`
    const currentIdx = coords.findIndex(c => c.nodeId === currentNode.value.id)
    return { coords, line, whiteArea, blackArea, currentIdx }
  })

  function evalGraphClick(event) {
    const geom = evalGraphGeom.value
    if (!geom) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const idx = Math.round(ratio * (geom.coords.length - 1))
    const target = geom.coords[idx]
    if (target) jumpToNode(target.nodeId)
  }

  function evalGraphHover(event) {
    const geom = evalGraphGeom.value
    if (!geom) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    graphHoverIdx.value = Math.round(ratio * (geom.coords.length - 1))
  }

  const graphHoverData = computed(() => {
    const geom = evalGraphGeom.value
    const idx = graphHoverIdx.value
    if (!geom || idx < 0 || idx >= geom.coords.length) return null
    const pt = geom.coords[idx]
    const label = pt.ply === 0 ? 'Start' : `${Math.ceil(pt.ply / 2)}${pt.ply % 2 === 1 ? '.' : '…'}`
    const meta = pt.accuracy ? classificationMeta[pt.accuracy] : null
    return {
      pt,
      label,
      san: pt.san || '',
      evalText: pt.evalText || '0.00',
      accLabel: meta ? meta.label : null,
      accColor: meta ? meta.color : null,
      leftPct: Math.max(10, Math.min(90, pt.xPct)),
      below: pt.yPct < 34
    }
  })

  function scrollActiveMoveIntoView() {
    const container = movesScrollRef.value
    const list = movesListRef.value
    if (!container || !list) return
    const active = list.querySelector('.move-cell.active')
    if (!active) return
    const tabsHeight = container.querySelector('.tabs-toggle')?.offsetHeight || 0
    const cRect = container.getBoundingClientRect()
    const aRect = active.getBoundingClientRect()
    const topLimit = cRect.top + tabsHeight + 6
    const bottomLimit = cRect.bottom - 6
    let delta = 0
    if (aRect.top < topLimit) delta = aRect.top - topLimit
    else if (aRect.bottom > bottomLimit) delta = aRect.bottom - bottomLimit
    if (Math.abs(delta) > 1) {
      container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' })
    }
  }

  watch(currentNode, () => {
    recalcCapturedPieces()
    rebuildEvalHistory()
    nextTick(scrollActiveMoveIntoView)
  })
  watch(treeVersion, () => { rebuildEvalHistory() })

  const showShortcuts = ref(false)
  const shortcuts = [
    { keys: '← / →', desc: 'Previous / Next move' },
    { keys: 'Home / End', desc: 'Jump to start / end' },
    { keys: 'F', desc: 'Flip board' },
    { keys: 'S', desc: 'Toggle settings' },
    { keys: 'E', desc: 'Toggle engine' },
    { keys: '?', desc: 'Show / hide this panel' },
    { keys: 'Esc', desc: 'Close menus / minimize report' },
  ]
  function toggleShortcuts() { showShortcuts.value = !showShortcuts.value }

  const editingNoteNodeId = ref(null)
  const noteDraft = ref('')
  function openNoteEditor(nodeId) {
    const node = nodeMap[nodeId]
    if (!node) return
    editingNoteNodeId.value = nodeId
    noteDraft.value = node.note || ''
  }
  function saveNote() {
    if (editingNoteNodeId.value === null) return
    const node = nodeMap[editingNoteNodeId.value]
    if (node) {
      node.note = noteDraft.value.trim() || null
      treeVersion.value++
    }
    editingNoteNodeId.value = null
    noteDraft.value = ''
  }
  function cancelNote() {
    editingNoteNodeId.value = null
    noteDraft.value = ''
  }

  const isReportMaximized = ref(false)
  function toggleReportMaximize() { isReportMaximized.value = !isReportMaximized.value }
  watch(isReportMaximized, (max) => {
    document.body.style.overflow = max ? 'hidden' : ''
  })

  function startReview() {
    isReportMaximized.value = false
    activeTab.value = 'moves'
  }

  function handleBothMoves(move) {
    if (isImporting.value) return
    const uci = move.promotion ? `${move.from}${move.to}${move.promotion}` : `${move.from}${move.to}`
    let sanMove
    try {
      sanMove = chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined })
    } catch (e) {
      sanMove = null
    }
    if (!sanMove) {
      boardAPI.value.setPosition(currentNode.value.fen)
      return
    }
    soundForLastMove(sanMove)
    const existing = currentNode.value.children.find(c => c.uci === uci)
    if (existing) {
      currentNode.value = existing
    } else {
      const newNode = {
        id: nodeIdCounter++, san: sanMove.san, uci, fen: chess.fen(),
        accuracy: null, analysisData: null, parent: currentNode.value, children: []
      }
      nodeMap[newNode.id] = newNode
      currentNode.value.children.push(newNode)
      currentNode.value = newNode
      treeVersion.value++
    }
    movesListUCI.value.push(uci)
    recalcCapturedPieces()
    requestAnalysisForNewMove()
  }

  function undoMove() {
    lastMoveSquare.value = null
    lastMoveFromSquare.value = null
    lastMoveAccuracy.value = null
    if (currentNode.value.parent === null) return
    chess.undo()
    currentNode.value = currentNode.value.parent
    movesListUCI.value.pop()
    boardAPI.value.setPosition(chess.fen())
    playSound('move')
    recalcCapturedPieces()
  }

  function redoMove() {
    lastMoveSquare.value = null
    lastMoveFromSquare.value = null
    lastMoveAccuracy.value = null
    if (currentNode.value.children.length === 0) return
    const nextNode = currentNode.value.children[0]
    let sanMove
    try { sanMove = chess.move(nextNode.uci) } catch (e) { sanMove = null }
    if (sanMove) soundForLastMove(sanMove)
    movesListUCI.value.push(nextNode.uci)
    currentNode.value = nextNode
    boardAPI.value.setPosition(nextNode.fen)
    recalcCapturedPieces()
  }

  function undoAccuracy() { undoMove(); getAccuracy() }
  function redoAccuracy() { redoMove(); getAccuracy() }

  function jumpToNode(nodeId) {
    const node = nodeMap[nodeId]
    if (!node || node === currentNode.value) return
    const uciMoves = []
    let current = node
    while (current.parent !== null) { uciMoves.unshift(current.uci); current = current.parent }
    chess.reset()
    for (const uci of uciMoves) {
      try {
        chess.move(uci)
      } catch (e) {
        console.warn("Failed to apply UCI in jumpToNode", uci, e)
      }
    }
    movesListUCI.value = uciMoves
    currentNode.value = node
    boardAPI.value.setPosition(node.fen)
    moveData.value = null
    isAccuracy.value = " "
    color.value = " "
    recalcCapturedPieces()
    getAccuracy()
  }

  function goToStart() {
    if (currentNode.value.id !== 0) {
      playSound('move')
      jumpToNode(0)
    }
  }

  function goToEnd() {
    let node = currentNode.value
    while (node.children.length > 0) {
      node = node.children[0]
    }
    if (node.id !== currentNode.value.id) {
      playSound('move')
      jumpToNode(node.id)
    }
  }

  function resetBoard() {
    chess.reset()
    boardAPI.value.setPosition(chess.fen())
    movesListUCI.value = []
    currentNode.value = moveTree
    moveTree.children = []
    moveTree.fen = chess.fen()
    nodeIdCounter = 1
    for (const key in nodeMap) if (parseInt(key) !== 0) delete nodeMap[key]
    bestVariation.value = null
    treeVersion.value++
    capturedByWhite.value = []
    capturedByBlack.value = []
    materialDiff.value = 0
    getAccuracy()
  }

  function resetAccuracy() { resetBoard(); isAccuracy.value = " "; color.value = " "; moveData.value = null }

  async function getAccuracy() {
    await cancelAnalysis()
    const cached = currentNode.value.analysisData
    const requiresMultiPV3 = !isImporting.value && isEngineEnabled.value
    const hasRequiredMultiPV = !requiresMultiPV3 || !currentNode.value.san || (cached?.topMoves?.length >= analysisMultiPV.value)
    const depthNeeded = isImporting.value
      ? targetDepth.value
      : Math.min(targetDepth.value, 20)
    if (!isImporting.value && !isEngineEnabled.value && cached) {
      moveData.value = cached
      lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
      lastMoveFromSquare.value = movesListUCI.value.at(-1)?.slice(0, 2) ?? null
      lastMoveAccuracy.value = cached.move_accuracy
      currentDepth.value = cached.depth
      isAnalyzing.value = false
      evalSize(); moveDescription(); sanBest(); uciSecondLine(); uciThirdLine(); uciLine(); drawBestArrow()
      return
    }
    if (!isImporting.value && !isEngineEnabled.value && !cached) {
      moveData.value = null
      isAccuracy.value = " "
      color.value = " "
      isAnalyzing.value = false
      drawBestArrow()
      return
    }
    if (cached && cached.depth >= depthNeeded && hasRequiredMultiPV) {
      moveData.value = cached
      lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
      lastMoveFromSquare.value = movesListUCI.value.at(-1)?.slice(0, 2) ?? null
      lastMoveAccuracy.value = cached.move_accuracy
      currentDepth.value = cached.depth
      isAnalyzing.value = false
      evalSize(); moveDescription(); sanBest(); uciSecondLine(); uciThirdLine(); uciLine(); drawBestArrow()
      return
    }
    if (cached && !hasRequiredMultiPV) {
      moveData.value = cached
      lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
      lastMoveFromSquare.value = movesListUCI.value.at(-1)?.slice(0, 2) ?? null
      lastMoveAccuracy.value = cached.move_accuracy
      currentDepth.value = cached.depth
      evalSize(); moveDescription(); sanBest(); uciSecondLine(); uciThirdLine(); uciLine(); drawBestArrow()
    }
    isAnalyzing.value = true
    bestArrowSquares.value = null
    drawBestArrow()
    const beforeFen = currentNode.value.parent ? currentNode.value.parent.fen : moveTree.fen
    const afterFen = currentNode.value.fen
    const depthToUse = isImporting.value
      ? targetDepth.value
      : (isEngineEnabled.value ? Math.min(targetDepth.value, 20) : targetDepth.value)
    const multiPVToUse = isImporting.value ? 1 : analysisMultiPV.value
    await getEvaluation(
      movesListUCI.value.length === 0 ? '' : movesListUCI.value.at(-1),
      movesListUCI.value.slice(0, -1),
      depthToUse,
      (result) => {
        moveData.value = result
        lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
        lastMoveFromSquare.value = movesListUCI.value.at(-1)?.slice(0, 2) ?? null
        lastMoveAccuracy.value = result.move_accuracy
        currentNode.value.accuracy = result.move_accuracy
        currentNode.value.analysisData = result
        currentDepth.value = result.depth
        isAnalyzing.value = result.depth < depthToUse
        evalSize(); moveDescription(); sanBest(); uciSecondLine(); uciThirdLine(); uciLine(); drawBestArrow()
        if (!isImporting.value) treeVersion.value++
      },
      beforeFen, afterFen, moveTree.fen,
      multiPVToUse,
      chess.isCheckmate(),
      chess.isStalemate()
    )
    isAnalyzing.value = false
  }

  function onDepthChange() {
    localStorage.setItem(DEPTH_STORAGE_KEY, String(targetDepth.value))
    getAccuracy()
  }

  function formatEval(evalObj) {
    if (chess.isStalemate()) return '1/2-1/2'
    if (evalObj) {
      if (evalObj.type === "cp") return (evalObj.value / 100).toFixed(2)
      if (evalObj.type === "mate") return `M${evalObj.value}`
    }
    if (chess.isGameOver()) {
      if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0'
      if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition() || chess.isDraw()) return '1/2-1/2'
    }
    return " "
  }

  function evalSize() {
    if (!moveData.value || !moveData.value.eval) return
    const evalValue = moveData.value.eval.value
    const evalType = moveData.value.eval.type
    if (evalType === "mate") {
      if (evalValue >= 0) { cp.value = 800; height.value = 0 } else { cp.value = -800; height.value = 100 }
      return
    }
    cp.value = Math.max(-800, Math.min(800, evalValue))
    height.value = 50 - (cp.value / 800) * 50
  }

  function flipBoard() { boardAPI.value.toggleOrientation(); rotate.value += 180 }

  // MOVE ICONS (inline SVG, colors come from accuracyColors) 
  const ICON_STROKE = 'fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"'
  const ICON_Q = `<path d="M23 24C23 17 28 14 32 14C37 14 41 17 41 22C41 27 36 29 33 32C32 33 32 35 32 37" ${ICON_STROKE}/><circle cx="32" cy="46" r="3.5" fill="#fff"/>`
  const iconEx = (x) => `<rect x="${x - 3.5}" y="13" width="7" height="24" rx="3.5" fill="#fff"/><circle cx="${x}" cy="47" r="4" fill="#fff"/>`

  const ICON_BODY = {
    brilliant: iconEx(22) + iconEx(42),
    great: iconEx(32),
    best: '<polygon points="32,18 36.1,28.3 47.2,29.1 38.7,36.2 41.4,46.9 32,41 22.6,46.9 25.3,36.2 16.8,29.1 27.9,28.3" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>',
    excellent: '<rect x="14" y="28" width="9" height="20" rx="2" fill="#fff"/><path d="M26 29L33 14Q35 11 38 13Q40 15 39 18L37 25H48Q52 25 52 29Q52 31 51 32Q52 34 51 36Q52 38 50 40Q50 43 47 44L47 46H29Q26 46 26 44Z" fill="#fff"/>',
    good: `<path d="M19 33L28 42L46 22" ${ICON_STROKE}/>`,
    book: '<path d="M14 21Q23 19 31 24V47Q23 42 14 44Z" fill="#fff"/><path d="M50 21Q41 19 33 24V47Q41 42 50 44Z" fill="#fff"/>',
    inaccuracy: `<g transform="translate(1.6 10.6) scale(.7)">${ICON_Q}</g><rect x="41.5" y="14" width="7" height="22" rx="3.5" fill="#fff"/><circle cx="45" cy="46" r="4" fill="#fff"/>`,
    mistake: ICON_Q,
    blunder: `<g transform="translate(1.7 11.4) scale(.68)">${ICON_Q}</g><g transform="translate(18.7 11.4) scale(.68)">${ICON_Q}</g>`
  }

  function shade(hex, amt) { // -1 darker ... 1 lighter
    const n = parseInt(hex.slice(1), 16)
    const f = c => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
  }

  const GLOW_ICONS = ['brilliant', 'great', 'best']

    function accuracySymbol(acc) {
    const body = ICON_BODY[acc]
    if (!body) return undefined
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
    return 'data:image/svg+xml,' + encodeURIComponent(svg)
  }

  function accuracyToClass(acc) {
    if (acc === null || acc === undefined) return null
    if (acc >= 95) return 'great'
    if (acc >= 85) return 'best'
    if (acc >= 75) return 'excellent'
    if (acc >= 65) return 'good'
    if (acc >= 45) return 'inaccuracy'
    if (acc >= 20) return 'mistake'
    return 'blunder'
  }

  function moveDescription() {
    isAccuracy.value = ''
    if (!currentNode.value.san) return
    const descriptions = {
      great: { color: '#4c8cb5', text: ' is a great move!' },
      brilliant: { color: '#03aea7', text: ' is a brilliant move!!' },
      book: { color: '#ad8760', text: ' is a book move' },
      best: { color: '#6ad13f', text: ' is the best move' },
      excellent: { color: '#90bc36', text: ' is an excellent move' },
      good: { color: '#8eae83', text: ' is a good move' },
      inaccuracy: { color: '#f2bc43', text: ' is an inaccuracy' },
      mistake: { color: '#f38800', text: ' is a mistake' },
      blunder: { color: '#FF0000', text: ' is a blunder' },
    }
    const config = descriptions[moveData.value.move_accuracy]
    if (!config) return
    color.value = config.color
    isAccuracy.value = prettyMove(currentNode.value.san) + config.text
  }

  function displayBest() {
    if (['brilliant', 'best', 'great', 'book'].includes(moveData.value.move_accuracy)) return " "
    if (moveData.value.best_move === " ") return " "
    return prettyMove(bestMoveSan.value) + " was the best "
  }

  function uciLine() {
    const fenParts = chess.fen().split(' ')
    lineStart.value = { turn: fenParts[1], num: Number(fenParts[5]) || 1 }
    sanLine.value = []
    bestArrowSquares.value = null
    if (!moveData.value?.best_line) return
    let lineNum = 0
    greedyChess.load(chess.fen())
    for (let i = 0; i < 30; i++) {
      const greedyMoveBefore = moveData.value.best_line[lineNum]
      if (!greedyMoveBefore) break
      const greedyMove = greedyChess.move(greedyMoveBefore, { sloppy: true })
      if (!greedyMove) break
      sanLine.value.push(greedyMove.san)
      if (lineNum === 0) bestArrowSquares.value = { from: greedyMove.from, to: greedyMove.to }
      lineNum++
    }
  }

  function sanBest() {
    if (!moveData.value?.best_move) return
    const baseFen = currentNode.value.parent ? currentNode.value.parent.fen : moveTree.fen
    bestChess.load(baseFen)
    const bestMove = bestChess.move(moveData.value.best_move, { sloppy: true })
    if (!bestMove) return
    bestMoveSan.value = bestMove.san
  }

  function uciSecondLine() {
    excellentSanLine.value = []
    if (!moveData.value?.excellent_line) return
    let secondLineNum = 0
    excellentChess.load(chess.fen())
    for (let i = 0; i < 30; i++) {
      const m = moveData.value.excellent_line[secondLineNum]
      if (!m) break
      const mm = excellentChess.move(m, { sloppy: true })
      if (!mm) break
      excellentSanLine.value.push(mm.san)
      secondLineNum++
    }
  }

  function uciThirdLine() {
    thirdSanLine.value = []
    if (!moveData.value?.third_line) return
    let thirdLineNum = 0
    thirdChess.load(chess.fen())
    for (let i = 0; i < 30; i++) {
      const m = moveData.value.third_line[thirdLineNum]
      if (!m) break
      const mm = thirdChess.move(m, { sloppy: true })
      if (!mm) break
      thirdSanLine.value.push(mm.san)
      thirdLineNum++
    }
  }

  function prettyMove(move) {
    const pieces = { 'K': '♚', 'Q': '♛', 'R': '♜', 'B': '♝', 'N': '♞' }
    return move ? move.replace(/[KQRBN]/g, p => pieces[p]) : ''
  }

  function formatCount(num) {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B'
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
    if (num >= 10_000) return Math.round(num / 1000) + 'K'
    return num.toLocaleString()
  }

  function squareStyle(square) {
    if (!square) return {}
    const file = square.charCodeAt(0) - 97
    const rank = parseInt(square[1]) - 1
    const flipped = (rotate.value / 180) % 2 === 1
    const col = flipped ? 7 - file : file
    const row = flipped ? rank : 7 - rank
    return { position: 'absolute', left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%`, transform: 'translate(-70%, -35%)' }
  }

  async function playMove() {
    if (!moveData.value?.best_move) return
    const uci = moveData.value.best_move
    const from = uci.slice(0, 2), to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    undoMove()
    let sanMove
    try {
      sanMove = chess.move({ from, to, promotion: promotion ?? undefined })
    } catch (e) {
      sanMove = null
    }
    if (!sanMove) return
    soundForLastMove(sanMove)
    const existing = currentNode.value.children.find(c => c.uci === uci)
    if (existing) {
      currentNode.value = existing
    } else {
      const newNode = {
        id: nodeIdCounter++, san: sanMove.san, uci, fen: chess.fen(),
        accuracy: null, analysisData: null, parent: currentNode.value, children: []
      }
      nodeMap[newNode.id] = newNode
      currentNode.value.children.push(newNode)
      currentNode.value = newNode
    }
    movesListUCI.value.push(uci)
    boardAPI.value.setPosition(chess.fen())
    treeVersion.value++
    recalcCapturedPieces()
    requestAnalysisForNewMove()
  }

  // ===== PLAY BEST MOVE INSTEAD (lightbulb / trash button) ================
  const bestVariation = ref(null) // { nodeId, returnId }

  const canPlayBest = computed(() => {
    moveData.value // re-run when analysis updates
    const n = currentNode.value
    const d = n.analysisData
    return !!(n.san && d?.best_move && NOT_BEST.includes(d.move_accuracy))
  })

  const inBestVariation = computed(() => {
    treeVersion.value
    if (!bestVariation.value) return false
    let n = currentNode.value
    while (n) {
      if (n.id === bestVariation.value.nodeId) return true
      n = n.parent
    }
    return false
  })

  function playBestInstead() {
    if (isImporting.value || !canPlayBest.value) return
    const badNode = currentNode.value
    const parent = badNode.parent
    const best = badNode.analysisData.best_move
    const countBefore = parent.children.length
    undoMove()
    const result = applyUciMove(best)
    if (!result) return
    soundForLastMove(result)
    boardAPI.value.setPosition(chess.fen())
    // only remember it if we made a new line (don't delete the user's old lines)
    if (parent.children.length > countBefore) {
      bestVariation.value = { nodeId: currentNode.value.id, returnId: badNode.id }
    }
    requestAnalysisForNewMove()
  }

  function removeBestVariation() {
    const v = bestVariation.value
    if (!v) return
    bestVariation.value = null
    if (nodeMap[v.nodeId]) deleteMove(v.nodeId)
    jumpToNode(v.returnId)
  }

  const handleKeyDown = (event) => {
    const delay = 200
    const currentTime = Date.now()
    const tag = event.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.key === 'Escape') {
      closeContextMenu()
      showShortcuts.value = false
      editingNoteNodeId.value = null
      if (isReportMaximized.value) isReportMaximized.value = false
      return
    }
    if (event.key === '?') {
      event.preventDefault()
      toggleShortcuts()
      return
    }
    if (isImporting.value) return
    switch (event.key) {
      case 'ArrowLeft': if (currentTime - lastPress < delay) return; lastPress = currentTime; event.preventDefault(); undoAccuracy(); break
      case 'ArrowRight': if (currentTime - lastPress < delay) return; lastPress = currentTime; event.preventDefault(); redoAccuracy(); break
      case 'Home': event.preventDefault(); goToStart(); break
      case 'End': event.preventDefault(); goToEnd(); break
      case 'f': case 'F': event.preventDefault(); flipBoard(); break
      case 's': case 'S': event.preventDefault(); isSettingsOpen.value = !isSettingsOpen.value; break
      case 'e': case 'E': event.preventDefault(); isEngineEnabled.value = !isEngineEnabled.value; break
    }
  }

  function applyUciMove(uci) {
    const from = uci.slice(0, 2)
    let to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    const castlingFix = { 'e1h1': 'g1', 'e1a1': 'c1', 'e8h8': 'g8', 'e8a8': 'c8' }
    if (castlingFix[uci]) to = castlingFix[uci]
    let sanMove
    try {
      sanMove = chess.move({ from, to, promotion: promotion ?? undefined })
    } catch (e) {
      console.warn('Move execution failed for', uci, e)
      return false
    }
    if (!sanMove) return false
    const normalizedUci = `${from}${to}${promotion ?? ''}`
    const existing = currentNode.value.children.find(c => c.uci === normalizedUci)
    if (existing) {
      currentNode.value = existing
    } else {
      const newNode = {
        id: nodeIdCounter++, san: sanMove.san, uci: normalizedUci, fen: chess.fen(),
        accuracy: null, analysisData: null, parent: currentNode.value, children: []
      }
      nodeMap[newNode.id] = newNode
      currentNode.value.children.push(newNode)
      currentNode.value = newNode
      if (!isImporting.value) treeVersion.value++
    }
    movesListUCI.value.push(normalizedUci)
    recalcCapturedPieces()
    return sanMove
  }

  function playLineMoves(uciList, count) {
    if (!uciList || isImporting.value) return
    let lastSanMove = null
    for (let i = 0; i < count; i++) {
      const uci = uciList[i]
      if (!uci) break
      const result = applyUciMove(uci)
      if (!result) break
      lastSanMove = result
    }
    if (lastSanMove) soundForLastMove(lastSanMove)
    boardAPI.value.setPosition(chess.fen())
    treeVersion.value++
    requestAnalysisForNewMove()
  }

  async function loadFen(fen) {
    chess.load(fen)
    moveTree.fen = fen
    currentNode.value = moveTree
    if (boardAPI.value) boardAPI.value.setPosition(fen)
  }

  async function loadImportedGame(uciList) {
    isImporting.value = true
    importCancelled = false
    importProgress.value = { current: 0, total: uciList.length }
    isEngineEnabled.value = false
    document.body.style.overflow = 'hidden'
    try {
      for (const uci of uciList) {
        if (importCancelled) break
        const result = applyUciMove(uci)
        if (!result) break
        await getAccuracy()
        importProgress.value.current++
        boardAPI.value.setPosition(chess.fen())
      }
      if (!importCancelled) {
        goToStart()
        treeVersion.value++
        await saveGameInsights()
        // open the maximized report with blurred background
        isReportMaximized.value = true
        activeTab.value = 'report'
      }
    } finally {
      isImporting.value = false
      isEngineEnabled.value = false
      getAccuracy()
    }
  }

  async function tryLoadImportedGame() {
    if (boardReady && engineReady && route.query.moves) {
      const myColor = route.query.myColor
      if (myColor === 'black' && !isFlipped.value) {
        flipBoard()
      } else if (myColor === 'white' && isFlipped.value) {
        flipBoard()
      }
      const importedUciList = route.query.moves.split('-')
      await loadImportedGame(importedUciList)
    }
  }

  async function cancelImport() {
    importCancelled = true
    await cancelAnalysis()
    isImporting.value = false
    resetAccuracy()
    hasPlayerInfo.value = false
    document.body.style.overflow = ''
    router.replace({ path: '/', query: {} })
  }

  const classificationOrder = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder']
  const classificationMeta = {
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
  const accuracyWeights = {
    brilliant: 100, great: 100, best: 100, book: 100,
    excellent: 90, good: 80, inaccuracy: 20, mistake: 10, blunder: 0
  }

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

  const importProgressPercent = computed(() => {
    if (!importProgress.value.total) return 0
    return Math.round((importProgress.value.current / importProgress.value.total) * 100)
  })

  const currentUserId = ref(null)
  let pendingGameMeta = null
  onMounted(() => {
    onAuthStateChanged(auth, (user) => { if (user) currentUserId.value = user.uid })
  })

  watch(() => route.query, (newQuery) => {
    if (newQuery.white || newQuery.black) {
      pendingGameMeta = {
        white: newQuery.white || 'White',
        black: newQuery.black || 'Black',
        pgn: newQuery.pgn || null,
        myColor: newQuery.myColor || null
      }
    } else {
      pendingGameMeta = null
    }
  }, { immediate: true })

  function calculateMaterialBalance(fen) {
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

  function getGamePhases(uciList) {
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

  function bucketLabel(moveNum) {
    if (moveNum <= 10) return '1-10'
    if (moveNum <= 20) return '11-20'
    if (moveNum <= 30) return '21-30'
    if (moveNum <= 40) return '31-40'
    return '41+'
  }

  function resultForColor(color) {
    if (gameResult.value === '1-0') return color === 'white' ? 'win' : 'lose'
    if (gameResult.value === '0-1') return color === 'black' ? 'win' : 'lose'
    if (gameResult.value === '1/2-1/2') return 'draw'
    return 'unknown'
  }

  async function saveGameInsights() {
    if (!currentUserId.value || !pendingGameMeta) return
    const uciList = []
    let curr = moveTree.children[0]
    while (curr) { uciList.push(curr.uci); curr = curr.children[0] }
    if (uciList.length === 0) return
    const myColor = pendingGameMeta.myColor === 'black' ? 'black' : 'white'
    const weights = { brilliant: 100, great: 100, best: 100, book: 100, excellent: 90, good: 80, inaccuracy: 20, mistake: 10, blunder: 0 }
    const myCounts = { brilliant: 0, great: 0, best: 0, book: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    let myWeightedSum = 0
    let myMoveCount = 0
    const moveBuckets = {}
    let node = moveTree.children[0]
    let ply = 1
    while (node) {
      const side = ply % 2 === 1 ? 'white' : 'black'
      if (side === myColor && node.accuracy && myCounts.hasOwnProperty(node.accuracy)) {
        const w = weights[node.accuracy] ?? 0
        myCounts[node.accuracy]++
        myWeightedSum += w
        myMoveCount++
        const label = bucketLabel(Math.ceil(ply / 2))
        if (!moveBuckets[label]) moveBuckets[label] = { sum: 0, count: 0 }
        moveBuckets[label].sum += w
        moveBuckets[label].count++
      }
      node = node.children[0]
      ply++
    }
    const overallAccuracy = myMoveCount > 0 ? (myWeightedSum / myMoveCount) : null
    const phases = getGamePhases(uciList)
    const phaseAccuracy = { opening: null, middlegame: null, endgame: null }
    const phaseCounts = { opening: 0, middlegame: 0, endgame: 0 }
    for (const [phase, [start, end]] of Object.entries(phases)) {
      let phaseSum = 0
      let phaseCount = 0
      let n = moveTree.children[0]
      let p = 1
      while (n) {
        const side = p % 2 === 1 ? 'white' : 'black'
        if (p > start && p <= end && side === myColor && n.accuracy) {
          phaseSum += weights[n.accuracy] ?? 0
          phaseCount++
        }
        n = n.children[0]
        p++
      }
      if (phaseCount > 0) phaseAccuracy[phase] = phaseSum / phaseCount
      phaseCounts[phase] = phaseCount
    }
    const blunderSquares = {}
    const goodSquares = {}
    let trackNode = moveTree.children[0]
    let trackPly = 1
    while (trackNode) {
      const side = trackPly % 2 === 1 ? 'white' : 'black'
      if (side === myColor) {
        const square = trackNode.uci.slice(2, 4)
        if (trackNode.accuracy === 'blunder' || trackNode.accuracy === 'mistake') {
          blunderSquares[square] = (blunderSquares[square] || 0) + 1
        } else if (['brilliant', 'great', 'best', 'excellent'].includes(trackNode.accuracy)) {
          goodSquares[square] = (goodSquares[square] || 0) + 1
        }
      }
      trackNode = trackNode.children[0]
      trackPly++
    }
    const pieceStats = { p: { count: 0, sum: 0 }, n: { count: 0, sum: 0 }, b: { count: 0, sum: 0 }, r: { count: 0, sum: 0 }, q: { count: 0, sum: 0 }, k: { count: 0, sum: 0 } }
    let pieceNode = moveTree.children[0]
    let piecePly = 1
    while (pieceNode) {
      const side = piecePly % 2 === 1 ? 'white' : 'black'
      if (side === myColor && pieceNode.accuracy && pieceNode.san) {
        let piece = 'p'
        const firstChar = pieceNode.san[0]
        if (['N', 'B', 'R', 'Q', 'K'].includes(firstChar)) piece = firstChar.toLowerCase()
        pieceStats[piece].count++
        pieceStats[piece].sum += weights[pieceNode.accuracy] ?? 0
      }
      pieceNode = pieceNode.children[0]
      piecePly++
    }
    const toCp = (ev) => {
      if (!ev) return null
      if (ev.type === 'mate') return Math.sign(ev.value) * 10000
      return ev.value
    }
    const fromMyPerspective = (cpv) => (myColor === 'white' ? cpv : -cpv)
    const myMat = (fen) => {
      const { whiteMat, blackMat } = calculateMaterialBalance(fen)
      return myColor === 'white' ? whiteMat : blackMat
    }
    let checks = 0, captures = 0, sacrifices = 0
    let inducedErrors = 0
    let cpLost = 0, cpWon = 0
    let bigSwingsFor = 0, bigSwingsAgainst = 0
    let defendSum = 0, defendCount = 0
    let attackSum = 0, attackCount = 0
    let myLastMoveWasStrong = false
    const STRONG = ['brilliant', 'great', 'best', 'excellent']
    const ERROR_WEIGHT = { inaccuracy: 1, mistake: 2, blunder: 3 }
    let prevNode = moveTree
    let tNode = moveTree.children[0]
    let tPly = 1
    while (tNode) {
      const side = tPly % 2 === 1 ? 'white' : 'black'
      const isMine = side === myColor
      const before = toCp(prevNode.analysisData?.eval)
      const after = toCp(tNode.analysisData?.eval)
      const delta = (before !== null && after !== null) ? fromMyPerspective(after) - fromMyPerspective(before) : null
      if (isMine) {
        if (tNode.san?.includes('+') || tNode.san?.includes('#')) checks++
        if (tNode.san?.includes('x')) captures++
        if (delta !== null) {
          if (delta < 0) cpLost += Math.min(-delta, 1000)
          if (delta <= -150) bigSwingsAgainst++
          const w = weights[tNode.accuracy]
          if (w !== undefined) {
            const stance = fromMyPerspective(before)
            if (stance <= -150) { defendSum += w; defendCount++ }
            else if (stance >= 150) { attackSum += w; attackCount++ }
          }
        }
        const reply = tNode.children[0] ?? null
        const replyEval = reply ? toCp(reply.analysisData?.eval) : null
        if (reply && before !== null && replyEval !== null) {
          const materialLost = myMat(prevNode.fen) - myMat(reply.fen)
          const windowDelta = fromMyPerspective(replyEval) - fromMyPerspective(before)
          if (materialLost >= 2 && windowDelta >= -100) sacrifices++
        }
        myLastMoveWasStrong = STRONG.includes(tNode.accuracy)
      } else {
        if (delta !== null) {
          if (delta > 0) cpWon += Math.min(delta, 1000)
          if (delta >= 150) bigSwingsFor++
        }
        if (myLastMoveWasStrong && ERROR_WEIGHT[tNode.accuracy]) inducedErrors += ERROR_WEIGHT[tNode.accuracy]
        myLastMoveWasStrong = false
      }
      prevNode = tNode
      tNode = tNode.children[0] ?? null
      tPly++
    }
    let result = null
    const resultMatch = (pendingGameMeta.pgn || '').match(/\[Result\s+"([^"]+)"\]/)
    if (resultMatch) {
      const r = resultMatch[1]
      if (r === '1-0') result = myColor === 'white' ? 'win' : 'loss'
      else if (r === '0-1') result = myColor === 'black' ? 'win' : 'loss'
      else if (r === '1/2-1/2') result = 'draw'
    }
    const playstyle = {
      v: 2,
      myMoves: myMoveCount,
      totalPlies: uciList.length,
      checks, captures,
      forcingMoves: checks + captures,
      sacrifices, inducedErrors,
      brilliantPlus: myCounts.brilliant + myCounts.great,
      bookMoves: myCounts.book,
      errors: { inaccuracy: myCounts.inaccuracy, mistake: myCounts.mistake, blunder: myCounts.blunder },
      cpLost, cpWon, bigSwingsFor, bigSwingsAgainst,
      defendSum, defendCount, attackSum, attackCount,
      phaseCounts,
      reachedEndgame: phases.endgame[0] < uciList.length ? 1 : 0,
      result
    }
    const openingName = await fetchOpeningNameForSave(uciList)
    const pgn = pendingGameMeta.pgn || chess.pgn()
    function generatePgnHash(p) {
      let hash = 0
      for (let i = 0; i < p.length; i++) { hash = (hash << 5) - hash + p.charCodeAt(i); hash &= hash }
      return String(hash)
    }
    const pgnHash = generatePgnHash(pgn)
    const extractedPuzzles = []
    let pNode = moveTree.children[0]
    let pPly = 1
    while (pNode) {
      const side = pPly % 2 === 1 ? 'white' : 'black'
      if (side === myColor && (pNode.accuracy === 'blunder' || pNode.accuracy === 'mistake')) {
        if (pNode.parent && pNode.analysisData?.best_move) {
          const beforeEval = pNode.parent.analysisData?.eval
          const afterEval = pNode.analysisData.eval
          if (beforeEval && afterEval) {
            const beforeCp = beforeEval.type === 'mate' ? Math.sign(beforeEval.value) * 10000 : beforeEval.value
            const afterCp = afterEval.type === 'mate' ? Math.sign(afterEval.value) * 10000 : afterEval.value
            let isPuzzleWorthy = false
            if (side === 'white') {
              if (beforeCp >= -300 && afterCp <= 300 && (beforeCp - afterCp >= 200)) isPuzzleWorthy = true
            } else {
              if (beforeCp <= 300 && afterCp >= -300 && (afterCp - beforeCp >= 200)) isPuzzleWorthy = true
            }
            if (isPuzzleWorthy) {
              extractedPuzzles.push({
                fen: pNode.parent.fen,
                bestMove: pNode.analysisData.best_move,
                playedMove: pNode.uci,
                playedMoveAccuracy: pNode.accuracy,
                turn: side,
                eval: { type: afterEval.type, value: afterEval.value },
                swing: Math.abs(beforeCp - afterCp),
                continuation: Array.isArray(pNode.analysisData.best_line) ? pNode.analysisData.best_line.slice(0, 5) : [],
                mateIn: beforeEval.type === 'mate' ? Math.abs(beforeEval.value) : null
              })
            }
          }
        }
      }
      pNode = pNode.children[0]
      pPly++
    }
    const whitePlayer = { username: whiteName.value || 'White', rating: whiteRating.value || 0, result: resultForColor('white') }
    const blackPlayer = { username: blackName.value || 'Black', rating: blackRating.value || 0, result: resultForColor('black') }
    const insightsPayload = {
      myColor,
      overallAccuracy,
      phaseAccuracy,
      moveCounts: myCounts,
      totalMoves: myMoveCount,
      opening: openingName,
      blunderSquares,
      goodSquares,
      pieceStats,
      playstyle,
      moveBuckets
    }
    const gamesRef = collection(db, `users/${currentUserId.value}/games`)
    const dupQ = query(gamesRef, where('pgnHash', '==', pgnHash))
    const dupSnap = await getDocs(dupQ)
    if (!dupSnap.empty) {
      const gameDoc = dupSnap.docs[0]
      const gameDocData = gameDoc.data()
      const existingPuzzles = gameDocData.puzzles || []
      const mergedPuzzles = extractedPuzzles.map(newP => {
        const oldP = existingPuzzles.find(p => p.fen === newP.fen && p.bestMove === newP.bestMove)
        return oldP ? {
          ...newP,
          solved: oldP.solved || false,
          solvedAt: oldP.solvedAt ?? null,
          reps: oldP.reps ?? 0,
          dueAt: oldP.dueAt ?? null
        } : newP
      })
      await updateDoc(doc(db, `users/${currentUserId.value}/games`, gameDoc.id), {
        insights: insightsPayload,
        puzzles: mergedPuzzles,
        white: whitePlayer,
        black: blackPlayer
      })
    } else {
      await addDoc(gamesRef, {
        pgn,
        pgnHash,
        white: whitePlayer,
        black: blackPlayer,
        time_class: 'unknown',
        createdAt: serverTimestamp(),
        insights: insightsPayload,
        puzzles: extractedPuzzles
      })
    }
  }

  async function fetchOpeningNameForSave(uciList) {
    const OPENING_LOOKUP_PLIES = 12
    const playList = uciList.slice(0, OPENING_LOOKUP_PLIES)
    const bookList = playList.join(",")
    const url = bookList
      ? `../../api/explorer?db=masters&play=${encodeURIComponent(bookList)}`
      : `../../api/explorer?db=masters`
    try {
      const response = await fetch(url)
      if (!response.ok) return "Unknown Opening"
      const data = await response.json()
      return data.opening?.name || "Unknown Opening"
    } catch (e) {
      console.warn("Opening lookup for insights failed:", e)
      return "Unknown Opening"
    }
  }

  // ===== PER-GAME EXTENDED REPORT STATS ====================================
  const moveBucketOrderLocal = ['1-10', '11-20', '21-30', '31-40', '41+']

  function toCpLocal(ev) {
    if (!ev) return null
    if (ev.type === 'mate') return Math.sign(ev.value) * 10000
    return ev.value
  }

  function accColorForWeight(w) {
    if (w === null || w === undefined) return 'rgba(244,240,227,0.4)'
    if (w >= 95) return accuracyColors.great
    if (w >= 85) return accuracyColors.best
    if (w >= 75) return accuracyColors.excellent
    if (w >= 65) return accuracyColors.good
    if (w >= 45) return accuracyColors.inaccuracy
    if (w >= 20) return accuracyColors.mistake
    return accuracyColors.blunder
  }

  function fmtAcc(v) {
    return v === null || v === undefined ? '—' : v.toFixed(1) + '%'
  }

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

  const pieceMetaLocal = [
    { key: 'p', label: 'Pawn', symbol: '♟' },
    { key: 'n', label: 'Knight', symbol: '♞' },
    { key: 'b', label: 'Bishop', symbol: '♝' },
    { key: 'r', label: 'Rook', symbol: '♜' },
    { key: 'q', label: 'Queen', symbol: '♛' },
    { key: 'k', label: 'King', symbol: '♚' }
  ]

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
</script>

<template>
  <SettingsPanel
    v-model:isOpen="isSettingsOpen"
    v-model:targetDepth="targetDepth"
    v-model:soundOn="soundOn"
    v-model:showBestArrow="showBestArrow"
    v-model:boardTheme="currentTheme"
    @depthChanged="onDepthChange"
  />

  <Transition name="loading-fade">
    <div v-if="isImporting" class="analysis-loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner">
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
        </div>
        <p class="loading-title">Analyzing Game</p>
        <p class="loading-subtitle">
          Move {{ importProgress.current }} / {{ importProgress.total }} · Depth
          {{ targetDepth }}
        </p>
        <div class="loading-progress-bar">
          <div
            class="loading-progress-fill"
            :style="{ width: importProgressPercent + '%' }"
          ></div>
        </div>
        <div class="loading-tips">
          <p class="loading-tip">
            Review stuck? A quick page refresh usually fixes it.
          </p>
          <p class="loading-tip">
            Feels slow? Try lowering the engine depth in Settings.
          </p>
        </div>
        <button class="cancel-import-btn" @click="cancelImport">
          Cancel review
        </button>
      </div>
    </div>
  </Transition>

  <div class="grid-layout">
    <Title class="title-slot" />

    <div class="board-area">
      <div
        class="board-wrapper"
        ref="boardRef"
        :style="{ '--last-move-highlight': lastMoveHighlightColor}"
        @pointerup="handleBoardClick"
      >
        <!-- TOP player bar -->
        <div class="player-bar" v-if="hasPlayerInfo">
          <span class="player-color-dot" :class="topPlayer.side"></span>
          <span class="player-name">{{ topPlayer.name }}</span>
          <span v-if="topPlayer.isWinner" class="winner-crown">👑</span>
          <span
            class="player-rating"
            v-if="topPlayer.rating"
            >{{ topPlayer.rating }}</span
          >
          <span
            class="captured-pieces"
            v-if="(topPlayer.side === 'white' ? capturedByWhite : capturedByBlack).length"
          >
            <span
              v-for="(p, i) in (topPlayer.side === 'white' ? capturedByWhite : capturedByBlack)"
              :key="'tc-' + i"
              class="captured-piece"
              >{{ PIECE_UNICODE[p] }}</span
            >
            <span
              class="material-badge"
              v-if="topPlayer.side === 'white' ? materialDiff > 0 : materialDiff < 0"
              >+{{ Math.abs(materialDiff) }}</span
            >
          </span>
        </div>

        <div class="board-row">
          <div class="board-col">
            <TheChessboard
              class="game-board"
              @move="handleBothMoves"
              @board-created="onBoardCreated"
              :board-config="{ coordinates: true, animation: { enabled: true, duration: 100 } }"
            />
            <img
              v-if="lastMoveSquare && lastMoveAccuracy"
              :src="accuracySymbol(lastMoveAccuracy)"
              class="board-acc-icon"
              :style="squareStyle(lastMoveSquare)"
            />
          </div>
          <div
            class="evalbar"
            :class="{ flipped: isFlipped }"
            :style="{ '--eval': height + '%' }"
          >
            <div class="evalbar-inner">
              <div class="blackeval"></div>
              <div class="whiteeval"></div>
            </div>
            <p class="evalnum">{{ formatEval(moveData?.eval) }}</p>
          </div>
        </div>

        <!-- BOTTOM player bar -->
        <div class="player-bar bottom" v-if="hasPlayerInfo">
          <span class="player-color-dot" :class="bottomPlayer.side"></span>
          <span class="player-name">{{ bottomPlayer.name }}</span>
          <span v-if="bottomPlayer.isWinner" class="winner-crown">👑</span>
          <span
            class="player-rating"
            v-if="bottomPlayer.rating"
            >{{ bottomPlayer.rating }}</span
          >
          <span
            class="captured-pieces"
            v-if="(bottomPlayer.side === 'white' ? capturedByWhite : capturedByBlack).length"
          >
            <span
              v-for="(p, i) in (bottomPlayer.side === 'white' ? capturedByWhite : capturedByBlack)"
              :key="'bc-' + i"
              class="captured-piece"
              >{{ PIECE_UNICODE[p] }}</span
            >
            <span
              class="material-badge"
              v-if="bottomPlayer.side === 'white' ? materialDiff > 0 : materialDiff < 0"
              >+{{ Math.abs(materialDiff) }}</span
            >
          </span>
        </div>

        <!-- BOARD TOOLS -->
        <div class="boardtools">
          <div class="boardtools-left">
            <button
              v-if="!inBestVariation"
              class="bt-btn bt-ghost"
              @click="playBestInstead"
              :disabled="isImporting || !canPlayBest"
              title="Play the best move instead"
              aria-label="Play the best move instead"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
              </svg>
            </button>
            <button
              v-else
              class="bt-btn bt-ghost"
              @click="removeBestVariation"
              title="Delete this line and go back"
              aria-label="Delete this line and go back"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
              </svg>
            </button>
          </div>

          <div class="boardtools-nav">
            <button
              class="bt-btn"
              @click="goToStart"
              :disabled="isImporting || currentNode.parent === null"
              title="Jump to start (Home)"
              aria-label="Jump to start"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
            </button>
            <button
              class="bt-btn"
              @click="undoAccuracy"
              :disabled="isImporting || currentNode.parent === null"
              title="Previous (←)"
              aria-label="Previous move"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              class="bt-btn bt-accent"
              @click="flipBoard"
              title="Flip board (F)"
              aria-label="Flip board"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 4v13" />
                <path d="M3.5 13.5 7 17l3.5-3.5" />
                <path d="M17 20V7" />
                <path d="M13.5 10.5 17 7l3.5 3.5" />
              </svg>
            </button>
            <button
              class="bt-btn"
              @click="redoAccuracy"
              :disabled="isImporting || currentNode.children.length === 0"
              title="Next (→)"
              aria-label="Next move"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <button
              class="bt-btn"
              @click="goToEnd"
              :disabled="isImporting || currentNode.children.length === 0"
              title="Jump to end (End)"
              aria-label="Jump to end"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 17l5-5-5-5M13 17l5-5-5-5" />
              </svg>
            </button>
          </div>

          <div class="share-menu-wrap">
            <button
              class="bt-btn bt-ghost"
              @click="toggleShareMenu"
              title="Copy game"
              aria-label="Copy game"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="11" height="11" rx="2.5" />
                <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16" />
              </svg>
            </button>
            <div v-if="shareMenuOpen" class="share-menu">
              <button @click="copyPGN(); shareMenuOpen = false">
                Copy PGN
              </button>
              <button @click="copyFEN(); shareMenuOpen = false">
                Copy FEN
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="analysis-container">
      <div class="analyze" :class="{ 'engine-active': isEngineEnabled }">
        <div class="analyzis-header">
          <div class="analysis-title-row">
            <button
              type="button"
              class="control-icon-btn settings-toggle desktop-settings"
              @click="isSettingsOpen = true"
              title="Settings"
              aria-label="Settings"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
              >
                <path
                  d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"
                />
              </svg>
            </button>
            <h2 class="analyzis">
              Analysis
              <span
                v-if="isAnalyzing"
                class="thinking-dot"
                title="Engine is thinking"
              ></span>
            </h2>
          </div>
          <div class="engine-controls">
            <button
              type="button"
              class="control-icon-btn settings-toggle mobile-settings"
              @click="isSettingsOpen = true"
              title="Settings"
              aria-label="Settings"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
              >
                <path
                  d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"
                />
              </svg>
            </button>
            <div
              class="pv-switcher"
              role="group"
              aria-label="Number of analysis lines"
              title="Number of analysis lines"
            >
              <button
                v-for="n in [1, 2, 3]"
                :key="n"
                type="button"
                :class="{ active: analysisMultiPV === n }"
                @click="analysisMultiPV = n"
              >
                {{ n }}
              </button>
            </div>
            <div class="depth-chip" title="Current engine depth">
              <span class="depth-label">Depth</span>
              <span class="depth-value">{{ currentDepth }}</span>
            </div>
            <label class="engine-toggle" :class="{ active: isEngineEnabled }">
              <input type="checkbox" v-model="isEngineEnabled" />
              <span class="toggle-slider"></span>
              <span class="toggle-label">{{ isEngineEnabled ? 'ON' : 'OFF' }}</span>
            </label>
          </div>
        </div>
        <div v-if="moveData" class="move-data">
          <div class="line pretty-scroll" :class="{ analyzing: isAnalyzing }">
            <span class="evalnum2">{{ formatEval(moveData?.eval) }}</span>
            <span
              v-for="(t, idx) in numberedLine(sanLine)"
              :key="'best-' + idx"
              class="line-move"
              @click="playLineMoves(moveData.best_line, idx + 1)"
            >
              <span v-if="t.prefix" class="line-num">{{ t.prefix }}</span>{{ prettyMove(t.san) }}&nbsp;
            </span>
          </div>
          <div
            class="secondline pretty-scroll"
            v-if="excellentSanLine.length && isEngineEnabled"
          >
            <span class="evalnum3">{{ moveData?.excellent_eval ? formatEval(moveData.excellent_eval) : " " }}</span>
            <span
              v-for="(t, idx) in numberedLine(excellentSanLine)"
              :key="'exc-' + idx"
              class="line-move"
              @click="playLineMoves(moveData.excellent_line, idx + 1)"
            >
              <span v-if="t.prefix" class="line-num">{{ t.prefix }}</span>{{ prettyMove(t.san) }}&nbsp;
            </span>
          </div>
          <div
            class="secondline pretty-scroll"
            v-if="thirdSanLine.length && isEngineEnabled"
          >
            <span class="evalnum3">{{ moveData?.third_eval ? formatEval(moveData.third_eval) : " " }}</span>
            <span
              v-for="(t, idx) in numberedLine(thirdSanLine)"
              :key="'third-' + idx"
              class="line-move"
              @click="playLineMoves(moveData.third_line, idx + 1)"
            >
              <span v-if="t.prefix" class="line-num">{{ t.prefix }}</span>{{ prettyMove(t.san) }}&nbsp;
            </span>
          </div>
          <p :style="{ color: color }" class="accuracydescribtion">
            {{ isAccuracy }}
          </p>
          <p class="bestmove" v-if="movesListUCI.length > 0" @click="playMove">
            {{ displayBest() }}
          </p>
        </div>
      </div>

      <div class="moves" ref="movesScrollRef">
        <div class="tabs-toggle">
          <button
            :class="{ active: activeTab === 'moves' }"
            @click="activeTab = 'moves'"
          >
            Moves
          </button>
          <button
            :class="{ active: activeTab === 'report' }"
            @click="activeTab = 'report'"
          >
            Report
          </button>
          <button
            :class="{ active: activeTab === 'explorer' }"
            @click="activeTab = 'explorer'"
          >
            Explorer
          </button>
        </div>

        <div class="moveslist" v-if="activeTab === 'moves'" ref="movesListRef">
          <template v-for="row in renderedMoves" :key="row.key">
            <div
              class="move-row"
              :class="{ variant: row.depth > 0 }"
              :style="{ '--indent': `${row.depth * 1.05}rem` }"
            >
              <div
                v-for="(cell, index) in row.cells"
                :key="cell ? cell.key : `${row.key}-empty-${index}`"
                class="move-cell"
                :class="[{ active: cell && cell.node === currentNode, variant: cell && cell.variant }, { empty: !cell }]"
                @click="cell && handleCellClick(cell.node.id)"
                @dblclick="cell && openNoteEditor(cell.node.id)"
                @contextmenu.prevent="cell && openContextMenu($event, cell.node.id)"
                @touchstart="cell && handleTouchStart($event, cell.node.id)"
                @touchend="cancelLongPress"
                @touchmove="cancelLongPress"
              >
                <template v-if="cell">
                  <span v-if="cell.showNum" class="move-num"
                    >{{ cell.displayNum }}{{ cell.isWhite ? '.' : '...' }}</span
                  >
                  <span class="move-san-text">{{ prettyMove(cell.node.san) }}</span>
                  <span
                    v-if="cell.node.note"
                    class="note-indicator"
                    title="Has note"
                    >📝</span
                  >
                  <img
                    v-if="cell.node.accuracy"
                    :src="accuracySymbol(cell.node.accuracy)"
                    class="acc-badge"
                    :class="cell.node.accuracy"
                  />
                </template>
              </div>
            </div>
          </template>
        </div>

        <!-- ============ REPORT (teleported to body when maximized) ============ -->
        <Teleport
          to="body"
          :disabled="!isReportMaximized"
          v-else-if="activeTab === 'report'"
        >
          <div class="report" :class="{ maximized: isReportMaximized }">
            <div class="report-header">
              <h3 class="report-title">Game Report</h3>
              <div class="report-header-actions">
                <button
                  v-if="isReportMaximized"
                  class="start-review-btn"
                  @click="startReview"
                  title="Close report and browse moves"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                  Start Review
                </button>
                <button
                  class="report-expand-btn"
                  @click="toggleReportMaximize"
                  :title="isReportMaximized ? 'Minimize report (Esc)' : 'Maximize report'"
                >
                  <svg
                    v-if="!isReportMaximized"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Score boxes -->
            <div class="score-row">
              <div v-for="side in ['white', 'black']" :key="side" class="score-box" :class="side">
                <span class="score-num">
                  {{ gameReportStats[side].accuracy !== null ? gameReportStats[side].accuracy.toFixed(1) + '%' : '—' }}
                </span>
                <span class="score-rating">{{ estimatedRatings[side] ?? '—' }}</span>
              </div>
            </div>

            <!-- Move table -->
            <div class="cls-table">
              <div class="cls-head">
                <span></span>
                <span class="cls-name">{{ whiteName }}</span>
                <span></span>
                <span class="cls-name">{{ blackName }}</span>
              </div>

              <div v-for="key in classificationOrder" :key="key" class="cls-line">
                <span class="cls-label" :style="{ color: classificationMeta[key].color }">
                  {{ classificationMeta[key].label }}
                </span>
                <span
                  class="cls-num"
                  :class="{ dim: gameReportStats.white.counts[key] === 0 }"
                  :style="{ color: classificationMeta[key].color }"
                  @click="jumpToClassification('white', key)"
                >{{ gameReportStats.white.counts[key] }}</span>
                <img :src="accuracySymbol(key)" class="cls-icon" />
                <span
                  class="cls-num"
                  :class="{ dim: gameReportStats.black.counts[key] === 0 }"
                  :style="{ color: classificationMeta[key].color }"
                  @click="jumpToClassification('black', key)"
                >{{ gameReportStats.black.counts[key] }}</span>
              </div>
            </div>

            <!-- Eval graph -->
            <div class="eval-graph-card" v-if="evalGraphGeom">
              <div
                class="eval-graph-area"
                @click="evalGraphClick"
                @mousemove="evalGraphHover"
                @mouseleave="graphHoverIdx = -1"
              >
                <svg class="eval-graph-svg" viewBox="0 0 1000 300" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="egWhiteGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#fbf8ef" />
                      <stop offset="1" stop-color="#ddd8c8" />
                    </linearGradient>
                    <linearGradient id="egBlackGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#1c1b18" />
                      <stop offset="1" stop-color="#3f3d37" />
                    </linearGradient>
                  </defs>
                  <path :d="evalGraphGeom.blackArea" fill="url(#egBlackGrad)" />
                  <path :d="evalGraphGeom.whiteArea" fill="url(#egWhiteGrad)" />
                  <line x1="0" y1="75" x2="1000" y2="75" class="eg-grid" />
                  <line x1="0" y1="225" x2="1000" y2="225" class="eg-grid" />
                  <line x1="0" y1="150" x2="1000" y2="150" class="eg-center" />
                  <path :d="evalGraphGeom.line" class="eg-line" fill="none" />
                </svg>
                <div
                  v-if="evalGraphGeom.currentIdx >= 0"
                  class="eg-current"
                  :style="{ left: evalGraphGeom.coords[evalGraphGeom.currentIdx].xPct + '%' }"
                ></div>
                <template v-if="graphHoverData">
                  <div class="eg-hover-line" :style="{ left: graphHoverData.pt.xPct + '%' }"></div>
                  <div
                    class="eg-hover-dot"
                    :class="graphHoverData.pt.accuracy || 'plain'"
                    :style="{ left: graphHoverData.pt.xPct + '%', top: graphHoverData.pt.yPct + '%' }"
                  ></div>
                  <div
                    class="eg-tooltip"
                    :class="{ below: graphHoverData.below }"
                    :style="{ left: graphHoverData.leftPct + '%' }"
                  >
                    <span class="eg-tooltip-move">{{ graphHoverData.label }}{{ graphHoverData.san ? ' ' + graphHoverData.san : '' }}</span>
                    <span class="eg-tooltip-eval">{{ graphHoverData.evalText }}</span>
                    <span
                      v-if="graphHoverData.accLabel"
                      class="eg-tooltip-acc"
                      :style="{ color: graphHoverData.accColor }"
                      >{{ graphHoverData.accLabel }}</span
                    >
                  </div>
                </template>
                <span
                  v-for="pt in evalGraphGeom.coords.filter(c => ['brilliant','great','inaccuracy','mistake','blunder'].includes(c.accuracy))"
                  :key="'eg-' + pt.ply"
                  class="eg-dot"
                  :class="[pt.accuracy, { current: pt.nodeId === currentNode.id }]"
                  :style="{ left: pt.xPct + '%', top: pt.yPct + '%' }"
                  @click.stop="jumpToNode(pt.nodeId)"
                ></span>
              </div>
            </div>

            <!-- ===== MAXIMIZED-ONLY CARDS ===== -->
            <template v-if="isReportMaximized">
              <div class="report-max-grid">

                <!-- Accuracy by Phase -->
                <div class="report-card" v-if="gameExtendedStats">
                  <div class="rc-head">
                    <h4 class="rc-title">Accuracy by Phase</h4>
                    <div class="rc-legend">
                      <span class="rc-legend-item"><span class="side-swatch white-swatch"></span>{{ whiteName }}</span>
                      <span class="rc-legend-item"><span class="side-swatch black-swatch"></span>{{ blackName }}</span>
                    </div>
                  </div>
                  <div class="phase-list">
                    <div v-for="phase in ['opening', 'middlegame', 'endgame']" :key="phase" class="phase-item">
                      <span class="phase-name">{{ phase }}</span>
                      <div class="phase-line">
                        <span class="side-swatch white-swatch"></span>
                        <div class="phase-bar">
                          <div :style="{ width: (gameExtendedStats.white.phases[phase] || 0) + '%', background: accColorForWeight(gameExtendedStats.white.phases[phase]) }"></div>
                        </div>
                        <span class="phase-val" :style="{ color: accColorForWeight(gameExtendedStats.white.phases[phase]) }">{{ fmtAcc(gameExtendedStats.white.phases[phase]) }}</span>
                      </div>
                      <div class="phase-line">
                        <span class="side-swatch black-swatch"></span>
                        <div class="phase-bar">
                          <div :style="{ width: (gameExtendedStats.black.phases[phase] || 0) + '%', background: accColorForWeight(gameExtendedStats.black.phases[phase]) }"></div>
                        </div>
                        <span class="phase-val" :style="{ color: accColorForWeight(gameExtendedStats.black.phases[phase]) }">{{ fmtAcc(gameExtendedStats.black.phases[phase]) }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Game Stats -->
                <div class="report-card" v-if="gameExtendedStats">
                  <div class="rc-head">
                    <h4 class="rc-title">Game Stats</h4>
                  </div>
                  <div class="stat-table">
                    <div class="stat-row stat-head">
                      <span class="stat-name"><span class="side-swatch white-swatch"></span>{{ whiteName }}</span>
                      <span></span>
                      <span class="stat-name right">{{ blackName }}<span class="side-swatch black-swatch"></span></span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-val">{{ gameExtendedStats.white.checks }}</span>
                      <span class="stat-label">Checks</span>
                      <span class="stat-val right">{{ gameExtendedStats.black.checks }}</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-val">{{ gameExtendedStats.white.captures }}</span>
                      <span class="stat-label">Captures</span>
                      <span class="stat-val right">{{ gameExtendedStats.black.captures }}</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-val">{{ gameExtendedStats.white.cpLost }}</span>
                      <span class="stat-label">Pawns lost</span>
                      <span class="stat-val right">{{ gameExtendedStats.black.cpLost }}</span>
                    </div>
                    <div class="stat-row">
                      <span class="stat-val">{{ gameExtendedStats.white.swingsGained }}</span>
                      <span class="stat-label">Swings gained</span>
                      <span class="stat-val right">{{ gameExtendedStats.black.swingsGained }}</span>
                    </div>
                  </div>
                </div>

                <!-- Accuracy by Piece -->
                <div class="report-card" v-if="gamePieceStats.some(p => p.white.count || p.black.count)">
                  <div class="rc-head">
                    <h4 class="rc-title">Accuracy by Piece</h4>
                  </div>
                  <div class="stat-table">
                    <div class="stat-row stat-head">
                      <span class="stat-name"><span class="side-swatch white-swatch"></span>{{ whiteName }}</span>
                      <span></span>
                      <span class="stat-name right">{{ blackName }}<span class="side-swatch black-swatch"></span></span>
                    </div>
                    <div v-for="p in gamePieceStats" :key="p.key" class="stat-row">
                      <span class="stat-val" :style="{ color: accColorForWeight(p.white.acc) }">{{ fmtAcc(p.white.acc) }}</span>
                      <span class="stat-label">
                        <span class="piece-sym">{{ p.symbol }}</span>{{ p.label }}
                        <span class="piece-counts">{{ p.white.count }}/{{ p.black.count }}</span>
                      </span>
                      <span class="stat-val right" :style="{ color: accColorForWeight(p.black.acc) }">{{ fmtAcc(p.black.acc) }}</span>
                    </div>
                  </div>
                </div>

                <!-- Key Moments -->
                <div class="report-card" v-if="keyMoments.length">
                  <div class="rc-head">
                    <h4 class="rc-title">Key Moments</h4>
                    <span class="rc-sub">Tap to jump</span>
                  </div>
                  <div class="moments-list">
                    <button v-for="m in keyMoments" :key="'km-' + m.nodeId" class="moment-row" @click="jumpToMoment(m)">
                      <span class="moment-side" :class="m.side"></span>
                      <span class="moment-san">{{ Math.ceil(m.ply / 2) }}{{ m.ply % 2 === 1 ? '.' : '...' }} {{ m.san }}</span>
                      <img v-if="accuracySymbol(m.accuracy)" :src="accuracySymbol(m.accuracy)" class="moment-icon" />
                      <span class="moment-swing">{{ (m.swing / 100).toFixed(1) }}</span>
                    </button>
                  </div>
                </div>

              </div>
            </template>
          </div>
        </Teleport>

        <div class="explorer" v-else-if="activeTab === 'explorer'">
          <div class="explorer-db-toggle">
            <button :class="{ active: explorerDb === 'masters' }" @click="explorerDb = 'masters'">Masters</button>
            <button :class="{ active: explorerDb === 'lichess' }" @click="explorerDb = 'lichess'">Players</button>
          </div>
          <div v-if="explorerLoading" class="explorer-status">
            <div class="mini-spinner"></div>
            Loading {{ explorerDb === 'masters' ? 'master' : 'player' }} games…
          </div>
          <div v-else-if="explorerError" class="explorer-status error">{{ explorerError }}</div>
          <template v-else>
            <div class="explorer-header">
              <span class="explorer-eco" v-if="openingEco">{{ openingEco }}</span>
              <span class="explorer-name">{{ opening }}</span>
            </div>
            <div class="explorer-table" v-if="explorerMoves.length">
              <div class="explorer-row explorer-row-head">
                <span class="col-move">Move</span>
                <span class="col-games">Games</span>
                <span class="col-split">W / D / B</span>
              </div>
              <div v-for="m in explorerMoves" :key="m.uci" class="explorer-row" @click="playExplorerMove(m.uci)">
                <span class="col-move">{{ prettyMove(m.san) }}</span>
                <span class="col-games">
                  <span class="games-percent">{{ m.percent }}%</span>
                  <span class="games-count">{{ formatCount(m.total) }}</span>
                </span>
                <span class="col-split">
                  <div class="split-bar">
                    <div class="split-white" :style="{ width: m.white + '%' }">
                      <span v-if="m.white >= 15" class="split-pct">{{ m.white }}%</span>
                    </div>
                    <div class="split-draw" :style="{ width: m.draws + '%' }">
                      <span v-if="m.draws >= 15" class="split-pct">{{ m.draws }}%</span>
                    </div>
                    <div class="split-black" :style="{ width: m.black + '%' }">
                      <span v-if="m.black >= 15" class="split-pct">{{ m.black }}%</span>
                    </div>
                  </div>
                </span>
              </div>
              <div class="explorer-row explorer-row-total" v-if="explorerStats">
                <span class="col-move">Σ</span>
                <span class="col-games">
                  <span class="games-percent">100%</span>
                  <span class="games-count">{{ formatCount(explorerStats.total) }}</span>
                </span>
                <span class="col-split">
                  <div class="split-bar">
                    <div class="split-white" :style="{ width: explorerStats.white + '%' }">
                      <span v-if="explorerStats.white >= 15" class="split-pct">{{ explorerStats.white }}%</span>
                    </div>
                    <div class="split-draw" :style="{ width: explorerStats.draws + '%' }">
                      <span v-if="explorerStats.draws >= 15" class="split-pct">{{ explorerStats.draws }}%</span>
                    </div>
                    <div class="split-black" :style="{ width: explorerStats.black + '%' }">
                      <span v-if="explorerStats.black >= 15" class="split-pct">{{ explorerStats.black }}%</span>
                    </div>
                  </div>
                </span>
              </div>
            </div>
            <div class="explorer-status" v-else>No games found for this position</div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- Note editor popover -->
  <Teleport to="body">
    <div
      v-if="editingNoteNodeId !== null"
      class="note-overlay"
      @click.self="cancelNote"
    >
      <div class="note-editor">
        <h3 class="note-editor-title">
          📝 Move Note
          <span class="note-editor-move">{{ nodeMap[editingNoteNodeId]?.san }}</span>
        </h3>
        <textarea
          v-model="noteDraft"
          class="note-textarea"
          rows="3"
          placeholder="e.g. Missed the tactic here, should have played Bxh7+ first…"
          @keydown.ctrl.enter="saveNote"
          @keydown.meta.enter="saveNote"
          autofocus
        ></textarea>
        <div class="note-actions">
          <button class="note-btn cancel" @click="cancelNote">Cancel</button>
          <button class="note-btn save" @click="saveNote">Save</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Shortcuts help -->
  <Teleport to="body">
    <Transition name="toast-fade">
      <div
        v-if="showShortcuts"
        class="shortcuts-overlay"
        @click.self="showShortcuts = false"
      >
        <div class="shortcuts-panel">
          <div class="shortcuts-header">
            <h3>⌨️ Keyboard Shortcuts</h3>
            <button class="shortcuts-close" @click="showShortcuts = false">✕</button>
          </div>
          <div class="shortcuts-list">
            <div v-for="s in shortcuts" :key="s.keys" class="shortcut-row">
              <kbd>{{ s.keys }}</kbd>
              <span>{{ s.desc }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
    >
      <button class="context-menu-item delete" @click="handleDeleteFromMenu">
        Delete move
      </button>
    </div>
  </Teleport>

  <Transition name="toast-fade">
    <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
  </Transition>
</template>

<style scoped>
  @import url("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&display=swap");

  .grid-layout {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    padding: clamp(0.5rem, 3vw, 1rem);
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas:
      "title"
      "board"
      "analysis";
    gap: 1.5rem;
    max-width: 1600px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  @media (min-width: 768px) {
    .grid-layout {
      grid-template-columns: auto 1fr;
      grid-template-areas:
        "title board"
        "title analysis";
      gap: 1rem;
    }
  }

  @media (min-width: 1200px) {
    .grid-layout {
      grid-template-columns: auto 2fr 1fr;
      grid-template-areas: "title board analysis";
      gap: 2rem;
    }
  }

  .title-slot {
    grid-area: title;
    min-width: 0;
  }

  .board-area {
    grid-area: board;
    display: flex;
    justify-content: center;
    width: 100%;
    min-width: 0;
  }

  .board-wrapper {
    position: relative;
    width: 100%;
    max-width: min(95vw, 38rem);
    min-width: 0;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  .board-col {
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .game-board {
    width: 100% !important;
    height: auto !important;
    aspect-ratio: 1 / 1 !important;
    display: block;
  }

  :deep(.cg-wrap) {
    overflow: hidden;
    width: 100% !important;
    height: 100% !important;
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
    border-radius: 8px;
  }

  :deep(cg-board) {
    background: conic-gradient(
      var(--board-dark) 90deg,
      var(--board-light) 90deg 180deg,
      var(--board-dark) 180deg 270deg,
      var(--board-light) 270deg
    ) !important;
    background-size: 25% 25% !important;
  }

  :deep(cg-board square.last-move) {
    background-color: var(--last-move-highlight, rgba(155, 199, 0, 0.41)) !important;
  }

  /* Kill the blue tap-flash on the board and on every button */
  button,
  :deep(.cg-wrap),
  :deep(.cg-wrap *) {
    -webkit-tap-highlight-color: transparent;
  }

  :deep(.cg-wrap),
  :deep(cg-container),
  :deep(cg-board),
  :deep(piece) {
    touch-action: none !important;
  }

  .board-row {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
  }

  .evalbar {
    width: clamp(24px, 4vw, 40px);
    flex-shrink: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .evalbar-inner {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.5);
  }

  .blackeval,
  .whiteeval {
    width: 100%;
    transition: width 0.5s ease, height 0.5s ease;
    position: relative;
  }

  .blackeval { background-color: #38412e; height: var(--eval, 50%); }
  .whiteeval { background-color: #626949; height: calc(100% - var(--eval, 50%)); }

  .evalbar.flipped .evalbar-inner { flex-direction: column-reverse; }

  .player-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.7rem;
    margin-bottom: 0.2rem;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.22);
    color: #f4f0e3;
    font-family: "Inter", sans-serif;
    font-size: clamp(0.82rem, 1.8vw, 0.95rem);
    width: 100%;
    box-sizing: border-box;
  }

  .player-bar.bottom { margin-bottom: 0; margin-top: 0.2rem; }

  .player-color-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
  }

  .player-color-dot.white { background: #f4f0e3; }
  .player-color-dot.black { background: #1a1a1a; }

  .player-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .winner-crown {
    font-size: 1.1rem;
    filter: drop-shadow(0 0 4px gold);
  }

  .player-rating {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.8em;
    color: rgba(244, 240, 227, 0.75);
    margin-left: auto;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 6px;
    padding: 0.05rem 0.4rem;
    flex-shrink: 0;
  }

  .player-rating + .captured-pieces { margin-left: 0.5rem; }

  .captured-pieces {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    margin-left: auto;
    padding-left: 0.25rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .captured-piece {
    font-size: 0.85rem;
    line-height: 1;
    opacity: 0.85;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4));
  }

  .material-badge {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.62rem;
    font-weight: 700;
    color: #a8d97a;
    background: rgba(106, 209, 63, 0.15);
    border-radius: 4px;
    padding: 0.05rem 0.3rem;
    margin-left: 0.25rem;
  }

  .analysis-container {
    grid-area: analysis;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    min-height: 0;
    height: 100%;
    max-height: 95vh;
  }

  .analyze {
    border-radius: 15px;
    width: 100%;
    max-width: 500px;
    padding-bottom: 1rem;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    box-sizing: border-box;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.08);
    margin: 0 auto;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.4) rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
    flex: 0 0 auto;
    max-height: 42vh;
    overscroll-behavior: contain;
  }

  .analyze.engine-active {
    border: 1px solid rgba(106, 209, 63, 0.3);
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      0 0 15px rgba(106, 209, 63, 0.15);
  }

  @media (min-width: 1200px) {
    .analyze { max-width: 20rem; }
  }

  .analyzis-header {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
    padding: 0.9rem 1rem 0.75rem;
    width: 100%;
    box-sizing: border-box;
  }

  .analysis-title-row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 2.2rem;
  }

  .analyzis {
    font-family: serif;
    color: #f5f5dc;
    font-weight: 700;
    text-transform: uppercase;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
    letter-spacing: 2px;
    font-size: clamp(1.05rem, 2.5vw, 1.35rem);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.5rem;
    margin: 0;
  }

  .thinking-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #6ad13f;
    box-shadow: 0 0 8px rgba(106, 209, 63, 0.9);
    animation: thinkingPulse 1s ease-in-out infinite;
  }

  @keyframes thinkingPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1.15); }
  }

  .control-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.16);
    color: rgba(244, 240, 227, 0.86);
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
  }

  .control-icon-btn:hover { background: rgba(255, 255, 255, 0.09); color: #f4f0e3; }
  .control-icon-btn svg { display: block; }

  .desktop-settings { position: absolute; left: 0; top: 50%; transform: translateY(-50%); }
  .desktop-settings:hover { transform: translateY(-50%); }
  .mobile-settings { display: none; }

  .engine-controls {
    margin-left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    width: 100%;
  }

  .pv-switcher {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    height: 1.8rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
    box-sizing: border-box;
  }

  .pv-switcher button {
    min-width: 1.65rem;
    height: 100%;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: rgba(245, 245, 220, 0.62);
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0 0.45rem;
  }

  .pv-switcher button:hover { color: #f5f5dc; background: rgba(255, 255, 255, 0.06); }

  .pv-switcher button.active {
    background: linear-gradient(145deg, rgba(168, 217, 122, 0.24), rgba(106, 209, 63, 0.18));
    color: #a8d97a;
    box-shadow: 0 0 0 1px rgba(168, 217, 122, 0.28), 0 3px 8px rgba(0, 0, 0, 0.25);
  }

  .depth-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.8rem;
    padding: 0 0.65rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
    color: rgba(244, 240, 227, 0.75);
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    box-sizing: border-box;
  }

  .depth-value {
    font-family: "JetBrains Mono", monospace;
    color: #f4f0e3;
    font-size: 0.74rem;
    letter-spacing: 0;
  }

  .engine-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    user-select: none;
  }

  .engine-toggle input { display: none; }

  .toggle-slider {
    width: 32px;
    height: 18px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 999px;
    position: relative;
    transition: background 0.3s ease;
    border: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
  }

  .toggle-slider::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: #888;
    border-radius: 50%;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .engine-toggle.active .toggle-slider {
    background: rgba(106, 209, 63, 0.25);
    border-color: rgba(106, 209, 63, 0.5);
  }

  .engine-toggle.active .toggle-slider::after {
    left: 18px;
    background: #6ad13f;
    box-shadow: 0 0 8px rgba(106, 209, 63, 0.8);
  }

  .toggle-label {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: rgba(245, 245, 220, 0.6);
    transition: color 0.3s ease;
  }

  .engine-toggle.active .toggle-label {
    color: #6ad13f;
    text-shadow: 0 0 6px rgba(106, 209, 63, 0.6);
  }

  .analysis-loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 10, 6, 0.25);
    backdrop-filter: blur(4px) saturate(105%);
  }

  .loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    padding: 2rem 2.5rem;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 18px;
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.5);
    max-width: min(90vw, 22rem);
  }

  .loading-spinner { position: relative; width: 64px; height: 64px; }
  .spinner-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid transparent;
    border-top-color: var(--text-highlight);
    animation: spinRing 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
  }
  .spinner-ring:nth-child(2) { inset: 8px; border-top-color: #a8d97a; animation-duration: 1.6s; animation-direction: reverse; }
  .spinner-ring:nth-child(3) { inset: 16px; border-top-color: #f4f0e3; animation-duration: 2s; }

  @keyframes spinRing { to { transform: rotate(360deg); } }

  .loading-title {
    font-family: serif;
    color: #f5f5dc;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-size: 1.05rem;
    margin: 0;
    text-align: center;
  }

  .loading-subtitle {
    font-family: "JetBrains Mono", monospace;
    color: rgba(244, 240, 227, 0.8);
    font-size: 0.82rem;
    margin: 0;
    text-align: center;
  }

  .loading-progress-bar {
    width: 180px;
    height: 5px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    overflow: hidden;
    margin-top: 0.2rem;
  }

  .loading-progress-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--text-highlight), #a8d97a);
    transition: width 0.3s ease;
  }

  .loading-tips {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.3rem;
    padding-top: 0.8rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    width: 100%;
  }

  .loading-tip {
    font-size: 0.78rem;
    color: rgba(244, 240, 227, 0.65);
    text-align: center;
    margin: 0;
    line-height: 1.4;
  }

  .cancel-import-btn {
    margin-top: 0.5rem;
    padding: 0.55rem 1.3rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 107, 107, 0.35);
    background: rgba(255, 60, 60, 0.12);
    color: #ffb0a8;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .loading-fade-enter-active, .loading-fade-leave-active { transition: opacity 0.35s ease; }
  .loading-fade-enter-from, .loading-fade-leave-to { opacity: 0; }

  /* ===== MOVES PANEL ======================================================= */
  .moves {
    margin-top: 0;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    border-radius: 16px;
    width: 100%;
    max-width: 500px;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    overflow-y: auto;
    overflow-x: hidden;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.08);
    margin: 0 auto;
    min-height: 340px;
    flex: 1 1 auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(194, 197, 170, 0.4) rgba(0, 0, 0, 0.2);
    overscroll-behavior: contain;
  }

  @media (min-width: 1200px) {
    .moves { max-width: 20rem; }
  }

  .tabs-toggle {
    position: sticky;
    top: 0;
    z-index: 30;
    display: flex;
    gap: 4px;
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    padding: 10px 10px 9px;
    margin: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.28);
  }

  .tabs-toggle button {
    flex: 1;
    background: transparent;
    border: none;
    color: rgba(245, 245, 220, 0.6);
    padding: 0.55rem 0.4rem;
    border-radius: 7px;
    cursor: pointer;
    font-weight: 700;
    font-family: serif;
    font-size: clamp(0.7rem, 2vw, 0.95rem);
    text-transform: uppercase;
    letter-spacing: 1px;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.2s ease;
    touch-action: manipulation;
  }

  .tabs-toggle button:hover:not(.active) {
    color: rgba(245, 245, 220, 0.85);
    background: rgba(255, 255, 255, 0.04);
  }

  .tabs-toggle button.active {
    background: rgba(0, 0, 0, 0.28);
    color: #f4f0e3;
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .moveslist {
    margin: 8px auto 0;
    padding: 8px;
    width: 100%;
    box-sizing: border-box;
    background: linear-gradient(135deg, var(--list-1), var(--list-2));
    border-radius: 12px;
    font-size: clamp(0.85rem, 2vw, 0.95rem);
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    gap: 3px;
    overscroll-behavior: contain;
  }

  .move-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    align-items: stretch;
    margin-left: var(--indent, 0rem);
    padding-left: 0.15rem;
    position: relative;
  }

  .move-row.variant {
    border-left: 2px solid rgba(232, 232, 208, 0.14);
    padding-left: 6px;
    margin-top: 2px;
  }

  .move-cell {
    min-height: 1.9rem;
    min-width: 0;
    padding: 0.22rem 0.55rem;
    border-radius: 8px;
    cursor: pointer;
    color: #e9e5d6;
    font-weight: 500;
    transition: background 0.13s ease, border-color 0.13s ease, color 0.13s ease, box-shadow 0.13s ease, transform 0.1s ease;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
    box-sizing: border-box;
    overflow: hidden;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .move-cell:nth-child(2) {
    background: rgba(0, 0, 0, 0.14);
    border-color: rgba(255, 255, 255, 0.05);
  }

  .move-cell:hover { background: rgba(255, 255, 255, 0.09); border-color: rgba(255, 255, 255, 0.18); }
  .move-cell:active { transform: scale(0.97); }

  .move-cell.active {
    background: linear-gradient(145deg, rgba(103, 122, 228, 0.4), rgba(103, 122, 228, 0.22));
    border-color: rgba(150, 166, 255, 0.55);
    box-shadow: 0 0 0 1px rgba(150, 166, 255, 0.15), 0 2px 10px rgba(0, 0, 0, 0.3);
    color: #fff;
  }

  .move-cell.variant {
    color: #c3cdf5;
    border-style: dashed;
    border-color: rgba(195, 205, 245, 0.25);
    background: rgba(103, 122, 228, 0.06);
  }

  .move-cell.variant.active {
    background: linear-gradient(145deg, rgba(103, 122, 228, 0.32), rgba(103, 122, 228, 0.18));
  }

  .move-cell.empty {
    pointer-events: none;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  .move-num {
    color: rgba(232, 232, 208, 0.42);
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72em;
    font-weight: 600;
    min-width: 2.1em;
    flex-shrink: 0;
    background: none;
    padding: 0;
  }

  .move-san-text {
    font-weight: 600;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.2px;
  }

  .acc-badge { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; }
  .note-indicator { font-size: 0.62rem; opacity: 0.7; cursor: help; flex-shrink: 0; }

  /* ===== BOARD TOOLS ======================================================= */
  .boardtools {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    margin: 0.5rem 0 0;
    padding: 0.45rem 0.6rem;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 16px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .boardtools-nav {
    grid-column: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.2rem;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 14px;
  }

  .boardtools-left { grid-column: 1; justify-self: start; }
  .share-menu-wrap { grid-column: 3; justify-self: end; position: relative; }

  .bt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 11px;
    background: transparent;
    color: rgba(244, 240, 227, 0.8);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
    flex-shrink: 0;
    width: 2.75rem;
    height: 2.75rem;
    touch-action: manipulation;
  }

  .bt-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #fff; }
  .bt-btn:active:not(:disabled) { transform: scale(0.92); }
  .bt-btn:disabled { opacity: 0.28; cursor: not-allowed; }
  .bt-btn svg { display: block; }

  .bt-ghost {
    width: 2.25rem;
    height: 2.25rem;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(244, 240, 227, 0.65);
  }

  .bt-accent {
    background: linear-gradient(145deg, rgba(168, 217, 122, 0.22), rgba(106, 209, 63, 0.14));
    color: #a8d97a;
    box-shadow: inset 0 0 0 1px rgba(168, 217, 122, 0.25);
  }

  .bt-accent:hover:not(:disabled) {
    background: linear-gradient(145deg, rgba(168, 217, 122, 0.32), rgba(106, 209, 63, 0.2));
    color: #c4ee9c;
  }

  .share-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    left: auto;
    background: #26241f;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    min-width: 8rem;
    overflow: hidden;
    z-index: 50;
  }

  .share-menu button {
    background: transparent;
    border: none;
    color: #f4f0e3;
    padding: 0.55rem 0.8rem;
    text-align: left;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .share-menu button:hover { background: rgba(255, 255, 255, 0.08); }
  .share-menu button + button { border-top: 1px solid rgba(255, 255, 255, 0.08); }

  .evalnum {
    font-family: "JetBrains Mono", monospace;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: clamp(0.62rem, 1vw, 0.85rem);
    font-weight: 600;
    color: #fff8ef;
    text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.6);
    background: rgba(0, 0, 0, 0.3);
    padding: 0.25rem 0.4rem;
    border-radius: 6px;
    backdrop-filter: blur(4px);
    z-index: 10;
    white-space: nowrap;
    width: max-content;
  }

  .accuracydescribtion {
    font-weight: 500;
    text-align: center;
    font-size: clamp(1rem, 2.1vw, 1.2rem);
    margin-top: 1rem;
    padding: 0 1rem;
    word-wrap: break-word;
  }

  .bestmove {
    color: #41a24e;
    text-align: center;
    font-weight: 600;
    margin-top: 0.1rem;
    font-size: clamp(0.9rem, 1rem, 1.1rem);
    padding: 0 1rem;
    cursor: pointer;
    text-decoration: underline;
  }

  .move-data { padding: 0 1rem; }

  .line, .secondline {
    font-family: "JetBrains Mono", monospace;
    display: flex;
    white-space: nowrap;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    padding: 0.35rem 0.6rem;
    margin: 4px 0;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 8px;
    color: #eae4d8;
    box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4);
    overflow-x: auto;
  }

  .pretty-scroll { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.2) rgba(0, 0, 0, 0.15); }
  .pretty-scroll::-webkit-scrollbar { height: 5px; }
  .pretty-scroll::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.15); border-radius: 10px; }
  .pretty-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 10px; }
  .pretty-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.35); }

  .evalnum2, .evalnum3 {
    font-size: 0.9rem;
    color: #171717;
    background-color: #606847;
    border-radius: 6px;
    flex-shrink: 0;
    min-width: 3.8rem;
    width: auto;
    padding: 0 0.4rem;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .board-acc-icon {
    position: absolute;
    width: 5.5%;
    height: 5.5%;
    border-radius: 50%;
    pointer-events: none;
  }

  .line-move { cursor: pointer; padding: 0 2px; border-radius: 4px; }
  .line-num { color: rgba(234, 228, 216, 0.5); margin-right: 1px; }
  .line-move:hover { background: rgba(103, 122, 228, 0.3); }

  .toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 20, 20, 0.92);
    color: #f4f0e3;
    padding: 0.6rem 1.2rem;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 1000;
  }

  .toast-fade-enter-active, .toast-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
  .toast-fade-enter-from, .toast-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

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

  /* ===== REPORT =========================================================== */
  .report {
    padding: 1rem;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .side-swatch {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    display: inline-block;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
    flex-shrink: 0;
  }

  .white-swatch { background: #f4f0e3; }
  .black-swatch { background: #1a1a1a; }

  /* Score boxes */
  .score-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-radius: 12px;
    overflow: hidden;
  }

  .score-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.7rem 0.5rem;
  }

  .score-box.white { background: #f4f0e3; color: #1a1a1a; }
  .score-box.black { background: #141414; color: #f4f0e3; }

  .score-num {
    font-size: clamp(1.3rem, 5vw, 1.7rem);
    font-weight: 600;
    line-height: 1.1;
  }

  .score-rating {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.68rem;
    font-weight: 900;
    opacity: 1;
  }

  /* Move table */
  .cls-table {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.8rem 0.9rem;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
  }

  .cls-head,
  .cls-line {
    display: grid;
    grid-template-columns: 1.4fr 1fr 2rem 1fr;
    align-items: center;
    gap: 0.3rem;
  }

  .cls-head { padding-bottom: 0.3rem; }

  .cls-name {
    text-align: center;
    font-size: 0.78rem;
    font-weight: 600;
    color: rgba(244, 240, 227, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cls-line { padding: 0.3rem 0; }

  .cls-label {
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cls-num {
    text-align: center;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    border-radius: 6px;
    transition: background 0.15s ease;
  }

  .cls-num:hover { background: rgba(103, 122, 228, 0.18); }
  .cls-num.dim { opacity: 0.4; cursor: default; }
  .cls-num.dim:hover { background: none; }

  .cls-icon {
    width: 22px;
    height: 22px;
    justify-self: center;
  }

  /* ===== REPORT HEADER / MAXIMIZE / START REVIEW ========================== */
  .report-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .report-title {
    font-family: serif;
    color: #f5f5dc;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    font-size: 0.9rem;
    margin: 0;
  }

  .report-header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .start-review-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border: 1px solid rgba(106, 209, 63, 0.45);
    border-radius: 10px;
    background: linear-gradient(145deg, rgba(106, 209, 63, 0.22), rgba(106, 209, 63, 0.1));
    color: #a8d97a;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .start-review-btn:hover {
    background: linear-gradient(145deg, rgba(106, 209, 63, 0.32), rgba(106, 209, 63, 0.16));
    box-shadow: 0 4px 14px rgba(106, 209, 63, 0.3);
    transform: translateY(-1px);
  }

  .start-review-btn:active { transform: translateY(0); }

  .start-review-btn svg { flex-shrink: 0; }

  .report-expand-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(244, 240, 227, 0.8);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .report-expand-btn:hover { background: rgba(255, 255, 255, 0.1); color: #f4f0e3; }

  .report.maximized {
    position: fixed;
    inset: 0;
    z-index: 2600;
    max-height: none;
    height: 100dvh;
    overflow-y: auto;
    border-radius: 0;
    border: none;
    margin: 0;
    padding: 1.25rem clamp(1rem, 4vw, 3rem) 2.5rem;
    background: rgba(20, 17, 13, 0.82);
    backdrop-filter: blur(14px) saturate(140%);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
    box-shadow: none;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    animation: reportZoom 0.25s ease;
  }

  @keyframes reportZoom {
    from { opacity: 0; transform: scale(0.985); }
    to { opacity: 1; transform: scale(1); }
  }

  .report.maximized .report-header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(180deg, rgba(20, 17, 13, 0.95) 75%, transparent);
    backdrop-filter: blur(8px);
    padding: 0.35rem 0 0.5rem;
  }

  .report.maximized .report-title { font-size: 1.15rem; }

  .report.maximized .score-row,
  .report.maximized .cls-table {
    max-width: 560px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .report.maximized .eval-graph-card { max-width: 960px; width: 100%; margin: 0 auto; }
  .report.maximized .eval-graph-area { height: 220px; }

  .report.maximized > * {
    flex-shrink: 0;
  }

  .report-max-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1rem;
    max-width: 1100px;
    width: 100%;
    margin: 0 auto;
  }

  /* ===== REPORT CARDS ===================================================== */
  .report-card {
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 18px;
    padding: 1.1rem 1.2rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .rc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .rc-title {
    margin: 0;
    font-family: "Inter", sans-serif;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(245, 245, 220, 0.9);
  }

  .rc-sub { font-size: 0.7rem; color: rgba(244, 240, 227, 0.4); }

  .rc-legend { display: flex; align-items: center; gap: 0.8rem; }
  .rc-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.7rem;
    color: rgba(244, 240, 227, 0.6);
    max-width: 7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Phase */
  .phase-list { display: flex; flex-direction: column; gap: 1rem; }
  .phase-item { display: flex; flex-direction: column; gap: 0.4rem; }
  .phase-name {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: capitalize;
    color: rgba(244, 240, 227, 0.55);
  }
  .phase-line {
    display: grid;
    grid-template-columns: 0.65rem 1fr 3.6rem;
    align-items: center;
    gap: 0.6rem;
  }
  .phase-bar {
    height: 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }
  .phase-bar > div {
    height: 100%;
    border-radius: 999px;
    transition: width 0.4s ease;
  }
  .phase-val {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.78rem;
    font-weight: 700;
    text-align: right;
  }

  /* Stats + piece tables */
  .stat-table { display: flex; flex-direction: column; gap: 0.3rem; }
  .stat-row {
    display: grid;
    grid-template-columns: 4rem 1fr 4rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.035);
  }
  .stat-row.stat-head {
    background: transparent;
    padding-top: 0;
    padding-bottom: 0.2rem;
    grid-template-columns: 1fr 0.2rem 1fr;
  }
  .stat-name {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: rgba(244, 240, 227, 0.6);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stat-name.right { justify-content: flex-end; }
  .stat-val {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.82rem;
    font-weight: 700;
    color: #f4f0e3;
  }
  .stat-val.right { text-align: right; }
  .stat-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: rgba(244, 240, 227, 0.55);
    white-space: nowrap;
  }
  .piece-sym { font-size: 1rem; line-height: 1; }
  .piece-counts {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.6rem;
    color: rgba(244, 240, 227, 0.35);
  }

  /* Key moments */
  .moments-list { display: flex; flex-direction: column; gap: 0.35rem; }

  .moment-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.65rem;
    background: rgba(255, 255, 255, 0.035);
    border: none;
    border-radius: 10px;
    color: #f4f0e3;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .moment-row:hover { background: rgba(103, 122, 228, 0.2); }

  .moment-side { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .moment-side.white { background: #f4f0e3; }
  .moment-side.black { background: #1a1a1a; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35); }

  .moment-san {
    font-weight: 700;
    font-size: 0.85rem;
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .moment-icon { width: 18px; height: 18px; flex-shrink: 0; }

  .moment-swing {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.7rem;
    color: rgba(244, 240, 227, 0.55);
    flex-shrink: 0;
  }

  /* ===== EVAL GRAPH ======================================================= */
  .eval-graph-card { display: flex; flex-direction: column; gap: 0.45rem; }

  .eval-graph-area {
    position: relative;
    height: 110px;
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: #f0ede6;
    transition: box-shadow 0.3s ease;
  }

  .eval-graph-area:hover {
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(168, 217, 122, 0.3);
  }

  .eval-graph-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

  .eg-line {
    stroke: #a8d97a;
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .eg-grid {
    stroke: rgba(128, 126, 118, 0.3);
    stroke-width: 1;
    stroke-dasharray: 4 6;
    vector-effect: non-scaling-stroke;
  }

  .eg-center {
    stroke: rgba(120, 118, 110, 0.55);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .eg-current {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: rgba(255, 255, 255, 0.55);
    transform: translateX(-1px);
    pointer-events: none;
    mix-blend-mode: difference;
  }

  .eg-hover-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.5);
    transform: translateX(-0.5px);
    pointer-events: none;
    mix-blend-mode: difference;
    z-index: 4;
  }

  .eg-hover-dot {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid #fff;
    background: #8b8a80;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 6;
  }

  .eg-tooltip {
    position: absolute;
    top: 6px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(17, 17, 15, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    padding: 0.28rem 0.6rem;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72rem;
    color: #f4f0e3;
    white-space: nowrap;
    pointer-events: none;
    z-index: 20;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  }

  .eg-tooltip.below { top: auto; bottom: 6px; }
  .eg-tooltip-move { color: rgba(244, 240, 227, 0.75); }
  .eg-tooltip-eval { font-weight: 700; }
  .eg-tooltip-acc { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }

  .eg-dot {
    position: absolute;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9), 0 1px 4px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    z-index: 2;
    transition: box-shadow 0.15s ease;
  }

  .eg-dot:hover { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85); z-index: 3; }
  .eg-dot.current { box-shadow: 0 0 0 2px #fff, 0 0 8px rgba(255, 255, 255, 0.8); z-index: 5; }

  .eg-dot.brilliant, .eg-hover-dot.brilliant { background: #03aea7; }
  .eg-dot.great, .eg-hover-dot.great { background: #4c8cb5; }
  .eg-dot.best, .eg-hover-dot.best { background: #6ad13f; }
  .eg-dot.excellent, .eg-hover-dot.excellent { background: #90bc36; }
  .eg-dot.good, .eg-hover-dot.good { background: #8eae83; }
  .eg-dot.book, .eg-hover-dot.book { background: #ad8760; }
  .eg-dot.inaccuracy, .eg-hover-dot.inaccuracy { background: #f2bc43; }
  .eg-dot.mistake, .eg-hover-dot.mistake { background: #f38800; }
  .eg-dot.blunder, .eg-hover-dot.blunder { background: #ff0000; }

  /* ===== NOTE EDITOR ====================================================== */
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

  /* ===== SHORTCUTS PANEL =================================================== */
  .shortcuts-overlay {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(3px);
  }

  .shortcuts-panel {
    background: linear-gradient(145deg, var(--panel-1, #262421), var(--panel-2, #1e1c18));
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    padding: 1.3rem 1.5rem;
    width: min(90vw, 22rem);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
  }

  .shortcuts-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .shortcuts-header h3 { font-family: serif; color: #f5f5dc; font-size: 1.05rem; font-weight: 700; margin: 0; }

  .shortcuts-close {
    background: none;
    border: none;
    color: rgba(244, 240, 227, 0.6);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0.2rem;
    line-height: 1;
  }

  .shortcuts-close:hover { color: #f4f0e3; }
  .shortcuts-list { display: flex; flex-direction: column; gap: 0.55rem; }
  .shortcut-row { display: flex; align-items: center; gap: 0.8rem; }

  .shortcut-row kbd {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-highlight, #d9b382);
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 0.25rem 0.55rem;
    min-width: 4.5rem;
    text-align: center;
    white-space: nowrap;
  }

  .shortcut-row span { color: rgba(244, 240, 227, 0.8); font-size: 0.85rem; }

  /* ===== EXPLORER ========================================================== */
  .explorer {
    padding: 0.6rem 0.5rem 0.6rem;
    box-sizing: border-box;
    max-height: 400px;
  }

  .explorer-status {
    text-align: center;
    color: rgba(245, 245, 220, 0.7);
    font-size: 0.9rem;
    padding: 2rem 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .explorer-status.error { color: #ffb0a8; }

  .mini-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--text-highlight);
    border-radius: 50%;
    animation: spinRing 1s linear infinite;
  }

  .explorer-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.25rem 0.3rem 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    margin-bottom: 0.4rem;
    flex-wrap: wrap;
  }

  .explorer-eco {
    font-family: "JetBrains Mono", monospace;
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--text-highlight);
    background: rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 0.1rem 0.4rem;
    flex-shrink: 0;
  }

  .explorer-name {
    font-family: serif;
    font-weight: 700;
    color: #f5f5dc;
    font-size: clamp(0.95rem, 2.2vw, 1.15rem);
    white-space: normal;
    word-break: break-word;
  }

  .explorer-table { display: flex; flex-direction: column; gap: 0.25rem; }

  .explorer-row {
    display: grid;
    grid-template-columns: 2.3rem 1fr 1.6fr;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.5rem;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.15);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .explorer-row:not(.explorer-row-head):not(.explorer-row-total):hover {
    background: rgba(103, 122, 228, 0.25);
    transform: translateX(3px);
  }

  .explorer-row-head {
    background: transparent;
    cursor: default;
    color: rgba(245, 245, 220, 0.55);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
    padding-bottom: 0.1rem;
  }

  .explorer-row-total {
    cursor: default;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.08);
    margin-top: 0.4rem;
    font-weight: 700;
  }

  .col-move {
    font-weight: 700;
    color: var(--text-highlight);
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-games { display: flex; flex-direction: column; line-height: 1.1; align-items: flex-start; }

  .games-percent { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 0.8rem; color: #f4f0e3; }
  .games-count { font-family: "JetBrains Mono", monospace; font-size: 0.62rem; color: rgba(244, 240, 227, 0.45); }
  .col-split { min-width: 0; }

  .split-bar {
    display: flex;
    width: 100%;
    height: 1.1rem;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4);
  }

  .split-white, .split-draw, .split-black {
    height: 100%;
    transition: width 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.62rem;
    font-weight: 700;
    overflow: hidden;
    white-space: nowrap;
  }

  .split-white { background: #e8e4d8; color: #333; }
  .split-draw { background: #8a8a86; color: #f4f0e3; }
  .split-black { background: #2b2b2b; color: #f4f0e3; }

  .explorer-db-toggle {
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.25);
    padding: 4px;
    border-radius: 10px;
    margin: 0 0.5rem 0.8rem;
  }

  .explorer-db-toggle button {
    flex: 1;
    background: transparent;
    border: none;
    color: rgba(245, 245, 220, 0.6);
    padding: 0.45rem;
    border-radius: 7px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: all 0.2s ease;
  }

  .explorer-db-toggle button.active {
    background: linear-gradient(145deg, var(--panel-1), var(--panel-2));
    color: #f4f0e3;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  /* ===== MOBILE: STICKY TITLE + MINIMAL SCROLL ============================= */
  @media (max-width: 767px) {
    .acc-badge { width: 19px; height: 19px; }
    .board-acc-icon { width: 5.8%; height: 5.8%; }

    .grid-layout {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      padding: 0;
      gap: 0;
    }

    .report:not(.maximized) .report-header {
      top: 2.4rem;
      margin: -0.4rem -0.6rem 0.4rem;
      padding: 0.4rem 0.6rem;
    }

    .board-area,
    .board-wrapper,
    .analysis-container {
      display: contents;
    }

    .title-slot {
      order: 0;
      position: sticky;
      top: 0;
      z-index: 50;
      background: linear-gradient(180deg, var(--panel-1, #262421), rgba(38, 36, 33, 0.96) 80%, transparent);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      padding: 0.35rem 0.6rem;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    }

    .player-bar { order: 1; padding: 0.22rem 0.55rem; margin: 0; font-size: 0.78rem; }

    /* Board + thin eval bar: same row, no gap, bar is exactly the board's height */
    .board-row {
      order: 1;
      flex-direction: row;
      gap: 0;
      align-items: stretch;
    }

    .evalbar {
      order: -1;
      width: 16px;
      height: auto;
      flex-shrink: 0;
    }

   .evalbar-inner {
    flex: 1;
    border-radius: 6px 0 0 6px;
  }


    .evalnum { display: none; }

    :deep(.cg-wrap) { border-radius: 0 6px 6px 0; }

    .moves { order: 2; }

    .analyze { order: 0; }

    .boardtools { order: 4; }

    .board-wrapper { max-width: 100%; }

    .captured-pieces { padding-left: 0.3rem; }
    .captured-piece { font-size: 0.72rem; }
    .material-badge { font-size: 0.55rem; }

    .analyze {
      background: none;
      box-shadow: none;
      border: none;
      padding: 0;
      margin: 0;
      max-width: none;
      min-height: 0;
      max-height: none;
      overscroll-behavior: auto;
    }

    .move-data { padding: 0; }

    .analyzis-header {
      display: flex !important;
      flex-direction: column;
      justify-content: center;
      padding: 0.45rem 0.35rem;
      margin: 0;
      gap: 0.35rem;
    }

    .analyzis { display: none !important; }
    .analysis-title-row { min-height: 0; display: none !important; }

    .desktop-settings { display: none; }

    .mobile-settings {
      display: inline-flex;
      width: 1.9rem;
      height: 1.9rem;
      border-radius: 9px;
    }

    .engine-controls {
      margin-left: 0;
      gap: 0.35rem;
      justify-content: center;
    }

    .pv-switcher, .depth-chip { height: 1.9rem; }
    .pv-switcher button { height: 100%; min-width: 1.8rem; font-size: 0.72rem; padding: 0 0.45rem; }
    .depth-chip { padding: 0 0.6rem; font-size: 0.62rem; }
    .depth-value { font-size: 0.76rem; }
    .engine-toggle .toggle-label { font-size: 0.68rem; }

    .accuracydescribtion, .bestmove { display: none; }

    .line, .secondline {
      font-size: 0.74rem;
      padding: 0.32rem 0.45rem;
      margin: 3px 0;
      gap: 0.35rem;
    }

    .evalnum2, .evalnum3 {
      font-size: 0.78rem;
      min-width: 2.8rem;
      padding: 0 0.4rem;
    }

    .line.analyzing { animation: linePulse 1.2s ease-in-out infinite; }

    @keyframes linePulse {
      0%, 100% { box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4); }
      50% { box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(106, 209, 63, 0.55); }
    }

    .moves {
      flex: 0 1 auto;
      min-height: 300px;
      max-height: 300px;
      height: auto;
      max-width: none;
      margin: 0;
      overscroll-behavior: auto;
    }

    .tabs-toggle { padding: 7px; }

    .moveslist {
      padding: 5px;
      gap: 3px;
      margin-top: 5px;
      overscroll-behavior: auto;
    }

    .move-cell {
      min-height: 2rem;
      padding: 0.28rem 0.55rem;
      font-size: 0.85rem;
    }

    .report-header {
      position: sticky;
    }

    .report { padding: 0.6rem; }

    .report.maximized { padding: 1rem 0.75rem 2rem; }
    .report.maximized .eval-graph-area { height: 160px; }

    .eval-graph-area { height: 90px; }

    .eg-tooltip { font-size: 0.64rem; padding: 0.22rem 0.5rem; gap: 0.4rem; }

    .cls-table { padding: 0.6rem 0.6rem; }
    .cls-label { font-size: 0.82rem; }
    .cls-line { padding: 0.22rem 0; }

    .start-review-btn {
      padding: 0.42rem 0.75rem;
      font-size: 0.72rem;
      gap: 0.3rem;
    }

    .explorer {
      padding: 0.4rem 0.5rem 0.6rem;
      min-height: 220px;
    }

    .explorer-header { padding: 0.25rem 0.3rem 0.5rem; margin-bottom: 0.4rem; }
    .explorer-table { gap: 0.25rem; }

    .explorer-row {
      grid-template-columns: 2.3rem 1fr 1.6fr;
      gap: 0.4rem;
      padding: 0.35rem 0.5rem;
      border-radius: 8px;
    }

    .explorer-row-head { font-size: 0.62rem; padding-bottom: 0.1rem; }
    .col-move { font-size: 0.88rem; }
    .games-percent { font-size: 0.8rem; }
    .games-count { font-size: 0.62rem; }
    .split-bar { height: 1.1rem; border-radius: 6px; }

    .explorer-db-toggle { margin: 0 0.4rem 0.5rem; }
    .explorer-db-toggle button { padding: 0.32rem; font-size: 0.72rem; }

    .boardtools {
      position: sticky;
      bottom: 0;
      z-index: 40;
      min-height: 2.6rem;
      padding: 0.3rem 0.5rem calc(0.3rem + env(safe-area-inset-bottom, 0px));
      margin-top: 0;
      gap: 0.4rem;
      flex-wrap: nowrap;
    }

    .boardtools {
      grid-template-columns: auto 1fr auto;
      gap: 0.5rem;
    }

    .boardtools-nav {
      width: 100%;
      gap: 0.2rem;
    }

    .boardtools-nav .bt-btn {
      flex: 1;
      width: auto;
      height: 2.9rem;
    }

    .bt-ghost {
      width: 2.5rem;
      height: 2.5rem;
    }
  }
</style>