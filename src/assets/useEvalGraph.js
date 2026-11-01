// assets/useEvalGraph.js
// Evaluation history area chart (the graph in the Report tab).
import { ref, computed } from 'vue'
import { classificationMeta } from './accuracy.js'

export function useEvalGraph({ moveTree, currentNode, jumpToNode }) {
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

  return {
    evalHistory,
    graphHoverIdx,
    rebuildEvalHistory,
    evalGraphGeom,
    evalGraphClick,
    evalGraphHover,
    graphHoverData
  }
}