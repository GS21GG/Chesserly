// assets/useSound.js
// Move sounds: loading, unlocking and playing.
import { ref } from 'vue'
import moveSfx from './sounds/move.mp3'
import captureSfx from './sounds/capture.mp3'
import checkSfx from './sounds/check.mp3'
import castleSfx from './sounds/castle.mp3'
import promoteSfx from './sounds/promote.mp3'
import gameStartSfx from './sounds/game-start.mp3'
import gameEndSfx from './sounds/game-end.mp3'
import illegalSfx from './sounds/illegal.mp3'

// isGameOver: a function that tells us if the game just ended
export function useSound({ isGameOver = () => false } = {}) {
  const soundOn = ref(true)
  const soundUrls = {
    move: moveSfx, capture: captureSfx, check: checkSfx, castle: castleSfx, promote: promoteSfx,
    'game-start': gameStartSfx, 'game-end': gameEndSfx, illegal: illegalSfx
  }
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

    // game over (mate, stalemate, draw): play the end sound instead of the check sound
    if (isGameOver()) {
      setTimeout(() => playSound('game-end'), 250)
    } else if (isCheck) {
      setTimeout(() => playSound('check'), 120)
    }
  }

  return { soundOn, loadSounds, unlockAudio, playSound, soundForLastMove }
}