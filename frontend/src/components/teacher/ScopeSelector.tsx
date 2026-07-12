import { useEffect } from 'react';
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
        <label className="block text-sm mb-1 font-medium">单词本</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={bookId ?? ''}
          onChange={(e) =>
            onChange({
              scope_type: 'book',
              book_id: e.target.value ? Number(e.target.value) : null,
              unit_id: null,
              group_index: null,
              unit_ids: [],
            })
          }
        >
          <option value="">— 选择 —</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
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
