/**
 * 复习卡尺寸:高度固定,宽度随单词长度自适应。
 *
 * 卡面单词一律不换行(长词折行会竖着排,没法读)。宽度按字数估算:
 * text-xl(20px) 粗体显示字体的均字宽约 11.5px,加左右留白。
 * 桌面端池子宽,卡宽直接跟着单词走、不缩字号;手机竖屏池子约 340px 宽,
 * 卡最宽压在六成左右(拖拽仍有余地),顶到上限的超长词才等比缩字号保一行。
 * RecapCard 与 FlyingCardLayer(飞入篮子的过场卡)共用,保证松手瞬间视觉连续。
 */
export const CARD_H = 160
export const CARD_MIN_W = 120
export const CARD_MAX_W_MOBILE = 216
const PAD_X = 32
const CHAR_W = 11.5

const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768

/** 单词有多长,卡就有多宽(手机端封顶 216px,桌面端不封顶) */
export function cardWidthFor(word: string): number {
  const need = word.length * CHAR_W + PAD_X
  const width = isMobile() ? Math.min(CARD_MAX_W_MOBILE, need) : need
  return Math.round(Math.max(CARD_MIN_W, width))
}

/** 仅手机端:超出最大卡宽的超长词等比缩小字号保证仍是一行;其余返回 undefined 用默认 text-xl */
export function wordFontSizeFor(word: string): number | undefined {
  if (!isMobile()) return undefined
  const need = word.length * CHAR_W + PAD_X
  if (need <= CARD_MAX_W_MOBILE) return undefined
  return Math.max(12, Math.floor((20 * (CARD_MAX_W_MOBILE - PAD_X)) / (word.length * CHAR_W)))
}
