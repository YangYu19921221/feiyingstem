import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { teacherAssignments } from '../../api/teacherAssignments';
import type { ScopeType } from '../../api/teacherAssignments';

export interface ScopeValue {
  scope_type: ScopeType;
  book_id: number | null;
  unit_id?: number | null;
  group_index?: number | null;
  // 单元粒度多选(multiUnit 模式):选中的全部单元;unit_id 保持为第一个以兼容旧逻辑
  unit_ids?: number[];
}

interface BookOption {
  id: number;
  name: string;
  /** 教材版本(人教版/苏教版/自定义…),调用方数据源带上即启用版本筛选 */
  series?: string | null;
}

interface Props {
  books: BookOption[];
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  allowBook?: boolean;
  /** 单元粒度支持多选(分配页用);作业等单单元场景不传,保持单选 */
  multiUnit?: boolean;
}

export function ScopeSelector({ books, value, onChange, allowBook = true, multiUnit = false }: Props) {
  const bookId = value.book_id;

  // 单词本 combobox:书多了下拉难翻(机构自建+平台共享几十本),输入即时过滤浮出候选
  const selectedBook = bookId != null ? books.find((b) => b.id === bookId) : null;
  const [bookSearch, setBookSearch] = useState(selectedBook?.name ?? '');
  const [bookOpen, setBookOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const comboRef = useRef<HTMLDivElement>(null);

  // 教材版本筛选:books 数据源带 series 时才显示下拉,与文字搜索叠加
  const [seriesFilter, setSeriesFilter] = useState('');
  const seriesOptions = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => { if (b.series) set.add(b.series); });
    return Array.from(set);
  }, [books]);

  const filteredBooks = useMemo(() => {
    const kw = bookSearch.trim().toLowerCase();
    let list = books;
    if (seriesFilter) list = list.filter((b) => b.series === seriesFilter);
    // 输入框还是选中书名原文时(刚聚焦未改动),展示全部候选而非只剩它自己
    if (!kw || (selectedBook && bookSearch === selectedBook.name)) return list;
    return list.filter((b) => b.name.toLowerCase().includes(kw));
  }, [books, bookSearch, selectedBook, seriesFilter]);

  // 列表收起时输入框始终回显选中书名(外部切书/清空也同步)
  useEffect(() => {
    if (!bookOpen) setBookSearch(selectedBook?.name ?? '');
  }, [bookOpen, selectedBook]);

  // 候选变化后高亮复位,避免越界
  useEffect(() => {
    setHighlight(-1);
  }, [bookSearch]);

  // 点击组件外部收起列表(输入框文字由上面的 effect 恢复为选中书名)
  useEffect(() => {
    if (!bookOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setBookOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [bookOpen]);

  const selectBook = (b: BookOption) => {
    onChange({ scope_type: 'book', book_id: b.id, unit_id: null, group_index: null, unit_ids: [] });
    setBookSearch(b.name);
    setBookOpen(false);
  };

  const clearBook = () => {
    onChange({ scope_type: 'book', book_id: null, unit_id: null, group_index: null, unit_ids: [] });
    setBookSearch('');
    setBookOpen(false);
  };

  const onBookKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setBookOpen(true);
      setHighlight((h) => Math.min(h + 1, filteredBooks.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (bookOpen && highlight >= 0 && highlight < filteredBooks.length) {
        e.preventDefault();
        selectBook(filteredBooks[highlight]);
      }
    } else if (e.key === 'Escape') {
      setBookOpen(false);
    }
  };

  // 当前选中的单元集合(多选模式);单选模式退化为 0/1 个
  const selectedUnitIds: number[] = value.unit_ids ?? (value.unit_id != null ? [value.unit_id] : []);

  const { data: units = [] } = useQuery({
    queryKey: ['book-units', bookId],
    queryFn: () => teacherAssignments.listBookUnits(bookId!),
    enabled: !!bookId,
  });

  // 分组细化仅在恰好选中 1 个单元时可用(多选多个单元时按整单元分配)
  const soloUnitId = selectedUnitIds.length === 1 ? selectedUnitIds[0] : null;

  const { data: groups = [] } = useQuery({
    queryKey: ['unit-groups', soloUnitId],
    queryFn: () => teacherAssignments.listUnitGroups(soloUnitId!),
    enabled: !!soloUnitId && (value.scope_type === 'group' || value.scope_type === 'unit'),
  });

  // 切书时清下游:选中的单元不属于当前书 → 重置为整本
  useEffect(() => {
    if (
      value.scope_type !== 'book' &&
      selectedUnitIds.length > 0 &&
      units.length > 0 &&
      selectedUnitIds.some((uid) => !units.find((u) => u.id === uid))
    ) {
      onChange({ scope_type: 'book', book_id: bookId, unit_id: null, group_index: null, unit_ids: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, units]);

  /** 多选模式:切换某个单元的选中状态 */
  const toggleUnit = (uid: number) => {
    const next = selectedUnitIds.includes(uid)
      ? selectedUnitIds.filter((id) => id !== uid)
      : [...selectedUnitIds, uid];
    onChange({
      scope_type: next.length > 0 ? 'unit' : 'book',
      book_id: bookId,
      unit_id: next[0] ?? null,
      unit_ids: next,
      group_index: null,
    });
  };

  /** 单选模式:选中单个单元(旧行为) */
  const selectSingleUnit = (uid: number) => {
    onChange({
      scope_type: 'unit',
      book_id: bookId,
      unit_id: uid,
      unit_ids: [uid],
      group_index: null,
    });
  };

  const selectAllUnits = () => {
    const all = units.map((u) => u.id);
    onChange({
      scope_type: all.length > 0 ? 'unit' : 'book',
      book_id: bookId,
      unit_id: all[0] ?? null,
      unit_ids: all,
      group_index: null,
    });
  };

  const clearUnits = () => {
    onChange({ scope_type: 'book', book_id: bookId, unit_id: null, group_index: null, unit_ids: [] });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium">单词本</label>
          {seriesOptions.length >= 2 && (
            <select
              value={seriesFilter}
              onChange={(e) => { setSeriesFilter(e.target.value); setBookOpen(true); }}
              className="text-xs border rounded px-1.5 py-0.5 text-gray-600"
              title="按教材版本筛选"
            >
              <option value="">全部版本</option>
              {seriesOptions.map((sn) => (
                <option key={sn} value={sn}>{sn}</option>
              ))}
            </select>
          )}
        </div>
        <div ref={comboRef} className="relative">
          <input
            type="text"
            value={bookSearch}
            onChange={(e) => {
              setBookSearch(e.target.value);
              setBookOpen(true);
            }}
            onFocus={(e) => {
              setBookOpen(true);
              // 已有选中书时全选文本,方便直接输入重新搜索
              if (selectedBook) e.target.select();
            }}
            onKeyDown={onBookKeyDown}
            placeholder="🔍 搜索并选择单词本…"
            className="w-full border rounded px-3 py-2 pr-8 placeholder:text-gray-400"
          />
          {selectedBook && (
            <button
              type="button"
              onClick={clearBook}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm px-1"
              title="清除选择"
            >
              ✕
            </button>
          )}
          {bookOpen && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded shadow max-h-60 overflow-y-auto">
              {filteredBooks.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-400">没有匹配的单词本</div>
              ) : (
                filteredBooks.map((b, i) => (
                  <div
                    key={b.id}
                    onMouseDown={(e) => {
                      // mousedown 抢在外部点击监听/失焦之前完成选中
                      e.preventDefault();
                      selectBook(b);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`px-3 py-2 text-sm cursor-pointer ${
                      i === highlight ? 'bg-orange-50' : ''
                    } ${b.id === bookId ? 'font-medium' : ''}`}
                  >
                    {b.name}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {bookId && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">
              范围
              {multiUnit && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  单元可多选{selectedUnitIds.length > 0 && ` · 已选 ${selectedUnitIds.length} 个`}
                </span>
              )}
            </label>
            {multiUnit && units.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllUnits}
                  className="text-xs text-orange-600 hover:text-orange-700"
                >
                  全选单元
                </button>
                {selectedUnitIds.length > 0 && (
                  <button
                    type="button"
                    onClick={clearUnits}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    清空
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {allowBook && (
              <button
                type="button"
                onClick={clearUnits}
                className={`px-3 py-1 rounded border text-sm ${
                  value.scope_type === 'book'
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white hover:bg-orange-50'
                }`}
              >
                整本
              </button>
            )}
            {units.map((u) => {
              const isSelected = value.scope_type !== 'book' && selectedUnitIds.includes(u.id);
              return (
                <div key={u.id} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => (multiUnit ? toggleUnit(u.id) : selectSingleUnit(u.id))}
                    className={`px-3 py-1 rounded border text-sm ${
                      isSelected
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white hover:bg-orange-50'
                    }`}
                  >
                    {multiUnit && isSelected && '✓ '}
                    {u.name}（{u.group_count}组）
                  </button>
                  {/* 分组细化:仅当恰好选中这 1 个单元时显示 */}
                  {isSelected && soloUnitId === u.id && (
                    <div className="ml-3 mt-1 flex gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            scope_type: 'unit',
                            book_id: bookId,
                            unit_id: u.id,
                            unit_ids: [u.id],
                            group_index: null,
                          })
                        }
                        className={`px-2 py-0.5 text-xs rounded border ${
                          value.scope_type === 'unit'
                            ? 'bg-amber-300 border-amber-400'
                            : 'bg-white hover:bg-amber-50'
                        }`}
                      >
                        整单元
                      </button>
                      {groups.map((g) => (
                        <button
                          type="button"
                          key={g.index}
                          onClick={() =>
                            onChange({
                              scope_type: 'group',
                              book_id: bookId,
                              unit_id: u.id,
                              unit_ids: [u.id],
                              group_index: g.index,
                            })
                          }
                          className={`px-2 py-0.5 text-xs rounded border ${
                            value.scope_type === 'group' && value.group_index === g.index
                              ? 'bg-amber-400 border-amber-500'
                              : 'bg-white hover:bg-amber-50'
                          }`}
                        >
                          第{g.index}组（{g.word_count}词）
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {multiUnit && selectedUnitIds.length > 1 && (
            <p className="mt-2 text-xs text-gray-500">
              已选 {selectedUnitIds.length} 个单元,将按整单元分别分配(多选时不支持分组细化)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
