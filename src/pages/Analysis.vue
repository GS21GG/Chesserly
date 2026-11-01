<script setup>
  //imports Vue tools for reactive state, lifecycle hooks and watchers
  import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
  //chess.js handles the rules: legal moves, FEN, PGN
  import { Chess } from 'chess.js'
  //the chessboard component
  import { TheChessboard } from 'vue3-chessboard'
  //firebase login and database
  import { auth, db } from '../firebase'
  import { onAuthStateChanged } from 'firebase/auth'
  import { collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc } from 'firebase/firestore'
  import 'vue3-chessboard/style.css'
  //shared UI pieces
  import Title from "../assets/Title.vue"
  import SettingsPanel from "../assets/SettingsPanel.vue"
  import ShortcutsPanel from '../assets/ShortcutsPanel.vue'
  import NoteEditor from '../assets/NoteEditor.vue'
  import ContextMenu from '../assets/ContextMenu.vue'
  //stockfish engine wrapper
  import { startEngine, getEvaluation, cancelAnalysis } from "../engine/engine.js"
  import { useRoute, useRouter } from 'vue-router'
  //colors, icons and accuracy helpers
  import {
    accuracyColors, classificationOrder, classificationMeta,
    hexToRgba, accColorForWeight, fmtAcc, accuracySymbol
  } from '../assets/accuracy.js'
  //piece data and small chess helpers
  import {
    PIECE_UNICODE, PIECE_MATERIAL, prettyMove, formatCount,
    calculateMaterialBalance, getGamePhases, bucketLabel, generatePgnHash
  } from '../assets/chessUtils.js'
  //composables (logic split into separate files)
  import { useSound } from '../assets/useSound.js'
  import { useEvalGraph } from '../assets/useEvalGraph.js'
  import { useGameReport } from '../assets/useGameReport.js'
  import { useExplorer } from '../assets/useExplorer.js'

  //theme: loads the saved theme and applies it to the page
  const currentTheme = ref(localStorage.getItem('chesslab_theme') || 'midnight')
  watch(currentTheme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chesslab_theme', newTheme)
  }, { immediate: true })

  // ===== MOBILE / DESKTOP SWITCH ============================================
  // Must match the CSS breakpoint (max-width: 767px)
  //watches the screen width
  const mobileQuery = window.matchMedia('(max-width: 767px)')
  //true when the screen is phone-sized
  const isMobile = ref(mobileQuery.matches)
  //updates isMobile when the window is resized
  function onMobileQueryChange(e) { isMobile.value = e.matches }
  //which tab to open first (analysis on phone, moves on desktop)
  const defaultTab = () => (isMobile.value ? 'analysis' : 'moves')

  //set to true once the board and engine are ready
  let boardReady = false
  let engineReady = false

  //runs once when the page opens
  onMounted(async () => {
    //unlocks sound after the first click or key press (browsers block sound before that)
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)
    //loads the move sound files
    loadSounds()
    //keyboard shortcuts
    window.addEventListener('keydown', handleKeyDown)
    //closes the context menu when clicking elsewhere or scrolling
    window.addEventListener('click', closeContextMenu)
    window.addEventListener('scroll', closeContextMenu, true)
    mobileQuery.addEventListener('change', onMobileQueryChange)
    activeTab.value = defaultTab()
    //starts the stockfish engine
    await startEngine()
    engineReady = true
    //loads a position from the URL (FEN, imported game, or the start position)
    if (route.query.fen) {
      await loadFen(route.query.fen)
      await getAccuracy()
    } else if (route.query.moves) {
      await tryLoadImportedGame()
    } else {
      await getAccuracy()
    }
    //updates captured pieces and the eval graph
    recalcCapturedPieces()
    rebuildEvalHistory()
  })

  //listens for login and stores the user id
  onMounted(() => {
    onAuthStateChanged(auth, (user) => { if (user) currentUserId.value = user.uid })
  })

  //runs when the page closes: removes listeners and timers so nothing leaks
  onBeforeUnmount(() => {
    window.removeEventListener('pointerdown', unlockAudio)
    window.removeEventListener('keydown', unlockAudio)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('click', closeContextMenu)
    window.removeEventListener('scroll', closeContextMenu, true)
    mobileQuery.removeEventListener('change', onMobileQueryChange)
    clearTimeout(toastTimeout)
    clearTimeout(longPressTimer)
    clearTimeout(navHoldTimer)
    cancelUiFlush()
    document.body.style.overflow = ''
  })

  //reads the URL (route) and lets the page change it (router)
  const route = useRoute()
  const router = useRouter()
  //is the settings popup open
  const isSettingsOpen = ref(false)
  //is the board shown from black's side
  const isFlipped = computed(() => (rotate.value / 180) % 2 === 1)
  //one main chess game plus extra copies used for checking engine lines
  const chess = new Chess()
  const greedyChess = new Chess()
  const excellentChess = new Chess()
  const bestChess = new Chess()
  const thirdChess = new Chess()
  //key used to save the engine depth in localStorage
  const DEPTH_STORAGE_KEY = 'chesslab_targetDepth'

  //reads the saved engine depth, or uses 10 if none is valid
  function loadStoredDepth() {
    const stored = Number(localStorage.getItem(DEPTH_STORAGE_KEY))
    return stored >= 10 && stored <= 30 ? stored : 10
  }

  //latest engine result for the current position
  const moveData = shallowRef(null)
  //the chessboard component's API
  const boardAPI = shallowRef(null)
  //true while the engine is still thinking
  const isAnalyzing = ref(false)
  //true while a full game is being analyzed on import
  const isImporting = ref(false)
  //progress for the import loading screen
  const importProgress = ref({ current: 0, total: 0 })
  //set to true when the user cancels an import
  let importCancelled = false
  //depth the engine has reached so far
  const currentDepth = ref(10)
  //depth the user chose in settings
  const targetDepth = ref(loadStoredDepth())
  //height of the eval bar in percent
  const height = ref(47.75)
  //centipawn score used for the eval bar
  const cp = ref(0)
  //board rotation in degrees (180 = flipped)
  const rotate = ref(0)
  //text describing the accuracy of the last move
  const isAccuracy = ref(" ")
  //color of that text
  const color = ref(" ")
  //engine's best line, as SAN moves
  const sanLine = ref([])
  //engine's best move in SAN
  const bestMoveSan = ref('')
  //second best engine line
  const excellentSanLine = ref([])
  //changed each time the move tree changes, so computed values refresh
  const treeVersion = ref(0)
  //list of all moves played so far, in UCI format (e.g. e2e4)
  const movesListUCI = ref([])
  //squares of the last move, used to highlight it
  const lastMoveSquare = ref(null)
  const lastMoveFromSquare = ref(null)
  //accuracy of the last move (used for the icon on the board)
  const lastMoveAccuracy = ref(null)
  //references to HTML elements
  const boardRef = ref(null)
  const movesListRef = ref(null)
  const movesScrollRef = ref(null)
  const stripRef = ref(null)
  //third engine line
  const thirdSanLine = ref([])
  //best move arrow data
  const bestArrowSquares = ref(null)
  //short message at the bottom of the screen
  const toastMessage = ref('')
  //which panel tab is open
  const activeTab = ref(isMobile.value ? 'analysis' : 'moves')
  //position and target of the right-click / long-press menu
  const contextMenu = ref({ visible: false, x: 0, y: 0, nodeId: null })
  //is the small copy menu open
  const shareMenuOpen = ref(false)
  //turn and move number used to label engine lines
  const lineStart = ref({ turn: 'w', num: 1 })

  //adds move numbers to a list of SAN moves (like 12. e4 e5)
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

  // ===== SOUND (see assets/useSound.js) =====================================
  //sound on/off, loading, and playing move sounds
  const { soundOn, loadSounds, unlockAudio, playSound, soundForLastMove } = useSound()

  // --- Engine Toggle & MultiPV State ---
  //is the engine turned on
  const isEngineEnabled = ref(true)
  //key for saving the best arrow setting
  const BEST_ARROW_STORAGE_KEY = 'chesslab_showBestArrow'

  //reads the saved best arrow setting (on by default)
  function loadStoredBestArrowSetting() {
    const stored = localStorage.getItem(BEST_ARROW_STORAGE_KEY)
    if (stored === null) return true
    return stored === 'true'
  }
  //is the green best move arrow shown
  const showBestArrow = ref(loadStoredBestArrowSetting())

  // ===== BEST MOVE ARROW ====================================================
  // Drawn as our own SVG overlay (see template), completely separate from
  // chessground's shapes. That way it is always visible and never touches
  // (or clears) the arrows the user draws with right-click.
  //moves that are not good enough to show the arrow for
  const NOT_BEST = ['good', 'excellent', 'inaccuracy', 'mistake', 'blunder']
  //fixes castling notation the engine uses (e1h1 becomes e1g1)
  const CASTLE_FIX = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' }

  //calculates the start, end and arrowhead points of the best move arrow
  const bestArrow = computed(() => {
    //no arrow if the setting is off
    if (!showBestArrow.value) return null
    moveData.value // re-run whenever analysis updates
    const node = currentNode.value
    const data = node.analysisData
    //no arrow if the move was already good
    if (!node.san || !data?.best_move || !NOT_BEST.includes(data.move_accuracy)) return null
    const uci = CASTLE_FIX[data.best_move] ?? data.best_move
    if (uci.length < 4) return null
    const flipped = isFlipped.value
    //turns a square name (like e4) into board coordinates
    const center = (sq) => {
      const file = sq.charCodeAt(0) - 97
      const rank = parseInt(sq[1]) - 1
      return {
        x: (flipped ? 7 - file : file) + 0.5,
        y: (flipped ? rank : 7 - rank) + 0.5
      }
    }
    const from = center(uci.slice(0, 2))
    const to = center(uci.slice(2, 4))
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy)
    if (!len) return null
    //direction of the arrow
    const ux = dx / len
    const uy = dy / len
    //size of the arrowhead and gap at the start
    const headLen = 0.5
    const headHalf = 0.3
    const startGap = 0.18
    const bx = to.x - ux * headLen
    const by = to.y - uy * headLen
    //sideways direction, used to make the arrowhead width
    const px = -uy
    const py = ux
    return {
      x1: from.x + ux * startGap,
      y1: from.y + uy * startGap,
      x2: bx,
      y2: by,
      head: [
        `${to.x},${to.y}`,
        `${bx + px * headHalf},${by + py * headHalf}`,
        `${bx - px * headHalf},${by - py * headHalf}`
      ].join(' ')
    }
  })

  //saves the best arrow setting when it changes
  watch(showBestArrow, (enabled) => {
    localStorage.setItem(BEST_ARROW_STORAGE_KEY, String(enabled))
  })

  // ===== TABS ================================================================
  // Desktop: Moves / Report / Explorer (analysis panel stays above)
  // Mobile : Analysis / Report / Explorer (moves live in the strip)
  //tabs shown on desktop
  const panelTabs = [
    { id: 'moves', label: 'Moves' },
    { id: 'report', label: 'Report' },
    { id: 'explorer', label: 'Explorer' }
  ]
  //tabs shown on phone
  const mobileTabs = [
    { id: 'analysis', label: 'Analysis' },
    { id: 'report', label: 'Report' },
    { id: 'explorer', label: 'Explorer' }
  ]
  //picks the right tab list for the screen size
  const visibleTabs = computed(() => (isMobile.value ? mobileTabs : panelTabs))

  //position of the active tab in the list (used to move the highlight)
  const activeTabIndex = computed(() =>
    visibleTabs.value.findIndex(t => t.id === activeTab.value)
  )

  //switches tabs when the screen changes between phone and desktop
  watch(isMobile, (mobile) => {
    if (mobile && activeTab.value === 'moves') activeTab.value = 'analysis'
    else if (!mobile && activeTab.value === 'analysis') activeTab.value = 'moves'
    if (mobile) nextTick(centerActiveStrip)
  })

  //moves to the next or previous tab (wraps around at the ends)
  function cycleTab(direction) {
    const currentIndex = activeTabIndex.value
    if (currentIndex === -1) return
    const tabs = visibleTabs.value
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length
    activeTab.value = tabs[nextIndex].id
  }

  //where the finger started a swipe
  let tabSwipeStart = null

  //remembers where a touch started
  function onTabSwipeStart(event) {
    //no swiping during import
    if (isImporting.value) {
      tabSwipeStart = null
      return
    }

    // On desktop/tablet the analysis panel is not a tab, so don't hijack swipes there
    if (!isMobile.value && event.target.closest('.analyze')) {
      tabSwipeStart = null
      return
    }

    // Avoid interfering with buttons, scrollable analysis lines, etc.
    if (event.target.closest('button, input, textarea, .pretty-scroll, .move-strip')) {
      tabSwipeStart = null
      return
    }

    const touch = event.touches[0]
    tabSwipeStart = {
      x: touch.clientX,
      y: touch.clientY
    }
  }

  //checks the swipe when the finger lifts and changes tab if it was a clear sideways swipe
  function onTabSwipeEnd(event) {
    if (!tabSwipeStart || isImporting.value) return

    const touch = event.changedTouches[0]
    const dx = touch.clientX - tabSwipeStart.x
    const dy = touch.clientY - tabSwipeStart.y

    tabSwipeStart = null

    //must move far sideways and not much up or down
    const isHorizontalSwipe =
      Math.abs(dx) > 58 &&
      Math.abs(dy) < 42

    if (!isHorizontalSwipe) return

    // Swipe left = next tab, swipe right = previous tab
    cycleTab(dx < 0 ? 1 : -1)
  }

  //reads how many engine lines to show (1 to 3), default 1
  function loadStoredMultiPV() {
    const stored = Number(localStorage.getItem('chesslab_multiPV'))
    if (stored >= 1 && stored <= 3) return stored
    localStorage.setItem('chesslab_multiPV', '1')
    return 1
  }

  //number of engine lines to show
  const analysisMultiPV = ref(loadStoredMultiPV())
  //saves the choice and re-runs the engine
  watch(analysisMultiPV, (val) => {
    localStorage.setItem('chesslab_multiPV', String(val))
    if (isEngineEnabled.value) getAccuracy()
  })

  //re-runs analysis when the engine is turned on or off
  watch(isEngineEnabled, () => {
    if (isImporting.value) return
    getAccuracy()
  })

  //runs the engine on the new move, or turns it on if it was off
  function requestAnalysisForNewMove() {
    if (isImporting.value) return
    if (!isEngineEnabled.value) {
      isEngineEnabled.value = true
    } else {
      getAccuracy()
    }
  }

  //player names, ratings and result (filled from the URL when a game is imported)
  const whiteName = ref('White')
  const blackName = ref('Black')
  const whiteRating = ref(null)
  const blackRating = ref(null)
  const hasPlayerInfo = ref(false)
  const gameResult = ref(null)
  //reads the result (like 1-0) from the PGN in the URL
  if (route.query.pgn) {
    const match = route.query.pgn.match(/\[Result\s+"([^"]+)"\]/)
    if (match) gameResult.value = match[1]
  }

  //color used to highlight the last move on the board
  const lastMoveHighlightColor = computed(() => {
    const c = accuracyColors[lastMoveAccuracy.value]
    return c ? hexToRgba(c, 0.35) : null
  })

  //tells the board which squares to highlight as the last move
  watch([lastMoveFromSquare, lastMoveSquare], ([from, to]) => {
    if (!boardAPI.value) return
    boardAPI.value.setConfig({ lastMove: from && to ? [from, to] : undefined })
  })

  //fills in player names and ratings from the URL
  if (route.query.white || route.query.black) {
    hasPlayerInfo.value = true
    if (route.query.white) whiteName.value = route.query.white
    if (route.query.black) blackName.value = route.query.black
    if (route.query.whiteRating) whiteRating.value = route.query.whiteRating
    if (route.query.blackRating) blackRating.value = route.query.blackRating
  }

  //who won, from the game result
  const isWhiteWinner = computed(() => gameResult.value === '1-0')
  const isBlackWinner = computed(() => gameResult.value === '0-1')

  //player shown at the top of the board (changes when the board is flipped)
  const topPlayer = computed(() => {
    const isWhite = isFlipped.value
    return {
      name: isWhite ? whiteName.value : blackName.value,
      rating: isWhite ? whiteRating.value : blackRating.value,
      side: isWhite ? 'white' : 'black',
      isWinner: isWhite ? isWhiteWinner.value : isBlackWinner.value
    }
  })

  //player shown at the bottom of the board
  const bottomPlayer = computed(() => {
    const isWhite = !isFlipped.value
    return {
      name: isWhite ? whiteName.value : blackName.value,
      rating: isWhite ? whiteRating.value : blackRating.value,
      side: isWhite ? 'white' : 'black',
      isWinner: isWhite ? isWhiteWinner.value : isBlackWinner.value
    }
  })

  // Mobile: both players share one row (white left, black right)
  //data for the two player chips on phone
  const mobilePlayers = computed(() => [
    {
      side: 'white',
      name: whiteName.value,
      rating: whiteRating.value,
      isWinner: isWhiteWinner.value,
      captured: capturedByWhite.value,
      lead: materialDiff.value > 0 ? materialDiff.value : 0
    },
    {
      side: 'black',
      name: blackName.value,
      rating: blackRating.value,
      isWinner: isBlackWinner.value,
      captured: capturedByBlack.value,
      lead: materialDiff.value < 0 ? -materialDiff.value : 0
    }
  ])

  //timers for long press, toast message and button hold
  let longPressTimer = null
  let longPressTriggered = false
  let toastTimeout = null
  //time of the last arrow key press (to stop key repeat being too fast)
  let lastPress = 0

  //the move tree: the root is the start position, each child is a move played from it
  const moveTree = {
    id: 0, san: null, uci: null, fen: chess.fen(),
    accuracy: null, analysisData: null, parent: null, children: []
  }
  //next free id for a new move node
  let nodeIdCounter = 1
  //lets us find any node by its id
  const nodeMap = { 0: moveTree }
  //the node we are currently looking at
  const currentNode = shallowRef(moveTree)

  // ===== COMPOSABLES THAT NEED THE TREE ======================================
  //true when the report is shown full screen
  const isReportMaximized = ref(false)

  //eval graph: builds the graph data from the move tree
  const {
    graphHoverIdx, rebuildEvalHistory, evalGraphGeom, evalGraphClick, evalGraphHover, graphHoverData
  } = useEvalGraph({ moveTree, currentNode, jumpToNode })

  //report stats: accuracy, counts, phases, pieces and key moments
  const {
    gameReportStats, estimatedRatings, gameExtendedStats, keyMoments, gamePieceStats,
    jumpToMoment, jumpToClassification
  } = useGameReport({ moveTree, treeVersion, jumpToNode, isReportMaximized })

  //opening explorer: loads openings from the server
  const {
    opening, openingEco, explorerDb, explorerLoading, explorerError,
    explorerStats, explorerMoves, playExplorerMove
  } = useExplorer({
    currentNode, movesListUCI, activeTab, movesScrollRef, isImporting,
    boardAPI, chess, applyUciMove, soundForLastMove, requestAnalysisForNewMove
  })

  //builds the rows shown in the Moves list (includes variations)
  const renderedMoves = computed(() => {
    treeVersion.value
    const rows = []
    //one move cell with its number
    function makeCell(node, moveNum, showAsStart, depth) {
      const isWhite = moveNum % 2 === 1
      return {
        key: `cell-${node.id}`, node,
        displayNum: Math.ceil(moveNum / 2),
        isWhite, showNum: isWhite || showAsStart, variant: depth > 0
      }
    }
    //walks the tree and adds rows, following the main line and any variations
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

  // ===== MOBILE MOVES STRIP ==================================================
  // Shows the active line: the path to the current move, continued along the
  // main line. If a variation exists at a branch point, a small separator is
  // shown (fork chip on the main line, dashed divider inside the variation).
  //builds the items for the phone move strip
  const stripItems = computed(() => {
    treeVersion.value
    const cur = currentNode.value
    //path from the start to the current move
    const path = []
    for (let n = cur; n.parent; n = n.parent) path.unshift(n)
    //continue along the main line after the current move
    let tail = cur
    while (tail.children.length) {
      tail = tail.children[0]
      path.push(tail)
    }
    if (!path.length) return []

    //works out the move number the game starts on
    const fenParts = (moveTree.fen || '').split(' ')
    const startFull = Number(fenParts[5]) || 1
    const startPly = (startFull - 1) * 2 + (fenParts[1] === 'b' ? 2 : 1)

    const items = []
    let prev = moveTree
    let inVariant = false
    let afterSep = false
    path.forEach((node, i) => {
      //adds a variation marker where the line branches
      if (prev.children.length > 1) {
        const mainChild = prev.children[0]
        const isVariantStep = node !== mainChild
        const alt = isVariantStep ? mainChild : prev.children[1]
        items.push({ kind: 'sep', key: `s-${prev.id}`, altId: alt.id, divider: isVariantStep })
        afterSep = true
      }
      //marks everything after a variation branch as variant
      if (node !== node.parent.children[0]) inVariant = true
      const ply = startPly + i
      const isWhite = ply % 2 === 1
      items.push({
        kind: 'move',
        key: `m-${node.id}`,
        node,
        num: Math.ceil(ply / 2),
        isWhite,
        showNum: isWhite || i === 0 || afterSep,
        variant: inVariant
      })
      afterSep = false
      prev = node
    })
    return items
  })

  //scrolls the move strip so the current move is in the middle
  function centerActiveStrip() {
    const el = stripRef.value
    if (!el) return
    const active = el.querySelector('.strip-cell.active')
    if (!active) {
      el.scrollTo({ left: 0, behavior: 'smooth' })
      return
    }
    const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }

  // Tap = previous/next, hold = jump to start/end
  //timer for holding the prev/next buttons
  let navHoldTimer = null
  let navHoldFired = false
  //starts the hold timer: after 450 ms it jumps to the start or end
  function navDown(kind) {
    navHoldFired = false
    clearTimeout(navHoldTimer)
    navHoldTimer = setTimeout(() => {
      navHoldFired = true
      if (navigator.vibrate) navigator.vibrate(8)
      if (kind === 'prev') goToStart()
      else goToEnd()
    }, 450)
  }
  //cancels the hold timer when the finger lifts
  function navUp() { clearTimeout(navHoldTimer) }
  //a short tap goes one move back or forward (a long hold is ignored here)
  function navClick(kind) {
    if (navHoldFired) { navHoldFired = false; return }
    if (kind === 'prev') undoAccuracy()
    else redoAccuracy()
  }

  // ===== TREE EDITING ========================================================
  //removes a node and all moves after it
  function removeSubtree(node) {
    const parent = node.parent
    if (parent) {
      const idx = parent.children.indexOf(node)
      if (idx !== -1) parent.children.splice(idx, 1)
    }
    const ids = []
    ;(function collect(n) { ids.push(n.id); for (const c of n.children) collect(c) })(node)
    for (const id of ids) delete nodeMap[id]
  }

  //true if the node is inside a variation (not on the main line)
  function isInVariation(node) {
    let n = node
    while (n && n.parent) {
      if (n.parent.children[0] !== n) return true
      n = n.parent
    }
    return false
  }

  // Keep only the main line (drop every non-first child in the whole tree)
  //deletes every variation, keeping only the main line
  function pruneAllVariations() {
    let n = moveTree
    while (n) {
      while (n.children.length > 1) removeSubtree(n.children[n.children.length - 1])
      n = n.children[0] ?? null
    }
  }

  // Single place where a played move becomes the current node.
  // Mobile rule: at most ONE variation exists in the game.
  //  - on the main line: a different move becomes the (only) variation,
  //    replacing any variation that existed before
  //  - inside the variation: a different move overwrites what came after
  //adds a played move to the tree and makes it the current move
  function attachMove(sanMove, uci) {
    const parent = currentNode.value
    //if this move already exists, just go to it
    const existing = parent.children.find(c => c.uci === uci)
    if (existing) {
      currentNode.value = existing
      return existing
    }
    //on phone, only keep one variation at a time
    if (isMobile.value && parent.children.length > 0) {
      if (isInVariation(parent)) {
        for (const child of [...parent.children]) removeSubtree(child)
      } else {
        pruneAllVariations()
      }
      if (bestVariation.value && !nodeMap[bestVariation.value.nodeId]) bestVariation.value = null
    }
    //creates the new move node
    const newNode = {
      id: nodeIdCounter++, san: sanMove.san, uci, fen: chess.fen(),
      accuracy: null, analysisData: null, parent, children: []
    }
    nodeMap[newNode.id] = newNode
    parent.children.push(newNode)
    currentNode.value = newNode
    if (!isImporting.value) treeVersion.value++
    return newNode
  }

  //deletes a move and everything after it
  function deleteMove(nodeId) {
    const node = nodeMap[nodeId]
    //the start position cannot be deleted
    if (!node || node.parent === null) return
    const parent = node.parent
    const idx = parent.children.indexOf(node)
    if (idx !== -1) parent.children.splice(idx, 1)
    //collects the ids of this move and all later moves
    function collectIds(n, ids) { ids.push(n.id); for (const child of n.children) collectIds(child, ids); return ids }
    const idsToRemove = collectIds(node, [])
    const currentWasRemoved = idsToRemove.includes(currentNode.value.id)
    for (const id of idsToRemove) delete nodeMap[id]
    treeVersion.value++
    //if we were on a deleted move, go back to its parent
    if (currentWasRemoved) jumpToNode(parent.id)
  }

  //opens the right-click menu at a position, keeping it on screen
  function showContextMenu(x, y, nodeId) {
    const menuWidth = 160, menuHeight = 44
    contextMenu.value = {
      visible: true,
      x: Math.min(x, window.innerWidth - menuWidth - 8),
      y: Math.min(y, window.innerHeight - menuHeight - 8),
      nodeId
    }
  }
  //closes the context menu and the copy menu
  function closeContextMenu() { contextMenu.value.visible = false; shareMenuOpen.value = false }
  //opens the context menu from a right-click
  function openContextMenu(event, nodeId) { showContextMenu(event.clientX, event.clientY, nodeId) }
  //deletes the move chosen in the context menu
  function handleDeleteFromMenu() {
    if (contextMenu.value.nodeId !== null) deleteMove(contextMenu.value.nodeId)
    closeContextMenu()
  }

  //starts a timer: holding a move for 500 ms opens the menu (phone)
  function handleTouchStart(event, nodeId) {
    longPressTriggered = false
    longPressTimer = setTimeout(() => {
      longPressTriggered = true
      const touch = event.touches[0]
      showContextMenu(touch.clientX, touch.clientY, nodeId)
      if (navigator.vibrate) navigator.vibrate(10)
    }, 500)
  }
  //cancels the long press timer when the finger moves or lifts
  function cancelLongPress() { clearTimeout(longPressTimer) }

  //jumps to a move when it is clicked (ignored if it was a long press)
  function handleCellClick(nodeId) {
    if (longPressTriggered) { longPressTriggered = false; return }
    jumpToNode(nodeId)
  }

  //opens or closes the copy menu
  function toggleShareMenu(event) {
    if (event) event.stopPropagation()
    shareMenuOpen.value = !shareMenuOpen.value
  }

  //shows a short message at the bottom of the screen
  function showToast(message) {
    toastMessage.value = message
    clearTimeout(toastTimeout)
    toastTimeout = setTimeout(() => { toastMessage.value = '' }, 1800)
  }

  //copies text to the clipboard and shows a message
  async function copyToClipboard(text, label) {
    try { await navigator.clipboard.writeText(text); showToast(`${label} copied to clipboard`) }
    catch (e) { showToast(`Couldn't copy ${label.toLowerCase()}`) }
  }
  //copies the game as PGN
  function copyPGN() { copyToClipboard(chess.pgn() || '(no moves yet)', 'PGN') }
  //copies the current position as FEN
  function copyFEN() { copyToClipboard(chess.fen(), 'FEN') }

  //runs when the chessboard is ready: stores its API and loads an imported game if there is one
  async function onBoardCreated(api) {
    boardAPI.value = api
    chess.reset()
    boardAPI.value.setPosition(chess.fen())
    boardReady = true
    await tryLoadImportedGame()
  }

  // ===== CAPTURED PIECES & MATERIAL ADVANTAGE ==============================
  //pieces each side has captured
  const capturedByWhite = ref([])
  const capturedByBlack = ref([])
  //material difference (positive = white is ahead)
  const materialDiff = ref(0)

  //works out captured pieces and material from the moves played to the current position
  function recalcCapturedPieces() {
    const wCap = []
    const bCap = []
    let wMat = 0, bMat = 0
    //list of moves from the start to the current move
    const uciPath = []
    let n = currentNode.value
    while (n.parent !== null) { uciPath.unshift(n.uci); n = n.parent }
    //replays the moves to see what was captured
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
    //sorts the captured pieces from most valuable to least
    const sortDesc = (a, b) => (PIECE_MATERIAL[b[1]] || 0) - (PIECE_MATERIAL[a[1]] || 0)
    capturedByWhite.value = wCap.sort(sortDesc)
    capturedByBlack.value = bCap.sort(sortDesc)
    materialDiff.value = wMat - bMat
  }

  //scrolls the moves list so the current move stays visible
  function scrollActiveMoveIntoView() {
    const container = movesScrollRef.value
    const list = movesListRef.value
    if (!container || !list) return
    const active = list.querySelector('.move-cell.active')
    if (!active) return
    const cRect = container.getBoundingClientRect()
    const aRect = active.getBoundingClientRect()
    const topLimit = cRect.top + 6
    const bottomLimit = cRect.bottom - 6
    let delta = 0
    if (aRect.top < topLimit) delta = aRect.top - topLimit
    else if (aRect.bottom > bottomLimit) delta = aRect.bottom - bottomLimit
    if (Math.abs(delta) > 1) {
      container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' })
    }
  }

  //when the current move changes, update captured pieces, the graph and the scroll position
  watch(currentNode, () => {
    recalcCapturedPieces()
    rebuildEvalHistory()
    nextTick(() => {
      scrollActiveMoveIntoView()
      centerActiveStrip()
    })
  })
  //when the tree changes, rebuild the graph
  watch(treeVersion, () => { rebuildEvalHistory() })

  //is the shortcuts popup open
  const showShortcuts = ref(false)
  //list of keyboard shortcuts shown in the popup
  const shortcuts = [
    { keys: '← / →', desc: 'Previous / Next move' },
    { keys: 'Home / End', desc: 'Jump to start / end' },
    { keys: 'F', desc: 'Flip board' },
    { keys: 'S', desc: 'Toggle settings' },
    { keys: 'E', desc: 'Toggle engine' },
    { keys: '?', desc: 'Show / hide this panel' },
    { keys: 'Esc', desc: 'Close menus / minimize report' },
  ]
  //opens or closes the shortcuts popup
  function toggleShortcuts() { showShortcuts.value = !showShortcuts.value }

  //id of the move being noted (null when no note editor is open)
  const editingNoteNodeId = ref(null)
  //text typed in the note editor
  const noteDraft = ref('')
  //opens the note editor for a move (double-click)
  function openNoteEditor(nodeId) {
    const node = nodeMap[nodeId]
    if (!node) return
    editingNoteNodeId.value = nodeId
    noteDraft.value = node.note || ''
  }
  //saves the note on the move (empty text removes the note)
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
  //closes the note editor without saving
  function cancelNote() {
    editingNoteNodeId.value = null
    noteDraft.value = ''
  }

  //switches the report between normal and full screen
  function toggleReportMaximize() { isReportMaximized.value = !isReportMaximized.value }
  //stops the page from scrolling behind the full screen report
  watch(isReportMaximized, (max) => {
    document.body.style.overflow = max ? 'hidden' : ''
  })

  //closes the full screen report and goes back to the moves tab
  function startReview() {
    isReportMaximized.value = false
    activeTab.value = defaultTab()
  }

  //runs when the user moves a piece on the board
  function handleBothMoves(move) {
    if (isImporting.value) return
    const uci = move.promotion ? `${move.from}${move.to}${move.promotion}` : `${move.from}${move.to}`
    let sanMove
    //tries the move in the chess engine
    try {
      sanMove = chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined })
    } catch (e) {
      sanMove = null
    }
    //illegal move: put the piece back
    if (!sanMove) {
      boardAPI.value.setPosition(currentNode.value.fen)
      return
    }
    soundForLastMove(sanMove)
    attachMove(sanMove, uci)
    movesListUCI.value.push(uci)
    recalcCapturedPieces()
    requestAnalysisForNewMove()
  }

  //goes back one move
  function undoMove() {
    lastMoveSquare.value = null
    lastMoveFromSquare.value = null
    lastMoveAccuracy.value = null
    //already at the start
    if (currentNode.value.parent === null) return
    chess.undo()
    currentNode.value = currentNode.value.parent
    movesListUCI.value.pop()
    boardAPI.value.setPosition(chess.fen())
    playSound('move')
    recalcCapturedPieces()
  }

  //goes forward one move (along the main line)
  function redoMove() {
    lastMoveSquare.value = null
    lastMoveFromSquare.value = null
    lastMoveAccuracy.value = null
    //no next move
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

  //goes back one move and re-runs the engine
  function undoAccuracy() { undoMove(); getAccuracy() }
  //goes forward one move and re-runs the engine
  function redoAccuracy() { redoMove(); getAccuracy() }

  //jumps to any move in the tree by replaying all moves up to it
  function jumpToNode(nodeId) {
    const node = nodeMap[nodeId]
    if (!node || node === currentNode.value) return
    //list of moves from the start to this node
    const uciMoves = []
    let current = node
    while (current.parent !== null) { uciMoves.unshift(current.uci); current = current.parent }
    //rebuilds the chess game from the start
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
    if (!node.analysisData) {
      moveData.value = null
      isAccuracy.value = " "
      color.value = " "
    }
    recalcCapturedPieces()
    getAccuracy()
  }

  //jumps to the start position
  function goToStart() {
    if (currentNode.value.id !== 0) {
      playSound('move')
      jumpToNode(0)
    }
  }

  //jumps to the last move of the main line
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

  //clears the whole game and goes back to the start
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

  //resets the board and clears the analysis display
  function resetAccuracy() { resetBoard(); isAccuracy.value = " "; color.value = " "; moveData.value = null }

  //counts analysis runs so old results are ignored
  let accuracyRun = 0

  //throttled UI refresh: engine results are saved right away, but the screen
  //is refreshed at most once per interval while the engine is running
  let uiFlushTimer = null
  let uiFlushFn = null

  function scheduleUiFlush(fn, ms = 120) {
    uiFlushFn = fn
    if (uiFlushTimer) return
    uiFlushTimer = setTimeout(flushUi, ms)
  }

  //runs the pending screen update right away
  function flushUi() {
    clearTimeout(uiFlushTimer)
    uiFlushTimer = null
    const fn = uiFlushFn
    uiFlushFn = null
    fn?.()
  }

  //drops any pending screen update (used when a new analysis starts)
  function cancelUiFlush() {
    clearTimeout(uiFlushTimer)
    uiFlushTimer = null
    uiFlushFn = null
  }

  //runs the engine on the current position (reuses saved results whenever they are good enough)
  async function getAccuracy() {
    const run = ++accuracyRun
    //drop any screen update left over from the previous position
    cancelUiFlush()
    //stop any engine work that is still running
    await cancelAnalysis()
    if (run !== accuracyRun) return

    const node = currentNode.value
    const cached = node.analysisData
    const importing = isImporting.value

    //depth and number of lines this position needs
    const depthNeeded = importing ? targetDepth.value : Math.min(targetDepth.value, 20)
    const pvNeeded = importing ? 1 : analysisMultiPV.value

    //saved result is deep enough (or the engine already finished at this target, e.g. mate positions)
    const depthOk = !!cached && (cached.depth >= depthNeeded || (node.doneDepth ?? 0) >= depthNeeded)
    //saved result has enough lines
    const pvOk = importing || !isEngineEnabled.value || !node.san || (node.pvUsed ?? 1) >= pvNeeded

    //shows the saved result on screen
    const showCached = () => {
      moveData.value = cached
      lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
      lastMoveFromSquare.value = movesListUCI.value.at(-1)?.slice(0, 2) ?? null
      lastMoveAccuracy.value = cached.move_accuracy
      currentDepth.value = cached.depth
      evalSize(); moveDescription(); sanBest(); uciSecondLine(); uciThirdLine(); uciLine()
    }

    //engine off: just show the saved result (or clear the display)
    if (!importing && !isEngineEnabled.value) {
      if (cached) {
        showCached()
      } else {
        moveData.value = null
        isAccuracy.value = " "
        color.value = " "
      }
      isAnalyzing.value = false
      return
    }

    //saved result is good enough: no engine run at all
    if (depthOk && pvOk) {
      showCached()
      isAnalyzing.value = false
      return
    }

    //show the old result while the engine works on a better one
    if (cached) showCached()

    //wait briefly so fast clicking through moves doesn't restart the engine every time
    if (!importing) {
      await new Promise(r => setTimeout(r, 150))
      if (run !== accuracyRun) return
    }

    isAnalyzing.value = true
    bestArrowSquares.value = null
    const beforeFen = node.parent ? node.parent.fen : moveTree.fen
    const afterFen = node.fen
    const depthToUse = depthNeeded
    const multiPVToUse = pvNeeded

    await getEvaluation(
      movesListUCI.value.length === 0 ? '' : movesListUCI.value.at(-1),
      movesListUCI.value.slice(0, -1),
      depthToUse,
      (result) => {
        //save on the node that was analyzed, even if the user has moved on,
        //so the work is never lost
        node.accuracy = result.move_accuracy
        node.analysisData = result
        node.pvUsed = multiPVToUse

        //only update the screen for the latest run
        if (run !== accuracyRun) return
        //during import nobody is watching the board, so skip the screen update
        if (importing) return

        //refresh the screen at most once per interval
        scheduleUiFlush(() => {
          if (run !== accuracyRun) return
          moveData.value = result
          lastMoveSquare.value = movesListUCI.value.at(-1)?.slice(2, 4) ?? null
          lastMoveFromSquare.value = movesListUCI.value.at(-1)?.slice(0, 2) ?? null
          lastMoveAccuracy.value = result.move_accuracy
          currentDepth.value = result.depth
          isAnalyzing.value = result.depth < depthToUse
          evalSize(); moveDescription(); sanBest(); uciSecondLine(); uciThirdLine(); uciLine()
          //graph and report need the latest eval, so refresh the tree data too
          treeVersion.value++
        })
      },
      beforeFen, afterFen, moveTree.fen,
      multiPVToUse,
      chess.isCheckmate(),
      chess.isStalemate()
    )

    //engine finished normally: show the final result and remember the target depth was reached
    if (run === accuracyRun) {
      flushUi()
      isAnalyzing.value = false
      if (!importCancelled && node.analysisData) node.doneDepth = depthToUse
    }
  }

  //saves the new depth and re-runs the engine
  function onDepthChange() {
    localStorage.setItem(DEPTH_STORAGE_KEY, String(targetDepth.value))
    getAccuracy()
  }

  //turns the engine score into text (like 0.35, M3, or 1-0)
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

  //sets the eval bar height from the engine score
  function evalSize() {
    if (!moveData.value || !moveData.value.eval) return
    const evalValue = moveData.value.eval.value
    const evalType = moveData.value.eval.type
    //a mate means the bar is fully one side
    if (evalType === "mate") {
      if (evalValue >= 0) { cp.value = 800; height.value = 0 } else { cp.value = -800; height.value = 100 }
      return
    }
    //limits the score to -800 to 800 and converts it to a percentage
    cp.value = Math.max(-800, Math.min(800, evalValue))
    height.value = 50 - (cp.value / 800) * 50
  }

  //turns the board around
  function flipBoard() {
    if (!boardAPI.value) return
    boardAPI.value.toggleOrientation()
    rotate.value += 180
  }

  //places the last-move accuracy icon on the right square of the board
  function squareStyle(square) {
    if (!square) return {}
    const file = square.charCodeAt(0) - 97
    const rank = parseInt(square[1]) - 1
    const flipped = (rotate.value / 180) % 2 === 1
    const col = flipped ? 7 - file : file
    const row = flipped ? rank : 7 - rank
    return { position: 'absolute', left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%`, transform: 'translate(-70%, -35%)' }
  }

  //builds the text under the board (like "Nf3 is a great move!")
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

  //text that says what the best move was (hidden when the move was already good)
  function displayBest() {
    if (['brilliant', 'best', 'great', 'book'].includes(moveData.value.move_accuracy)) return " "
    if (moveData.value.best_move === " ") return " "
    return prettyMove(bestMoveSan.value) + " was the best "
  }

  //turns the engine's best line into SAN moves for display
  function uciLine() {
    const fenParts = chess.fen().split(' ')
    lineStart.value = { turn: fenParts[1], num: Number(fenParts[5]) || 1 }
    sanLine.value = []
    bestArrowSquares.value = null
    if (!moveData.value?.best_line) return
    let lineNum = 0
    greedyChess.load(chess.fen())
    //shows up to 30 moves of the line
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

  //converts the engine's best move into SAN (like Nf3)
  function sanBest() {
    if (!moveData.value?.best_move) return
    const baseFen = currentNode.value.parent ? currentNode.value.parent.fen : moveTree.fen
    bestChess.load(baseFen)
    const bestMove = bestChess.move(moveData.value.best_move, { sloppy: true })
    if (!bestMove) return
    bestMoveSan.value = bestMove.san
  }

  //turns the second engine line into SAN moves for display
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

  //turns the third engine line into SAN moves for display
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

  //plays the engine's best move on the board
  async function playMove() {
    if (!moveData.value?.best_move) return
    const uci = moveData.value.best_move
    const from = uci.slice(0, 2), to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    //takes back the current move first so the best move replaces it
    undoMove()
    let sanMove
    try {
      sanMove = chess.move({ from, to, promotion: promotion ?? undefined })
    } catch (e) {
      sanMove = null
    }
    if (!sanMove) return
    soundForLastMove(sanMove)
    attachMove(sanMove, uci)
    movesListUCI.value.push(uci)
    boardAPI.value.setPosition(chess.fen())
    treeVersion.value++
    recalcCapturedPieces()
    requestAnalysisForNewMove()
  }

  // ===== PLAY BEST MOVE INSTEAD (lightbulb / trash button) ================
  //remembers the new line made by "play best instead" ({ nodeId, returnId })
  const bestVariation = ref(null)

  //true if the current move is bad enough to offer the best move instead
  const canPlayBest = computed(() => {
    moveData.value // re-run when analysis updates
    const n = currentNode.value
    const d = n.analysisData
    return !!(n.san && d?.best_move && NOT_BEST.includes(d.move_accuracy))
  })

  //true if we are currently inside the best move line we created
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

  //replaces the current bad move with the engine's best move as a new line
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

  //deletes the best move line and goes back to the original move
  function removeBestVariation() {
    const v = bestVariation.value
    if (!v) return
    bestVariation.value = null
    if (nodeMap[v.nodeId]) deleteMove(v.nodeId)
    jumpToNode(v.returnId)
  }

  //handles keyboard shortcuts
  const handleKeyDown = (event) => {
    //minimum time between arrow key moves
    const delay = 200
    const currentTime = Date.now()
    const tag = event.target?.tagName
    //don't steal keys while typing in a box
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    //Esc closes things
    if (event.key === 'Escape') {
      closeContextMenu()
      showShortcuts.value = false
      editingNoteNodeId.value = null
      if (isReportMaximized.value) isReportMaximized.value = false
      return
    }
    //? opens the shortcuts list
    if (event.key === '?') {
      event.preventDefault()
      toggleShortcuts()
      return
    }
    //no shortcuts during import
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

  //plays a move given in UCI format (used by the engine lines and the explorer)
  function applyUciMove(uci) {
    const from = uci.slice(0, 2)
    let to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    //fixes castling squares
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
    attachMove(sanMove, normalizedUci)
    movesListUCI.value.push(normalizedUci)
    recalcCapturedPieces()
    return sanMove
  }

  //plays the first few moves of an engine line when it is clicked
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

  //opens a position from a FEN string in the URL
  async function loadFen(fen) {
    chess.load(fen)
    moveTree.fen = fen
    currentNode.value = moveTree
    if (boardAPI.value) boardAPI.value.setPosition(fen)
  }

  //analyzes a whole imported game move by move (shows a loading screen)
  async function loadImportedGame(uciList) {
    isImporting.value = true
    importCancelled = false
    importProgress.value = { current: 0, total: uciList.length }
    //engine is run by the import loop, not by the toggle
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
        //save in the background so the report opens right away
        saveGameInsights().catch(e => console.warn('Saving game insights failed:', e))
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

  //starts the import if the URL has moves in it and the board and engine are ready
  async function tryLoadImportedGame() {
    if (boardReady && engineReady && route.query.moves) {
      //flips the board so the player's color is at the bottom
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

  //stops the import and goes back to the home page
  async function cancelImport() {
    importCancelled = true
    await cancelAnalysis()
    isImporting.value = false
    resetAccuracy()
    hasPlayerInfo.value = false
    document.body.style.overflow = ''
    router.replace({ path: '/', query: {} })
  }

  //import progress as a percentage for the progress bar
  const importProgressPercent = computed(() => {
    if (!importProgress.value.total) return 0
    return Math.round((importProgress.value.current / importProgress.value.total) * 100)
  })

  //id of the logged in user (needed to save games)
  const currentUserId = ref(null)
  //game info from the URL, kept until the game is saved
  let pendingGameMeta = null

  //keeps the game info from the URL up to date
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

  //win / loss / draw / unknown for one side
  function resultForColor(color) {
    if (gameResult.value === '1-0') return color === 'white' ? 'win' : 'lose'
    if (gameResult.value === '0-1') return color === 'black' ? 'win' : 'lose'
    if (gameResult.value === '1/2-1/2') return 'draw'
    return 'unknown'
  }

  //works out all the stats for the game and saves them to Firestore
  async function saveGameInsights() {
    if (!currentUserId.value || !pendingGameMeta) return
    //list of every move in the main line
    const uciList = []
    let curr = moveTree.children[0]
    while (curr) { uciList.push(curr.uci); curr = curr.children[0] }
    if (uciList.length === 0) return
    //which side the user played
    const myColor = pendingGameMeta.myColor === 'black' ? 'black' : 'white'
    //points for each move quality
    const weights = { brilliant: 100, great: 100, best: 100, book: 100, excellent: 90, good: 80, inaccuracy: 20, mistake: 10, blunder: 0 }
    const myCounts = { brilliant: 0, great: 0, best: 0, book: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    let myWeightedSum = 0
    let myMoveCount = 0
    //accuracy per 10-move block
    const moveBuckets = {}
    let node = moveTree.children[0]
    let ply = 1
    //counts the user's move qualities and accuracy
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
    //overall accuracy for the user
    const overallAccuracy = myMoveCount > 0 ? (myWeightedSum / myMoveCount) : null
    //opening, middlegame and endgame move ranges
    const phases = getGamePhases(uciList)
    const phaseAccuracy = { opening: null, middlegame: null, endgame: null }
    const phaseCounts = { opening: 0, middlegame: 0, endgame: 0 }
    //accuracy for each phase
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
    //squares where the user made good and bad moves
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
    //accuracy for each piece type
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
    //turns an engine score into centipawns (mate counts as a huge number)
    const toCp = (ev) => {
      if (!ev) return null
      if (ev.type === 'mate') return Math.sign(ev.value) * 10000
      return ev.value
    }
    //flips the score so positive always means good for the user
    const fromMyPerspective = (cpv) => (myColor === 'white' ? cpv : -cpv)
    //the user's material on a given position
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
    //goes through every move and counts style and mistakes
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
        //checks for a sacrifice: give up material, but the position still holds
        const reply = tNode.children[0] ?? null
        const replyEval = reply ? toCp(reply.analysisData?.eval) : null
        if (reply && before !== null && replyEval !== null) {
          const materialLost = myMat(prevNode.fen) - myMat(reply.fen)
          const windowDelta = fromMyPerspective(replyEval) - fromMyPerspective(before)
          if (materialLost >= 2 && windowDelta >= -100) sacrifices++
        }
        myLastMoveWasStrong = STRONG.includes(tNode.accuracy)
      } else {
        //the opponent's moves: gains for the user, and errors caused by strong user moves
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
    //reads the result from the PGN and works out win / loss / draw for the user
    let result = null
    const resultMatch = (pendingGameMeta.pgn || '').match(/\[Result\s+"([^"]+)"\]/)
    if (resultMatch) {
      const r = resultMatch[1]
      if (r === '1-0') result = myColor === 'white' ? 'win' : 'loss'
      else if (r === '0-1') result = myColor === 'black' ? 'win' : 'loss'
      else if (r === '1/2-1/2') result = 'draw'
    }
    //the full playing style summary
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
    //gets the opening name from the server
    const openingName = await fetchOpeningNameForSave(uciList)
    const pgn = pendingGameMeta.pgn || chess.pgn()
    //a number that identifies this game (to avoid saving it twice)
    const pgnHash = generatePgnHash(pgn)
    //collects positions where the user blundered and had a clear better move (for puzzles)
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
            //only keep puzzles where the mistake changed the score a lot
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
    //player info saved with the game
    const whitePlayer = { username: whiteName.value || 'White', rating: whiteRating.value || 0, result: resultForColor('white') }
    const blackPlayer = { username: blackName.value || 'Black', rating: blackRating.value || 0, result: resultForColor('black') }
    //everything we want to save under "insights"
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
    //the user's games collection in Firestore
    const gamesRef = collection(db, `users/${currentUserId.value}/games`)
    //checks if this game was already saved
    const dupQ = query(gamesRef, where('pgnHash', '==', pgnHash))
    const dupSnap = await getDocs(dupQ)
    if (!dupSnap.empty) {
      //game exists: update it, keeping puzzle progress for puzzles that are still there
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
      //new game: add it to the database
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

  //asks the explorer API for the opening name of the first moves
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
</script>

<template>
  <!-- Settings popup (depth, sound, best arrow, theme) -->
  <SettingsPanel
    v-model:isOpen="isSettingsOpen"
    v-model:targetDepth="targetDepth"
    v-model:soundOn="soundOn"
    v-model:showBestArrow="showBestArrow"
    v-model:boardTheme="currentTheme"
    @depthChanged="onDepthChange"
    @flipBoard="flipBoard"
    @copyPgn="copyPGN"
    @copyFen="copyFEN"
  />

  <!-- Loading screen shown while an imported game is analyzed -->
  <Transition name="loading-fade">
    <div v-if="isImporting" class="analysis-loading-overlay">
      <div class="loading-content">
        <!-- spinning rings -->
        <div class="loading-spinner">
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
        </div>
        <p class="loading-title">Analyzing Game</p>
        <!-- move progress and depth -->
        <p class="loading-subtitle">
          Move {{ importProgress.current }} / {{ importProgress.total }} · Depth
          {{ targetDepth }}
        </p>
        <!-- progress bar -->
        <div class="loading-progress-bar">
          <div
            class="loading-progress-fill"
            :style="{ width: importProgressPercent + '%' }"
          ></div>
        </div>
        <!-- helpful tips -->
        <div class="loading-tips">
          <p class="loading-tip">
            Review stuck? A quick page refresh usually fixes it.
          </p>
          <p class="loading-tip">
            Feels slow? Try lowering the engine depth in Settings.
          </p>
        </div>
        <!-- stops the import -->
        <button class="cancel-import-btn" @click="cancelImport">
          Cancel review
        </button>
      </div>
    </div>
  </Transition>

  <!-- Main page layout -->
  <div class="grid-layout">
    <!-- App title -->
    <Title class="title-slot" />

    <!-- MOBILE TOP BAR: both players in one row -->
    <div v-if="isMobile" class="mobile-topbar">
      <div class="mp-players">
        <template v-if="hasPlayerInfo">
          <!-- one chip per player -->
          <div v-for="p in mobilePlayers" :key="p.side" class="mp-chip">
            <span class="player-color-dot" :class="p.side"></span>
            <span class="mp-name">{{ p.name }}</span>
              <!-- crown for the winner -->
              <svg v-if="p.isWinner" class="mp-crown" viewBox="0 0 24 24" role="img" aria-label="Winner">
                <path d="M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5 19.2 18H4.8L3 7.5zM5.2 20h13.6v1.5H5.2V20z" />
              </svg>
            <span v-if="p.rating" class="mp-rating">{{ p.rating }}</span>
            <!-- captured pieces and material lead -->
            <span v-if="p.captured.length || p.lead" class="mp-captured">
              <span
                v-for="(piece, i) in p.captured"
                :key="p.side + '-c-' + i"
                class="captured-piece"
                >{{ PIECE_UNICODE[piece] }}</span
              >
              <span v-if="p.lead" class="material-badge">+{{ p.lead }}</span>
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- Board area -->
    <div class="board-area">
      <div
        class="board-wrapper"
        ref="boardRef"
        :style="{ '--last-move-highlight': lastMoveHighlightColor}"
      >
        <!-- TOP player bar (desktop) -->
        <div class="player-bar" v-if="hasPlayerInfo && !isMobile">
          <span class="player-color-dot" :class="topPlayer.side"></span>
          <span class="player-name">{{ topPlayer.name }}</span>
          <svg v-if="topPlayer.isWinner" class="winner-crown" viewBox="0 0 24 24" role="img" aria-label="Winner">
            <path d="M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5 19.2 18H4.8L3 7.5zM5.2 20h13.6v1.5H5.2V20z" />
          </svg>
          <span
            class="player-rating"
            v-if="topPlayer.rating"
            >{{ topPlayer.rating }}</span
          >
          <!-- captured pieces for the top player -->
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

        <!-- board and eval bar side by side -->
        <div class="board-row">
          <div class="board-col">
            <!-- the chessboard -->
            <TheChessboard
              class="game-board"
              @move="handleBothMoves"
              @board-created="onBoardCreated"
              :board-config="{ coordinates: true, animation: { enabled: true, duration: 150 }}"
            />
            <!-- Best-move arrow: own overlay, never interferes with user-drawn arrows -->
            <svg
              v-if="bestArrow"
              class="best-arrow-overlay"
              viewBox="0 0 8 8"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                :x1="bestArrow.x1"
                :y1="bestArrow.y1"
                :x2="bestArrow.x2"
                :y2="bestArrow.y2"
                class="best-arrow-line"
              />
              <polygon :points="bestArrow.head" class="best-arrow-head" />
            </svg>
            <!-- accuracy icon on the last move square -->
            <img
              v-if="lastMoveSquare && lastMoveAccuracy"
              :src="accuracySymbol(lastMoveAccuracy)"
              class="board-acc-icon"
              :style="squareStyle(lastMoveSquare)"
            />
          </div>
          <!-- eval bar -->
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

        <!-- BOTTOM player bar (desktop) -->
        <div class="player-bar bottom" v-if="hasPlayerInfo && !isMobile">
          <span class="player-color-dot" :class="bottomPlayer.side"></span>
          <span class="player-name">{{ bottomPlayer.name }}</span>
          <svg v-if="bottomPlayer.isWinner" class="winner-crown" viewBox="0 0 24 24" role="img" aria-label="Winner">
            <path d="M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5 19.2 18H4.8L3 7.5zM5.2 20h13.6v1.5H5.2V20z" />
          </svg>
          <span
            class="player-rating"
            v-if="bottomPlayer.rating"
            >{{ bottomPlayer.rating }}</span
          >
          <!-- captured pieces for the bottom player -->
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

        <!-- BOARD TOOLS: MOBILE (prev / scrollable moves / next) -->
        <div v-if="isMobile" class="boardtools mobile-tools">
          <!-- previous move (hold for start) -->
          <button
            type="button"
            class="bt-btn bt-nav"
            :disabled="isImporting || currentNode.parent === null"
            @pointerdown="navDown('prev')"
            @pointerup="navUp"
            @pointerleave="navUp"
            @pointercancel="navUp"
            @click="navClick('prev')"
            @contextmenu.prevent
            title="Previous move (hold for start)"
            aria-label="Previous move"
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <!-- scrollable strip of moves -->
          <div class="move-strip" ref="stripRef">
            <template v-for="item in stripItems" :key="item.key">
              <!-- variation marker -->
              <button
                v-if="item.kind === 'sep'"
                type="button"
                class="strip-sep"
                :class="{ divider: item.divider }"
                @click="jumpToNode(item.altId)"
                :aria-label="item.divider ? 'Back to main line' : 'Show variation'"
                :title="item.divider ? 'Back to main line' : 'Show variation'"
              >
                <svg v-if="!item.divider" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
              </button>
              <!-- one move chip -->
              <div
                v-else
                class="strip-cell"
                :class="{ active: item.node === currentNode, variant: item.variant }"
                @click="handleCellClick(item.node.id)"
                @contextmenu.prevent="openContextMenu($event, item.node.id)"
                @touchstart.passive="handleTouchStart($event, item.node.id)"
                @touchend="cancelLongPress"
                @touchmove="cancelLongPress"
              >
                <span v-if="item.showNum" class="strip-num">{{ item.num }}{{ item.isWhite ? '.' : '...' }}</span>
                <span class="strip-san">{{ prettyMove(item.node.san) }}</span>
                <img
                  v-if="item.node.accuracy"
                  :src="accuracySymbol(item.node.accuracy)"
                  class="strip-acc"
                />
              </div>
            </template>
            <span v-if="!stripItems.length" class="strip-empty">Make a move to start</span>
          </div>

          <!-- next move (hold for end) -->
          <button
            type="button"
            class="bt-btn bt-nav"
            :disabled="isImporting || currentNode.children.length === 0"
            @pointerdown="navDown('next')"
            @pointerup="navUp"
            @pointerleave="navUp"
            @pointercancel="navUp"
            @click="navClick('next')"
            @contextmenu.prevent
            title="Next move (hold for end)"
            aria-label="Next move"
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <!-- BOARD TOOLS: DESKTOP -->
        <div v-else class="boardtools">
          <div class="boardtools-left">
            <!-- play the best move instead (lightbulb) -->
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
            <!-- delete the best move line (trash) -->
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

          <!-- navigation buttons -->
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
            <!-- flip board -->
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

          <!-- copy menu (PGN / FEN) -->
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

    <!-- Analysis panel and tabs -->
    <div
      class="analysis-container"
      @touchstart.passive="onTabSwipeStart"
      @touchend.passive="onTabSwipeEnd"
    >
      <!-- Desktop: always visible above the tabs. Mobile: shown only on the Analysis tab -->
      <div
        class="analyze"
        :class="{ 'engine-active': isEngineEnabled }"
        v-show="!isMobile || activeTab === 'analysis'"
      >
        <div class="analyzis-header">
          <div class="analysis-title-row">
            <!-- settings button (desktop) -->
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
              <!-- pulsing dot while the engine thinks -->
              <span
                v-if="isAnalyzing"
                class="thinking-dot"
                title="Engine is thinking"
              ></span>
            </h2>
          </div>
          <!-- engine controls: line count, depth, on/off -->
          <div class="engine-controls">
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
        <!-- engine lines and move quality text -->
        <div v-if="moveData" class="move-data">
          <!-- best line (click a move to play it) -->
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
          <!-- second best line -->
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
          <!-- third line -->
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
          <!-- text like "Nf3 is a great move!" -->
          <div class="accuracydiv">
            <img
                v-if="currentNode.san && currentNode.accuracy"
                :src="accuracySymbol(currentNode.accuracy)"
                class="large-acc"
                :class="currentNode.accuracy"
              />
            <p :style="{ color: color }" class="accuracydescribtion">        
              {{ isAccuracy }}
            </p>
          </div>
          <!-- "X was the best" (click to play it) -->
          <p class="bestmove" v-if="movesListUCI.length > 0" @click="playMove">
            {{ displayBest() }}
          </p>
        </div>
      </div>

      <!-- Tabs panel -->
      <div class="moves">
        <!-- Tab rail: vertical on desktop AND mobile -->
        <nav class="tab-rail" role="tablist" aria-label="Panel tabs" :style="{ '--i': activeTabIndex }">
          <!-- highlight that slides behind the active tab -->
          <span class="tab-rail-indicator" aria-hidden="true"></span>
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            type="button"
            role="tab"
            class="rail-btn"
            :class="{ on: tab.id === activeTab }"
            :aria-selected="tab.id === activeTab"
            :title="tab.label"
            :aria-label="tab.label"
            @click="activeTab = tab.id"
          >
            <!-- analysis icon (mobile) -->
            <svg v-if="tab.id === 'analysis'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
            </svg>
            <!-- moves icon -->
            <svg v-else-if="tab.id === 'moves'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 6h11M9 12h11M9 18h11" />
              <circle cx="4.5" cy="6" r="1" fill="currentColor" />
              <circle cx="4.5" cy="12" r="1" fill="currentColor" />
              <circle cx="4.5" cy="18" r="1" fill="currentColor" />
            </svg>
            <!-- report icon -->
            <svg v-else-if="tab.id === 'report'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 20V11M12 20V4M19 20v-6" />
            </svg>
            <!-- explorer icon -->
            <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" />
            </svg>
            <span class="rail-label">{{ tab.label }}</span>
          </button>

          <!-- Settings button at the bottom of the rail (mobile only) -->
          <button
            v-if="isMobile"
            type="button"
            class="control-icon-btn rail-settings"
            @click="isSettingsOpen = true"
            title="Settings"
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </svg>
          </button>
        </nav>

        <!-- content of the active tab -->
        <div class="moves-body" ref="movesScrollRef" v-show="!isMobile || activeTab !== 'analysis'">
          <!-- MOVES TAB: the full move list with variations -->
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
                  @touchstart.passive="cell && handleTouchStart($event, cell.node.id)"
                  @touchend="cancelLongPress"
                  @touchmove="cancelLongPress"
                >
                  <template v-if="cell">
                    <span v-if="cell.showNum" class="move-num"
                      >{{ cell.displayNum }}{{ cell.isWhite ? '.' : '...' }}</span
                    >
                    <span class="move-san-text">{{ prettyMove(cell.node.san) }}</span>
                    <!-- note marker -->
                    <span
                      v-if="cell.node.note"
                      class="note-indicator"
                      title="Has note"
                      >📝</span
                    >
                    <!-- accuracy icon -->
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
              <!-- title and buttons -->
              <div class="report-header">
                <h3 class="report-title">Game Report</h3>
                <div class="report-header-actions">
                  <!-- closes full screen and goes to moves -->
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
                  <!-- full screen toggle -->
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

              <!-- Score boxes: accuracy % and estimated rating for each side -->
              <div class="score-row">
                <div v-for="side in ['white', 'black']" :key="side" class="score-box" :class="side">
                  <span class="score-num">
                    {{ gameReportStats[side].accuracy !== null ? gameReportStats[side].accuracy.toFixed(1) + '%' : '—' }}
                  </span>
                  <span class="score-rating">{{ estimatedRatings[side] ?? '—' }}</span>
                </div>
              </div>

              <!-- Move table: how many of each move quality per side -->
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
                  <!-- click a count to jump to that move -->
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

              <!-- Eval graph: score over the whole game -->
              <div class="eval-graph-card" v-if="evalGraphGeom">
                <div
                  class="eval-graph-area"
                  @click="evalGraphClick"
                  @mousemove="evalGraphHover"
                  @mouseleave="graphHoverIdx = -1"
                >
                  <!-- graph shapes -->
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
                  <!-- line showing the current move -->
                  <div
                    v-if="evalGraphGeom.currentIdx >= 0"
                    class="eg-current"
                    :style="{ left: evalGraphGeom.coords[evalGraphGeom.currentIdx].xPct + '%' }"
                  ></div>
                  <!-- hover info -->
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
                  <!-- dots for big moments (click to jump) -->
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
                        <!-- white bar -->
                        <div class="phase-line">
                          <span class="side-swatch white-swatch"></span>
                          <div class="phase-bar">
                            <div :style="{ width: (gameExtendedStats.white.phases[phase] || 0) + '%', background: accColorForWeight(gameExtendedStats.white.phases[phase]) }"></div>
                          </div>
                          <span class="phase-val" :style="{ color: accColorForWeight(gameExtendedStats.white.phases[phase]) }">{{ fmtAcc(gameExtendedStats.white.phases[phase]) }}</span>
                        </div>
                        <!-- black bar -->
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

                  <!-- Game Stats: checks, captures, pawns lost, swings -->
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
                </div>
              </template>
            </div>
          </Teleport>

          <!-- EXPLORER TAB: opening database (Masters or Players) -->
          <div class="explorer" v-else-if="activeTab === 'explorer'">
            <!-- database switch -->
            <div class="explorer-db-toggle">
              <button :class="{ active: explorerDb === 'masters' }" @click="explorerDb = 'masters'">Masters</button>
              <button :class="{ active: explorerDb === 'lichess' }" @click="explorerDb = 'lichess'">Players</button>
            </div>
            <!-- loading message -->
            <div v-if="explorerLoading" class="explorer-status">
              <div class="mini-spinner"></div>
              Loading {{ explorerDb === 'masters' ? 'master' : 'player' }} games…
            </div>
            <!-- error message -->
            <div v-else-if="explorerError" class="explorer-status error">{{ explorerError }}</div>
            <template v-else>
              <!-- opening name -->
              <div class="explorer-header">
                <span class="explorer-eco" v-if="openingEco">{{ openingEco }}</span>
                <span class="explorer-name">{{ opening }}</span>
              </div>
              <!-- move table -->
              <div class="explorer-table" v-if="explorerMoves.length">
                <div class="explorer-row explorer-row-head">
                  <span class="col-move">Move</span>
                  <span class="col-games">Games</span>
                  <span class="col-split">W / D / B</span>
                </div>
                <!-- click a row to play that move -->
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
                <!-- totals row -->
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
  </div>

  <!-- Popups (components in assets/) -->
  <!-- note editor for a move -->
  <NoteEditor
    :open="editingNoteNodeId !== null"
    :san="nodeMap[editingNoteNodeId]?.san || ''"
    v-model:draft="noteDraft"
    @save="saveNote"
    @cancel="cancelNote"
  />

  <!-- keyboard shortcuts list -->
  <ShortcutsPanel
    :visible="showShortcuts"
    :shortcuts="shortcuts"
    @close="showShortcuts = false"
  />

  <!-- right-click / long-press menu -->
  <ContextMenu
    :visible="contextMenu.visible"
    :x="contextMenu.x"
    :y="contextMenu.y"
    @delete="handleDeleteFromMenu"
  />

  <!-- short message at the bottom of the screen -->
  <Transition name="toast-fade">
    <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
  </Transition>
</template>

<style scoped src="../assets/analysis.css"></style>