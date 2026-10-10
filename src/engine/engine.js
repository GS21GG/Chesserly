let sf = null
let analysisId = 0
let currentResolve = null
let currentMultiPV = 1

// ---- Storage Keys -----------------------------------------------------
const LOCAL_EVAL_STORAGE_KEY = 'chesserly_localEvalCache'
const MAX_CACHE_ENTRIES = 1500

// ---- Cache Dirty Flags ------------------------------------------------
let localEvalDirty = false
let persistTimer = null
const PERSIST_DEBOUNCE_MS = 1000

function loadCacheFromStorage(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return new Map()
        const entries = JSON.parse(raw)
        if (!Array.isArray(entries)) return new Map()
        return new Map(entries)
    } catch (error) {
        console.warn(`Failed to load ${storageKey} from localStorage:`, error)
        return new Map()
    }
}

function saveCacheToStorage(storageKey, cache) {
    try {
        if (cache.size > MAX_CACHE_ENTRIES) {
            const excess = cache.size - MAX_CACHE_ENTRIES
            const keysToDelete = Array.from(cache.keys()).slice(0, excess)
            for (const key of keysToDelete) cache.delete(key)
        }
        localStorage.setItem(storageKey, JSON.stringify(Array.from(cache.entries())))
    } catch (error) {
        console.warn(`Failed to save ${storageKey} to localStorage:`, error)
    }
}

function schedulePersist() {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
        persistTimer = null
        if (localEvalDirty) {
            saveCacheToStorage(LOCAL_EVAL_STORAGE_KEY, localEvalCache)
            localEvalDirty = false
        }
    }, PERSIST_DEBOUNCE_MS)
}
const localEvalCache = loadCacheFromStorage(LOCAL_EVAL_STORAGE_KEY)

function ensureScoreFields(score) {
    if (!score) return score
    if (!('Centipawn' in score)) {
        score.Centipawn = score.type === "cp" ? score.value : null
    }
    if (!('Mate' in score)) {
        score.Mate = score.type === "mate" ? score.value : null
    }
    return score
}

const STARTPOS_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

// ---- Local Opening Book -----------------------------------------------
let openingBookMap = new Map()
let openingBookLoaded = false

export async function loadOpeningBook(url = '/book/openings.json') {
    if (openingBookLoaded) return
    try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        openingBookMap = new Map()
        if (Array.isArray(data)) {
            for (const line of data) {
                if (!Array.isArray(line)) continue

                let prefix = ""
                for (let i = 0; i < line.length; i++) {
                    const mv = line[i]
                    if (!openingBookMap.has(prefix)) openingBookMap.set(prefix, new Set())
                    openingBookMap.get(prefix).add(mv)
                    prefix = prefix === "" ? mv : `${prefix},${mv}`
                }
            }
        } else if (data && typeof data === 'object') {
            for (const [key, moves] of Object.entries(data)) {
                if (Array.isArray(moves)) openingBookMap.set(key, new Set(moves))
            }
        }
        openingBookLoaded = true
    } catch (error) {
        console.warn('Failed to load opening book:', error)
        openingBookMap = new Map()
        openingBookLoaded = true
    }
}

export function isOpeningBookLoaded() {
    return openingBookLoaded && openingBookMap.size > 0
}

export async function startEngine() {
    const bookPromise = loadOpeningBook()
    await new Promise((resolve) => {
        sf = new Worker('/stockfish/stockfish-17.1-lite-single.js')
        const onMessage = (e) => {
            const msg = e.data
            if (msg === "uciok") {
                sf.postMessage("setoption name MultiPV value 1")
                currentMultiPV = 1
                sf.postMessage("setoption name Hash value 64")
                sf.postMessage("ucinewgame")
                sf.postMessage("isready")
            }
            if (msg === "readyok") {
                sf.removeEventListener("message", onMessage)
                resolve()
            }
        }
        sf.addEventListener("message", onMessage)
        sf.postMessage("uci")
    })
    await bookPromise

    sf.postMessage("position startpos")
    sf.postMessage("go depth 1")
}

export function cancelAnalysis() {
    analysisId++
    if (currentResolve) {
        currentResolve(null)
        currentResolve = null
    }
    sf.onmessage = null
    return new Promise((resolve) => {
        let resolved = false
        const absorber = (e) => {
            if (typeof e.data === 'string' && e.data.startsWith('bestmove')) {
                if (!resolved) {
                    resolved = true
                    sf.removeEventListener('message', absorber)
                    setTimeout(resolve, 10)
                }
            }
        }
        sf.addEventListener('message', absorber)
        sf.postMessage('stop')
        setTimeout(() => {
            if (!resolved) {
                resolved = true
                sf.removeEventListener('message', absorber)
                resolve()
            }
        }, 150)
    })
}

// ---- Book Move Lookup (Local) -----------------------------------------
function isBookMove(movesList, move, hasCustomRoot = false) {
    if (hasCustomRoot) return false
    if (!openingBookLoaded || openingBookMap.size === 0) return false
    const key = movesList.join(',')
    const bookMoves = openingBookMap.get(key)
    if (!bookMoves) return false
    return bookMoves.has(move)
}

const CASTLING_UCI_960_TO_STANDARD = {
    'e1h1': 'e1g1',
    'e1a1': 'e1c1',
    'e8h8': 'e8g8',
    'e8a8': 'e8c8',
}

function normalizeCastlingUci(uci) {
    return CASTLING_UCI_960_TO_STANDARD[uci] ?? uci
}

function normalizeLine(line) {
    return line.map(normalizeCastlingUci)
}

// ---- Sacrifice Detection (Static Exchange Evaluation) -------------------
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const ATTACKER_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 2 }

function parseFenBoard(fen) {
    return fen.split(' ')[0].split('/').map((row) => {
        const cells = []
        for (const ch of row) {
            if (/\d/.test(ch)) {
                for (let i = 0; i < Number(ch); i++) cells.push(null)
            } else {
                cells.push({
                    type: ch.toLowerCase(),
                    color: ch === ch.toUpperCase() ? 'w' : 'b'
                })
            }
        }
        return cells
    })
}

function squareToIndices(square) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0)
    const rank = Number(square[1])
    return { rankIndex: 8 - rank, file }
}

const KNIGHT_OFFSETS = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1]
]

const SLIDING_DIRECTIONS = {
    b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
    q: [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]],
}

function pieceAttacksSquare(board, fromRank, fromFile, toRank, toFile, piece) {
    const dr = toRank - fromRank
    const df = toFile - fromFile
    if (piece.type === 'k') return Math.abs(dr) <= 1 && Math.abs(df) <= 1 && (dr !== 0 || df !== 0)
    if (piece.type === 'n') return KNIGHT_OFFSETS.some(([or, of]) => or === dr && of === df)
    if (piece.type === 'p') {
        const dir = piece.color === 'w' ? -1 : 1
        return dr === dir && Math.abs(df) === 1
    }
    if (SLIDING_DIRECTIONS[piece.type]) {
        for (const [dR, dF] of SLIDING_DIRECTIONS[piece.type]) {
            let r = fromRank + dR, f = fromFile + dF
            while (r >= 0 && r < 8 && f >= 0 && f < 8) {
                if (r === toRank && f === toFile) return true
                if (board[r][f]) break
                r += dR
                f += dF
            }
        }
    }
    return false
}

function findAttackers(board, targetRank, targetFile, attackerColor, excludeSquare = null) {
    const attackers = []
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            if (excludeSquare && r === excludeSquare.rankIndex && f === excludeSquare.file) continue
            const piece = board[r][f]
            if (!piece || piece.color !== attackerColor || !ATTACKER_VALUES[piece.type]) continue
            if (pieceAttacksSquare(board, r, f, targetRank, targetFile, piece)) {
                attackers.push({ value: ATTACKER_VALUES[piece.type], type: piece.type })
            }
        }
    }
    return attackers
}

function resolveExchange(targetValue, attackerValues, defenderValues) {
    if (attackerValues.length === 0) return 0
    const [attackerValue, ...restAttackers] = attackerValues
    let value = targetValue
    if (defenderValues.length > 0) {
        value -= resolveExchange(attackerValue, defenderValues, restAttackers)
    }
    return Math.max(0, value)
}

function isSacrifice(beforeFen, afterFen, move) {
    if (!afterFen || !move) return false
    const board = parseFenBoard(afterFen)
    const { rankIndex, file } = squareToIndices(move.slice(2, 4))
    const piece = board[rankIndex][file]
    if (!piece || !PIECE_VALUES[piece.type] || piece.type === 'p') return false
    let capturedValue = 0
    if (beforeFen) {
        const beforeBoard = parseFenBoard(beforeFen)
        const targetPiece = beforeBoard[rankIndex][file]
        if (targetPiece && PIECE_VALUES[targetPiece.type]) capturedValue = PIECE_VALUES[targetPiece.type]
    }
    const opponentColor = piece.color === 'w' ? 'b' : 'w'
    let attackers = findAttackers(board, rankIndex, file, opponentColor)
    if (attackers.length === 0) return false
    const defenders = findAttackers(board, rankIndex, file, piece.color, { rankIndex, file })
    if (defenders.length > 0) {
        attackers = attackers.filter(a => a.type !== 'k')
        if (attackers.length === 0) return false
    }
    attackers.sort((a, b) => a.value - b.value)
    defenders.sort((a, b) => a.value - b.value)
    const opponentBestResponse = resolveExchange(
        PIECE_VALUES[piece.type],
        attackers.map(a => a.value),
        defenders.map(d => d.value)
    )
    return (capturedValue - opponentBestResponse) < 0
}

function isHangingCapture(beforeFen, move) {
    if (!beforeFen || !move) return false
    const board = parseFenBoard(beforeFen)
    const { rankIndex, file } = squareToIndices(move.slice(2, 4))
    const capturedPiece = board[rankIndex][file]
    if (!capturedPiece || !PIECE_VALUES[capturedPiece.type]) return false
    const defenders = findAttackers(board, rankIndex, file, capturedPiece.color)
    return defenders.length === 0
}

// ---- Engine Search ------------------------------------------------------
function analyzePosition(moves, depth, onUpdate = null, multiPV = 1, rootFen = null) {
    const myId = analysisId
    const effectiveRoot = (rootFen && rootFen !== STARTPOS_FEN) ? rootFen : null
    const cacheKey = `${effectiveRoot ?? 'startpos'}|${moves.join(",")}|${depth}|${multiPV}`
    if (localEvalCache.has(cacheKey)) {
        const cachedResult = localEvalCache.get(cacheKey)
        if (cachedResult) {
            if (cachedResult.evaluation) ensureScoreFields(cachedResult.evaluation)
            if (cachedResult.topMoves) {
                for (const m of cachedResult.topMoves) {
                    if (m?.score) ensureScoreFields(m.score)
                }
            }
            if (onUpdate) {
                onUpdate({
                    evaluation: cachedResult.evaluation,
                    topMoves: cachedResult.topMoves,
                    currentDepth: cachedResult.currentDepth || depth
                })
            }
        }
        return Promise.resolve(cachedResult)
    }
    return new Promise((resolve) => {
        currentResolve = resolve
        let topMoves = [], evaluation = null
        const rootSideIsWhite = effectiveRoot ? effectiveRoot.split(' ')[1] !== 'b' : true
        const isBlackToMove = rootSideIsWhite ? (moves.length % 2 === 1) : (moves.length % 2 === 0)
        sf.onmessage = (e) => {
            if (analysisId !== myId) return
            const msg = e.data
            if (msg.includes("score")) {
                const mp = msg.match(/multipv (\d+)/)
                const depthMatch = msg.match(/\bdepth (\d+)\b/)
                const cp = msg.match(/score cp (-?\d+)/)
                const mate = msg.match(/score mate (-?\d+)/)

                let score = cp ? { type: "cp", value: parseInt(cp[1]) } : mate ? { type: "mate", value: parseInt(mate[1]) } : null

                if (score) {
                    if (isBlackToMove) score.value = -score.value
                    score.Centipawn = score.type === "cp" ? score.value : null
                    score.Mate = score.type === "mate" ? score.value : null

                    if (!mp || mp[1] === "1") evaluation = score

                    if (msg.includes("pv")) {
                        const pv = msg.match(/ pv (.+)/)
                        if (pv) {
                            const info = {
                                Move: pv[1].split(" ")[0],
                                Centipawn: score.Centipawn,
                                Mate: score.Mate,
                                score,
                                line: pv[1].split(" ")
                            }
                            if (mp) topMoves[parseInt(mp[1]) - 1] = info
                            else topMoves[0] = info
                        }
                    }

                    const mpNum = mp ? parseInt(mp[1]) : 1
                    const currentDepth = depthMatch ? parseInt(depthMatch[1]) : 0
                    const isLastLine = mpNum === multiPV
                    const hasOnlyOneLine = mpNum === 1 && topMoves.length < 2 && multiPV >= 2
                    const hasOnlyTwoLines = mpNum === 2 && topMoves.length < 3 && multiPV >= 3

                    if (onUpdate && evaluation && currentDepth >= 10 && (isLastLine || hasOnlyOneLine || hasOnlyTwoLines)) {
                        onUpdate({ evaluation: { ...evaluation }, topMoves: [...topMoves], currentDepth })
                    }
                }
            }
            if (msg.startsWith("bestmove")) {
                sf.onmessage = null
                currentResolve = null
                const result = { evaluation, topMoves, best11: null, currentDepth: depth }
                localEvalCache.set(cacheKey, result)
                localEvalDirty = true
                schedulePersist()
                resolve(result)
            }
        }
        if (currentMultiPV !== multiPV) {
            sf.postMessage(`setoption name MultiPV value ${multiPV}`)
            currentMultiPV = multiPV
        }
        const posCommand = effectiveRoot ?
            (moves.length > 0 ? `position fen ${effectiveRoot} moves ${moves.join(" ")}` : `position fen ${effectiveRoot}`) :
            (moves.length > 0 ? `position startpos moves ${moves.join(" ")}` : "position startpos")
        sf.postMessage(posCommand)
        sf.postMessage(`go depth ${depth}`)
    })
}

// ---- Classification (expected points) -----------------------------------
// Score is always from White's point of view. These helpers turn it into
// the mover's point of view.
const WIN_CURVE_K = 0.00368208 // Lichess win-chance curve (chess.com's is not public)

// Points lost (0 to 1) limits. Change these to tune.
const LIMIT_BEST = 0.005
const LIMIT_EXCELLENT = 0.02
const LIMIT_GOOD = 0.05
const LIMIT_INACCURACY = 0.10
const LIMIT_MISTAKE = 0.20

// Great / Brilliant limits
const GREAT_MIN_GAP = 0.10        // best move must beat 2nd best by this much win chance
const BRILLIANT_MAX_BEFORE = 0.85 // not already winning big
const BRILLIANT_MIN_AFTER = 0.40  // position must not get bad
const BRILLIANT_MAX_DROP = 0.10   // must not lose much win chance

function scoreToCpComparable(score) {
    if (!score) return 0
    if (score.type === 'cp') return score.value
    if (score.type === 'mate') {
        const mateIn = Math.abs(score.value)
        return score.value > 0 ? (10000 - mateIn * 100) : (-10000 + mateIn * 100)
    }
    return 0
}

function toMoverCp(score, moverIsWhite) {
    const cp = scoreToCpComparable(score)
    return moverIsWhite ? cp : -cp
}

// Win chance (0 to 1) for the mover. Mate scores end up near 0 or 1.
function winChance(score, moverIsWhite) {
    if (!score) return 0.5
    const cp = Math.max(-1500, Math.min(1500, toMoverCp(score, moverIsWhite)))
    return 1 / (1 + Math.exp(-WIN_CURVE_K * cp))
}

function classifyByPoints(lost) {
    if (lost <= LIMIT_BEST) return "best"
    if (lost <= LIMIT_EXCELLENT) return "excellent"
    if (lost <= LIMIT_GOOD) return "good"
    if (lost <= LIMIT_INACCURACY) return "inaccuracy"
    if (lost <= LIMIT_MISTAKE) return "mistake"
    return "blunder"
}

function checkBrilliant({ isBest, isBook, isSac, eval_before, eval_after, moverIsWhite, movesList, move }) {
    if (!isBest || isBook || !isSac) return false
    if (!eval_before || !eval_after) return false
    const winBefore = winChance(eval_before, moverIsWhite)
    const winAfter = winChance(eval_after, moverIsWhite)
    if (winBefore > BRILLIANT_MAX_BEFORE) return false
    if (winAfter < BRILLIANT_MIN_AFTER) return false
    if (winAfter < winBefore - BRILLIANT_MAX_DROP) return false
    if (movesList && movesList.length > 0) {
        const opponentLastMove = movesList[movesList.length - 1]
        if (opponentLastMove.slice(2, 4) === move.slice(2, 4)) return false // recapture
    }
    return true
}

// ---- Main: Evaluate One Move --------------------------------------------
export async function getEvaluation(move, movesList, depth, onUpdate = null, beforeFen = null, afterFen = null, rootFen = null, multiPV = 1, deliversMate = false, deliversStalemate = false) {
    const myId = analysisId
    const hasCustomRoot = !!(rootFen && rootFen !== STARTPOS_FEN)
    const afterMoves = move ? [...movesList, move] : movesList
    const rootSideIsWhite = hasCustomRoot ? (rootFen.split(' ')[1] !== 'b') : true
    const moverIsWhite = rootSideIsWhite ? (afterMoves.length % 2 === 1) : (afterMoves.length % 2 === 0)

    // The game ended with this move (checkmate or stalemate): the engine gives no score.
    if (deliversMate || deliversStalemate) {
        // "Before" uses the same depth and MultiPV 1, so it is usually a cache hit.
        const before = await analyzePosition(movesList, depth, null, 1, rootFen)
        if (analysisId !== myId) return null
        let accuracy = "none"
        let eval_after = null
        if (move) {
            if (deliversMate) {
                accuracy = "best"
            } else {
                eval_after = ensureScoreFields({ type: "cp", value: 0 })
                const mine = before?.evaluation ? toMoverCp(before.evaluation, moverIsWhite) : 0
                const lost = Math.max(0, winChance(before?.evaluation, moverIsWhite) - 0.5)
                // Clearly losing (down 3 pawns or more) and saved with stalemate = great
                accuracy = mine <= -300 ? "great" : classifyByPoints(lost)
            }
        }
        const result = {
            depth, move_played: move, best_move: before?.topMoves?.[0]?.Move ?? "", eval: eval_after,
            excellent_eval: null, third_eval: null, move_accuracy: accuracy, is_sacrifice: false,
            best_line: [], excellent_line: [], third_line: [], moves_list: afterMoves,
        }
        if (onUpdate) onUpdate(result)
        return result
    }

    const isBook = isBookMove(movesList, move, hasCustomRoot)

    // "Before" position: same depth, MultiPV 1.
    // It is the same search as the previous move's "after" when MultiPV is 1, so it is cached.
    const before = await analyzePosition(movesList, depth, null, 1, rootFen)
    if (analysisId !== myId || !before) return null
    const eval_before = before.evaluation
    const best_move = before.topMoves?.[0]?.Move ?? ""
    const isBest = !!move && best_move === move

    // Extra checks only when the best move was played
    let is_sacrifice = false
    let isGreat = false
    if (isBest && !isBook) {
        is_sacrifice = isSacrifice(beforeFen, afterFen, move)
        const opponentLastMove = movesList.length > 0 ? movesList[movesList.length - 1] : null
        const isSimpleRecapture = !!opponentLastMove && opponentLastMove.slice(2, 4) === move.slice(2, 4)
        const isFreeCapture = isHangingCapture(beforeFen, move)
        if (!isSimpleRecapture && !isFreeCapture) {
            // Small extra search to see the 2nd best move (needs MultiPV 2).
            // We compare both lines from this same search, so the depth matches.
            const top2Result = await analyzePosition(movesList, 10, null, 2, rootFen)
            if (analysisId !== myId) return null
            const t = top2Result?.topMoves || []
            if (t[0]?.score && t[1]?.score) {
                const gap = winChance(t[0].score, moverIsWhite) - winChance(t[1].score, moverIsWhite)
                isGreat = gap >= GREAT_MIN_GAP
            }
        }
    }

    function buildResult(eval_after, topMovesAfter, currentDepth) {
        let accuracy = "none"
        if (move) {
            if (isBook) {
                accuracy = "book"
            } else if (isBest) {
                if (checkBrilliant({ isBest, isBook, isSac: is_sacrifice, eval_before, eval_after, moverIsWhite, movesList, move })) accuracy = "brilliant"
                else accuracy = isGreat ? "great" : "best"
            } else if (eval_after) {
                const lost = Math.max(0, winChance(eval_before, moverIsWhite) - winChance(eval_after, moverIsWhite))
                accuracy = classifyByPoints(lost)
            }
        }
        return {
            depth: currentDepth, move_played: move, best_move, eval: eval_after,
            excellent_eval: topMovesAfter[1]?.score ?? null, third_eval: topMovesAfter[2]?.score ?? null,
            move_accuracy: accuracy, is_sacrifice: isBest ? is_sacrifice : false,
            best_line: topMovesAfter[0]?.line ?? [],
            excellent_line: topMovesAfter[1]?.line ?? [],
            third_line: topMovesAfter[2]?.line ?? [],
            moves_list: afterMoves,
        }
    }

    const afterFinal = await analyzePosition(
        afterMoves, depth,
        onUpdate ? (data) => onUpdate(buildResult(data.evaluation, data.topMoves, data.currentDepth)) : null,
        multiPV, rootFen
    )
    if (!afterFinal) return null
    return buildResult(afterFinal.evaluation, afterFinal.topMoves, depth)
}