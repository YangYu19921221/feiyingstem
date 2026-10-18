/**
 * 音标视频手动排序 — 教师端弹层
 *
 * 学生端按「分类 → sort_order」分组展示,所以排序**按分类分开排**:
 * 跨分类挪位置没有意义(学生端它还是落在自己那组里)。
 *
 * 四个设计点:
 * 1. **拖动只认左边的抓手**(dragListener=false + dragControls)。整行可拖的话,
 *    平板上手指一碰列表就开始拖,老师没法上下滑动找视频
 * 2. 每行另有 ↑ ↓ 和「置顶」按钮:几十个视频从最底拖到最上很累,
 *    而且键盘/读屏用户拖不了(按钮就是无障碍的那条路)
 * 3. **攒着改、点「保存」才写**,不是每挪一下就请求一次:挪一个视频常要连挪好几格,
 *    逐格保存会让学生端看到中间态;关弹层时有没保存的改动要先确认
 * 4. 只排本机构自己的视频。平台预置的全平台共用一个 sort_order,
 *    一家机构挪它会改掉所有机构的顺序 —— 只在顶部说明它们排在最前面
 * 5. **一个分类有两位以上讲师时默认按讲师分开排**(2026-10-18 用户「两个老师是不是得分开,
 *    混在一起不好弄」): 每位老师只看到、只排自己的课,另一位的课位置不动(后端把这位讲师的课
 *    按新顺序填回她原来占的那几个位置)。学生选了某位老师就按这个顺序看。「全部混排」留着,
 *    管学生不选老师时看到的穿插顺序
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { ArrowDown, ArrowUp, ArrowUpToLine, GripVertical, ListOrdered, Loader2, X } from 'lucide-react';
import {
  phoneticsApi, CATEGORY_LABELS, NO_LECTURER,
  type PhoneticCategory, type PhoneticOrderItem,
} from '../../api/phonetics';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

interface Props {
  /** 打开时默认停在哪个分类(列表正在看的那个,没有就入门总览) */
  initialCategory?: PhoneticCategory;
  /** 打开时优先停在哪位讲师(列表页正在筛的那位;NO_LECTURER = 全校通用) */
  initialLecturer?: string;
  /** 保存成功后回调(父组件刷新列表) */
  onSaved: () => void;
  onClose: () => void;
}

const CATEGORIES = Object.entries(CATEGORY_LABELS) as [PhoneticCategory, string][];

const lecturerLabel = (name: string) => (name === NO_LECTURER ? '全校通用' : name);

interface RowProps {
  item: PhoneticOrderItem;
  index: number;
  count: number;
  /** 混排时每行写上是哪位讲师;按讲师分开排时不写(整列都是她的) */
  showLecturer: boolean;
  onMove: (from: number, to: number) => void;
}

/** 单独成组件:useDragControls 每行要一份 */
function Row({ item, index, count, showLecturer, onMove }: RowProps) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-2 py-2"
      whileDrag={{ scale: 1.01, boxShadow: '0 8px 24px rgba(0,0,0,0.10)', zIndex: 10 }}
    >
      <button
        type="button"
        aria-label={`拖动调整「${item.title}」的位置`}
        onPointerDown={(e) => { e.preventDefault(); controls.start(e); }}
        /* touch-none:不让浏览器把这次按下当成滚动手势吃掉 */
        className="cursor-grab touch-none rounded-lg p-1.5 text-ink-mute hover:bg-gray-100 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-7 shrink-0 text-right font-numeric text-sm font-semibold text-ink-soft">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${item.is_active ? 'text-ink' : 'text-ink-mute line-through'}`}>
          {item.title}
        </p>
        <p className="truncate text-xs text-ink-mute">
          {[item.phonetic_symbol, showLecturer ? item.lecturer : '', item.is_active ? '' : '已下架'].filter(Boolean).join(' · ') || ' '}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button" disabled={index === 0} onClick={() => onMove(index, 0)}
          aria-label={`「${item.title}」置顶`} title="置顶"
          className="rounded-lg p-1.5 text-ink-soft hover:bg-gray-100 disabled:opacity-30"
        >
          <ArrowUpToLine className="h-4 w-4" />
        </button>
        <button
          type="button" disabled={index === 0} onClick={() => onMove(index, index - 1)}
          aria-label={`「${item.title}」上移`} title="上移"
          className="rounded-lg p-1.5 text-ink-soft hover:bg-gray-100 disabled:opacity-30"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}
          aria-label={`「${item.title}」下移`} title="下移"
          className="rounded-lg p-1.5 text-ink-soft hover:bg-gray-100 disabled:opacity-30"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>
    </Reorder.Item>
  );
}

export default function ReorderDialog({ initialCategory, initialLecturer, onSaved, onClose }: Props) {
  const [category, setCategory] = useState<PhoneticCategory>(initialCategory || 'basic');
  // 现在排的是哪位讲师: null = 整个分类混排;打开/换分类时先拉一次,有两位以上讲师就默认分开排
  const [lecturer, setLecturer] = useState<string | null>(null);
  const [lecturers, setLecturers] = useState<Array<{ name: string; count: number }>>([]);
  // 换分类时尽量停在同一位讲师上;选过「全部混排」就记 null
  const preferredRef = useRef<string | null | undefined>(initialLecturer);
  // 连点讲师/分类时只认最后一次请求,免得慢的旧响应盖掉新列表
  const reqRef = useRef(0);
  const [items, setItems] = useState<PhoneticOrderItem[]>([]);
  /** 打开时的顺序,判「有没有没保存的改动」用 */
  const [origin, setOrigin] = useState<number[]>([]);
  const [presetCount, setPresetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty = items.length !== origin.length || items.some((v, i) => v.id !== origin[i]);
  // Esc / 遮罩关闭走同一个判断;监听里读 ref 拿最新值,不必每次改动重挂监听
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  /** lec: 讲师名 / null = 整个分类 / undefined = 自动(有两位以上讲师就分开排) */
  const load = useCallback(async (c: PhoneticCategory, lec: string | null | undefined) => {
    const my = ++reqRef.current;
    setLoading(true);
    try {
      let data = await phoneticsApi.orderList(c, lec);
      let chosen = lec ?? null;
      if (lec === undefined && data.lecturers.length >= 2 && preferredRef.current !== null) {
        const names = data.lecturers.map((l) => l.name);
        const want = preferredRef.current;
        chosen = want && names.includes(want) ? want : names[0];
        data = await phoneticsApi.orderList(c, chosen);
      }
      if (my !== reqRef.current) return;
      setLecturer(chosen);
      setLecturers(data.lecturers || []);
      setItems(data.items);
      setOrigin(data.items.map((v) => v.id));
      setPresetCount(data.preset_count || 0);
    } catch (e) {
      if (my === reqRef.current) toast.error(getErrorMessage(e, '加载失败'));
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(category, undefined); }, [load, category]);

  const confirmDiscard = () => !dirtyRef.current || window.confirm('排好的顺序还没保存,确定放弃吗?');

  const tryClose = useCallback(() => { if (confirmDiscard()) onClose(); }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') tryClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tryClose]);

  const switchCategory = (c: PhoneticCategory) => {
    if (c === category || !confirmDiscard()) return;
    setCategory(c);
  };

  const switchLecturer = (l: string | null) => {
    if (l === lecturer || !confirmDiscard()) return;
    preferredRef.current = l;
    void load(category, l);
  };

  const splitByLecturer = lecturers.length >= 2 && lecturer !== null;

  const move = (from: number, to: number) => setItems((list) => {
    const next = [...list];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    return next;
  });

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await phoneticsApi.reorder(category, items.map((v) => v.id), lecturer);
      toast.success(lecturer !== null
        ? `${lecturerLabel(lecturer)}在「${CATEGORY_LABELS[category]}」里的顺序已保存,学生端同步生效`
        : `「${CATEGORY_LABELS[category]}」的顺序已保存,学生端同步生效`);
      setOrigin(items.map((v) => v.id));
      onSaved();
    } catch (e) {
      // 409 = 打开弹层后有人上传/改了分类。重新拉一次,别让老师对着旧名单再排一遍还是失败
      toast.error(getErrorMessage(e, '保存失败'));
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) void load(category, lecturer);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={tryClose}
      role="dialog" aria-modal="true" aria-label="调整视频顺序"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="flex items-center gap-2 font-display text-lg font-bold text-ink">
              <ListOrdered className="h-5 w-5 text-[#2f8791]" />调整视频顺序
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              拖左边的 ⋮⋮ 或点箭头调整,学生端每个分类里就按这个顺序显示。改完记得点「保存」。
            </p>
          </div>
          <button type="button" onClick={tryClose} aria-label="关闭" className="rounded-lg p-1.5 text-ink-mute hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 px-5 pt-3" role="tablist" aria-label="分类">
          {CATEGORIES.map(([c, label]) => (
            <button
              key={c} type="button" role="tab" aria-selected={category === c}
              onClick={() => switchCategory(c)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                category === c ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {lecturers.length >= 2 && (
          <div className="flex flex-wrap items-center gap-1.5 px-5 pt-2" role="tablist" aria-label="讲师">
            <span className="mr-0.5 text-xs text-ink-mute">讲师</span>
            {lecturers.map((l) => (
              <button
                key={l.name} type="button" role="tab" aria-selected={lecturer === l.name}
                onClick={() => switchLecturer(l.name)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  lecturer === l.name ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                }`}
              >
                {lecturerLabel(l.name)} <span className="font-numeric opacity-75">{l.count}</span>
              </button>
            ))}
            <button
              type="button" role="tab" aria-selected={lecturer === null}
              onClick={() => switchLecturer(null)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                lecturer === null ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              全部混排
            </button>
          </div>
        )}

        {splitByLecturer && (
          <p className="mx-5 mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-800">
            只排{lecturerLabel(lecturer!)}的课,其他老师的课位置不动。学生选了「{lecturerLabel(lecturer!)}」就按这个顺序看。
          </p>
        )}

        {presetCount > 0 && (
          <p className="mx-5 mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
            这个分类还有 {presetCount} 个平台预置视频,学生端排在本校视频前面,这里调不了它们的位置。
          </p>
        )}

        <div className="min-h-[12rem] flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-ink-mute">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-mute">
              「{CATEGORY_LABELS[category]}」里{lecturer !== null ? `${lecturerLabel(lecturer)}还没有视频` : '还没有本校上传的视频'}
            </p>
          ) : (
            <Reorder.Group axis="y" values={items} onReorder={setItems} className="space-y-1.5">
              {items.map((v, i) => (
                <Row key={v.id} item={v} index={i} count={items.length} showLecturer={!splitByLecturer} onMove={move} />
              ))}
            </Reorder.Group>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-black/[0.06] px-5 py-3">
          <span className="flex-1 text-xs text-ink-mute">
            {dirty ? '有未保存的改动' : `共 ${items.length} 个`}
          </span>
          {dirty && (
            <button
              type="button" onClick={() => setItems(origin.map((id) => items.find((v) => v.id === id)!).filter(Boolean))}
              className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-ink-soft"
            >
              撤销改动
            </button>
          )}
          <button
            type="button" onClick={save} disabled={!dirty || saving}
            className="btn-glow rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存顺序'}
          </button>
        </div>
      </div>
    </div>
  );
}
