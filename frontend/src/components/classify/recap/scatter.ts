/**
 * 卡片池散落算法。
 *
 * 把矩形池切成 cols × rows 网格,每张卡 anchor 在格子中心,
 * 加 ±15% jitter + ±12° rotation。结构上是网格,视觉上是散落。
 *
 * @param n 卡片总数
 * @param layout: 'mobile'=3 cols, 'desktop'=4 cols, 'large'=5 cols
 * @param seed 可选随机种子,便于测试; 默认用 Math.random()
 */
export interface ScatteredCard {
  x: number       // 0-100 百分比
  y: number       // 0-100 百分比
  rotation: number // -12 ~ 12 度
  zIndex: number  // 1..n
}

export interface ScatterOptions {
  n: number
  layout: 'mobile' | 'desktop' | 'large'
  seed?: number
}

function mulberry32(seed: number) {
  let s = seed
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function scatter(opts: ScatterOptions): ScatteredCard[] {
  const { n, layout } = opts
  const rand = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random
  const cols = layout === 'mobile' ? 3 : layout === 'large' ? 5 : 4
  const rows = Math.max(1, Math.ceil(n / cols))
  const cards: ScatteredCard[] = []
  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const anchorX = ((col + 0.5) / cols) * 100
    const anchorY = ((row + 0.5) / rows) * 100
    const x = clamp(anchorX + (rand() - 0.5) * 30, 5, 95)
    const y = clamp(anchorY + (rand() - 0.5) * 30, 8, 92)
    const rotation = (rand() - 0.5) * 24
    cards.push({ x, y, rotation, zIndex: i + 1 })
  }
  return cards
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
