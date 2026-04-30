import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { teacherAssignments } from '../../api/teacherAssignments';
import type { ScopeType } from '../../api/teacherAssignments';

export interface ScopeValue {
  scope_type: ScopeType;
  book_id: number | null;
  unit_id?: number | null;
  group_index?: number | null;
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
}

export function ScopeSelector({ books, value, onChange, allowBook = true }: Props) {
  const bookId = value.book_id;

  const { data: units = [] } = useQuery({
    queryKey: ['book-units', bookId],
    queryFn: () => teacherAssignments.listBookUnits(bookId!),
    enabled: !!bookId,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['unit-groups', value.unit_id],
    queryFn: () => teacherAssignments.listUnitGroups(value.unit_id!),
    enabled: !!value.unit_id && (value.scope_type === 'group' || value.scope_type === 'unit'),
  });

  // 切书时清下游
  useEffect(() => {
    if (
      value.scope_type !== 'book' &&
      value.unit_id &&
      units.length > 0 &&
      !units.find((u) => u.id === value.unit_id)
    ) {
      onChange({ scope_type: 'book', book_id: bookId, unit_id: null, group_index: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, units]);

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
          <label className="block text-sm mb-1 font-medium">范围</label>
          <div className="flex gap-2 flex-wrap">
            {allowBook && (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    scope_type: 'book',
                    book_id: bookId,
                    unit_id: null,
                    group_index: null,
                  })
                }
                className={`px-3 py-1 rounded border text-sm ${
                  value.scope_type === 'book'
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white hover:bg-orange-50'
                }`}
              >
                整本
              </button>
            )}
            {units.map((u) => (
              <div key={u.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      scope_type: 'unit',
                      book_id: bookId,
                      unit_id: u.id,
                      group_index: null,
                    })
                  }
                  className={`px-3 py-1 rounded border text-sm ${
                    value.scope_type !== 'book' && value.unit_id === u.id
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white hover:bg-orange-50'
                  }`}
                >
                  {u.name}（{u.group_count}组）
                </button>
                {value.unit_id === u.id && value.scope_type !== 'book' && (
                  <div className="ml-3 mt-1 flex gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          scope_type: 'unit',
                          book_id: bookId,
                          unit_id: u.id,
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
