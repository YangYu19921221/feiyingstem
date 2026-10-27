import { memo, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { jacketOf, SMALL_EM, SMALL_GAP_EM, type JacketBook } from '../../utils/bookJacket';

/**
 * 书架上的一本书: 书脊 + 纸片层封面 + 书名印在封面上(规则见 utils/bookJacket)。
 *
 * - shelf: 我的书架。在学的书插一根书签带,学完的盖「学完」章,底边是进度条
 * - locked: 更多书籍(还没兑换)。褪色 + 「输入兑换码」
 * - mini: 调整顺序 / 作业列表的小图,只有封面不排字(书名在旁边)
 *
 * 有 cover_url(老师传的封面)就用那张图当天空,书名那层照样压在下面;图坏了退回画的封面。
 * 外层可点的元素由调用方给(button),这里只画书。
 */

export interface BookJacketBook extends JacketBook {
  unit_count?: number;
  word_count?: number;
  progress_percentage?: number;
}

type Variant = 'shelf' | 'locked' | 'mini';

const MARK_FONT = "'JacketMark', 'Arial Rounded MT Bold', system-ui, sans-serif";
const CJK_FONT = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
const MARK_X = 40;
const MARK_CY = 118;

function BookJacket({ book, variant = 'shelf', className = '', ratio = '133.33%' }: {
  book: BookJacketBook;
  variant?: Variant;
  className?: string;
  /** 高 / 宽,写成 padding-top 百分比(书架上每本高矮略不同,见 shelfRatioOf) */
  ratio?: string;
}) {
  const { id, name, series } = book;
  const j = useMemo(() => jacketOf({ id, name, series }), [id, name, series]);
  const [imageFailed, setImageFailed] = useState(false);
  const image = book.cover_url && !imageFailed ? book.cover_url : null;
  const { tone, mark } = j;

  const progress = Math.max(0, Math.min(100, book.progress_percentage ?? 0));
  const done = variant === 'shelf' && progress >= 100;
  const reading = variant === 'shelf' && progress > 0 && progress < 100;

  const fs = mark.size * 3; // 封面宽 300 个单位
  const small = fs * SMALL_EM;
  const gap = fs * SMALL_GAP_EM;
  const baseline = MARK_CY + fs * (mark.cjk ? 0.36 : 0.3);

  const markText = (fill: string, dx = 0, dy = 0) => (
    <text x={MARK_X + dx} y={baseline + dy} fill={fill} fontWeight={800}>
      {mark.prefix && <tspan fontFamily={CJK_FONT} fontSize={small}>{mark.prefix}</tspan>}
      <tspan
        dx={mark.prefix ? gap : 0}
        fontFamily={mark.cjk ? CJK_FONT : MARK_FONT}
        fontSize={fs}
        letterSpacing={mark.cjk ? 0 : -fs * 0.01}
      >
        {mark.main}
      </tspan>
      {mark.suffix && <tspan dx={gap} fontFamily={CJK_FONT} fontSize={small}>{mark.suffix}</tspan>}
    </text>
  );

  return (
    <div
      className={`book-jacket ${variant === 'mini' ? 'book-jacket-mini' : ''} ${variant === 'locked' ? 'book-jacket-locked' : ''} ${className}`}
    >
      {/* padding-top 的百分比按「包含块」的宽度算: 放在 flex 行里时包含块是整行,必须垫一层自己的 div */}
      <div style={{ paddingTop: ratio }} aria-hidden="true" />
      {variant !== 'mini' && <span className="book-jacket-pages" aria-hidden="true" />}
      <div className="book-jacket-cover" style={{ backgroundColor: tone.cover }}>
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <svg className="book-jacket-art" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {!image && (
            <>
              {/* 学完的书: 太阳换成「学完」金章,同一个位置 */}
              {!done && <circle cx={j.sun.cx} cy={j.sun.cy} r={j.sun.r} fill={tone.glow} />}
              <path d={j.backPath} fill={tone.back} />
              {markText(tone.markShadow, 4, 5)}
              {markText(tone.mark)}
            </>
          )}
          <path d={j.frontPath} fill={tone.front} />
          {reading && (
            <g>
              <path d="M232 0 H258 V74 L245 63 L232 74 Z" fill={tone.accent} />
              <path d="M232 0 H236 V71 L232 74 Z" fill="#000" opacity={0.14} />
            </g>
          )}
          {done && (
            <g transform="translate(252 208) rotate(-12)">
              <circle r={36} fill="#FFD23F" />
              <circle r={29} fill="none" stroke="#8A5300" strokeWidth={2} strokeDasharray="3 4" opacity={0.6} />
              <text y={9} textAnchor="middle" fill="#6B3A00" fontFamily={CJK_FONT} fontSize={24} fontWeight={800}>学完</text>
            </g>
          )}
        </svg>
        <span className="book-jacket-spine" aria-hidden="true" />
        <span className="book-jacket-sheen" aria-hidden="true" />

        {variant !== 'mini' && (
          <>
            {j.imprint && (
              <span
                className="book-jacket-imprint"
                style={{ color: tone.ink, borderColor: tone.light ? 'rgb(59 38 4 / 0.35)' : 'rgb(255 255 255 / 0.45)', backgroundColor: image ? tone.front : undefined }}
              >
                {j.imprint}
              </span>
            )}
            <div className="book-jacket-label" style={{ color: tone.ink }}>
              <span className="book-jacket-title" title={book.name}>{book.name}</span>
              {variant === 'locked' ? (
                <span className="book-jacket-row">
                  <span className="book-jacket-meta font-numeric">{book.word_count ?? 0} 词</span>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Lock className="h-[1em] w-[1em]" aria-hidden="true" />
                    输入兑换码
                  </span>
                </span>
              ) : (
                <span className="book-jacket-row">
                  {/* 书窄的时候(手机竖屏 / 平板四本一排)只写词数,单元数藏起来 */}
                  <span className="book-jacket-meta font-numeric">
                    <span className="book-jacket-units">{book.unit_count ?? 0} 单元 · </span>
                    {book.word_count ?? 0} 词
                  </span>
                  <span className="font-numeric font-semibold">
                    <span className="sr-only">学习进度 </span>
                    {done ? '学完了' : progress > 0 ? `${progress.toFixed(0)}%` : <span className="sr-only">0%</span>}
                  </span>
                </span>
              )}
            </div>
            {variant === 'shelf' && (
              <span
                className="book-jacket-progress"
                style={{ backgroundColor: tone.light ? 'rgb(59 38 4 / 0.16)' : 'rgb(0 0 0 / 0.28)' }}
                aria-hidden="true"
              >
                <span
                  className={done ? 'progress-gold' : ''}
                  style={{ width: `${progress}%`, backgroundColor: done ? undefined : tone.accent }}
                />
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(BookJacket);
