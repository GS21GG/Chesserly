// assets/useExplorer.js
// Opening explorer (Masters / Players): fetching, out-of-book handling, playing explorer moves.

import { ref, shallowRef, watch, nextTick } from 'vue'

export function useExplorer(deps) {
  const {
    currentNode, movesListUCI, activeTab, movesScrollRef,
    isImporting, boardAPI, chess, applyUciMove, soundForLastMove, requestAnalysisForNewMove
  } = deps

  const opening = ref("")
  const openingEco = ref("")
  const explorerStats = shallowRef(null)
  const explorerMoves = shallowRef([])
  const explorerLoading = ref(false)
  const explorerError = ref("")
  const explorerDb = ref('masters')

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

  // Load the explorer when the node, tab or database changes
  watch(currentNode, () => { if (activeTab.value === 'explorer') importLichessExplorer() }, { immediate: true })
  watch(activeTab, (newTab) => { if (newTab === 'explorer') importLichessExplorer() })
  watch(explorerDb, () => { importLichessExplorer() })

  return {
    opening,
    openingEco,
    explorerStats,
    explorerMoves,
    explorerLoading,
    explorerError,
    explorerDb,
    importLichessExplorer,
    playExplorerMove
  }
}