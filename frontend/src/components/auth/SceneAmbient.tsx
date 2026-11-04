import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { SceneId } from './loginScenes';

/**
 * 每天场景里会动的小东西: 周一粉笔灰、周二纸飞机、周三星星和流星、周四气泡、周五云、周六蝴蝶和花瓣、周日萤火虫。
 * 背景图本身不动(11-04 用户定: 背景不要乱动,图上的小动画可以)。
 * 只动 transform / opacity;位置写死(不随机),每次打开一样。系统设了「减少动态效果」时 CSS 里全部停下
 */
type Dot = [left: number, top: number, size: number, delay: number, dur: number];

const v = (d: Dot): CSSProperties => ({
  left: `${d[0]}%`, top: `${d[1]}%`, width: d[2], height: d[2],
  animationDelay: `${d[3]}s`, animationDuration: `${d[4]}s`,
});
/** 上下穿过整个画面的(气泡往上、花瓣往下): 外层是和画面一样高的「轨道」,只动 transform 的百分比,和画面多高无关 */
const track = (d: Dot): CSSProperties => ({ left: `${d[0]}%`, animationDelay: `${d[3]}s`, animationDuration: `${d[4]}s` });
const size = (d: Dot): CSSProperties => ({ width: d[2], height: d[2], animationDelay: `${d[3] * 0.7}s` });

const DUST: Dot[] = [[8, 18, 4, 0, 11], [16, 34, 3, 2.5, 13], [24, 12, 5, 5, 12], [32, 40, 3, 1.2, 14], [12, 52, 4, 7, 12], [38, 24, 3, 3.8, 15], [5, 30, 3, 9, 13]];
const STARS: Dot[] = [
  [6, 30, 3, 0, 3.2], [14, 46, 2, 1.1, 2.6], [22, 26, 3, 0.4, 3.8], [31, 54, 2, 2.2, 2.9], [38, 36, 3, 1.6, 3.4],
  [47, 22, 2, 0.8, 2.7], [55, 58, 3, 2.9, 3.6], [62, 30, 2, 0.2, 3.1], [70, 48, 3, 1.9, 2.8], [78, 64, 2, 1.3, 3.5],
  [86, 40, 3, 0.6, 3.0], [93, 56, 2, 2.4, 3.3], [9, 64, 2, 1.7, 2.9], [44, 70, 2, 0.9, 3.7], [67, 72, 2, 2.6, 3.2],
  [27, 8, 2, 1.4, 3.0], [58, 12, 3, 0.3, 2.6], [88, 18, 2, 2.0, 3.4],
];
const BUBBLES: Dot[] = [
  [8, 0, 10, 0, 9], [15, 0, 6, 3.2, 8], [27, 0, 14, 1.4, 11], [36, 0, 8, 5.5, 9.5], [48, 0, 12, 2.4, 10.5],
  [57, 0, 7, 6.8, 8.5], [66, 0, 16, 0.8, 12], [74, 0, 9, 4.4, 9], [83, 0, 11, 2.9, 10], [91, 0, 7, 7.6, 8.8],
];
const FIREFLIES: Dot[] = [[12, 38, 6, 0, 7], [24, 62, 5, 2.1, 8], [40, 30, 6, 4.3, 9], [52, 66, 5, 1.2, 7.5], [64, 44, 6, 3.4, 8.5], [76, 70, 5, 5.2, 7], [86, 34, 6, 0.7, 9.5], [33, 50, 4, 6.1, 8]];
const PETALS: Dot[] = [[10, 0, 12, 0, 13], [28, 0, 10, 4, 15], [46, 0, 13, 8, 14], [62, 0, 10, 2, 16], [78, 0, 12, 6, 13], [90, 0, 9, 10, 15]];

function SceneAmbient({ id }: { id: SceneId }) {
  return (
    <div className={`fx fx-${id}`} aria-hidden="true">
      {id === 'mon' && DUST.map((d, i) => <span key={i} className="fx-dust" style={v(d)} />)}

      {id === 'tue' && (
        <span className="fx-plane-track">
          <svg className="fx-plane" viewBox="0 0 64 40">
            <path d="M2 22 L62 4 L30 36 L26 24 Z" fill="#fffdf6" stroke="#23426e" strokeWidth="2" strokeLinejoin="round" />
            <path d="M26 24 L62 4 M26 24 L22 34 L30 36" fill="none" stroke="#23426e" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </span>
      )}

      {id === 'wed' && (
        <>
          {STARS.map((d, i) => <span key={i} className="fx-star" style={v(d)} />)}
          <span className="fx-shooting" />
        </>
      )}

      {id === 'thu' && BUBBLES.map((d, i) => (
        <span key={i} className="fx-track fx-bubble-track" style={track(d)}>
          <span className="fx-bubble" style={size(d)} />
        </span>
      ))}

      {id === 'fri' && (
        <>
          <span className="fx-cloud-track fx-cloud-a"><span className="fx-cloud" /></span>
          <span className="fx-cloud-track fx-cloud-b"><span className="fx-cloud" /></span>
        </>
      )}

      {id === 'sat' && (
        <>
          {PETALS.map((d, i) => (
            <span key={i} className="fx-track fx-petal-track" style={track(d)}>
              <span className="fx-petal" style={size(d)} />
            </span>
          ))}
          {[0, 1].map((i) => (
            <span key={i} className={`fx-butterfly fx-butterfly-${i}`}>
              <svg viewBox="0 0 40 30">
                <g className="fx-wing fx-wing-l"><path d="M20 15 C 10 0, 0 4, 4 14 C 0 22, 10 28, 20 17 Z" /></g>
                <g className="fx-wing fx-wing-r"><path d="M20 15 C 30 0, 40 4, 36 14 C 40 22, 30 28, 20 17 Z" /></g>
                <path d="M20 9 L20 22" stroke="#5a3a1a" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          ))}
        </>
      )}

      {id === 'sun' && FIREFLIES.map((d, i) => <span key={i} className="fx-firefly" style={v(d)} />)}
    </div>
  );
}

export default memo(SceneAmbient);
