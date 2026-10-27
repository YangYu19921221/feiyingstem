import type { CSSProperties } from 'react';
import BookJacket, { type BookJacketBook } from './BookJacket';
import { shelfRatioOf } from '../../utils/bookJacket';

/**
 * 学生首页「我的书架 / 更多书籍」: 书立在木板上,一排一块板。
 *
 * 每排几本按屏宽定(手机 2、平板 4、电脑 5、宽屏 6),一本书在哪个尺寸下都在 136–210px 宽之间,
 * 书名字号因此可以写死,不用容器查询(iPad Air 1 / iOS 12 也要能看)。
 * 按排切开是为了每排底下画一整块板;最后一排没放满,板也是整条的。
 */

function rowsOf<T>(list: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

const rowStyle = (cols: number): CSSProperties => ({ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` });

export default function BookShelf<T extends BookJacketBook>({ books, cols, variant = 'shelf', onOpen }: {
  books: T[];
  cols: number;
  variant?: 'shelf' | 'locked';
  onOpen: (book: T) => void;
}) {
  return (
    <div className="book-shelf">
      {rowsOf(books, cols).map((row, r) => (
        <div className="book-shelf-tier" key={r}>
          <div className="book-shelf-row" style={rowStyle(cols)}>
            {row.map((book, i) => (
              <button
                type="button"
                key={book.id}
                className="book-shelf-item"
                style={{ '--i': Math.min(r * cols + i, 12) } as CSSProperties}
                onClick={() => onOpen(book)}
              >
                <BookJacket book={book} variant={variant} ratio={shelfRatioOf(book.name)} />
              </button>
            ))}
          </div>
          <div className="book-shelf-plank" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

/** 加载中: 一排浅色书影 + 木板,和真书架同一个尺寸,加载完不跳 */
export function BookShelfSkeleton({ cols }: { cols: number }) {
  const ratios = ['133.33%', '125.33%', '129.33%', '133.33%', '125.33%', '129.33%'];
  return (
    <div className="book-shelf" aria-busy="true" aria-label="书架加载中">
      <div className="book-shelf-tier">
        <div className="book-shelf-row" style={rowStyle(cols)}>
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="book-shelf-ghost" style={{ paddingTop: ratios[i % ratios.length] }} />
          ))}
        </div>
        <div className="book-shelf-plank" aria-hidden="true" />
      </div>
    </div>
  );
}
