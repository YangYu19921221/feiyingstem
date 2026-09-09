/**
 * 教师端弹幕审核面板 —— 挂在「正在直播」块内,只在开播时渲染(卸载即断 WS)。
 *
 * 老师能力:实时看弹幕、删单条、点发言人禁言/解禁、一键清屏、看在线人数。
 * 复用 useLiveSocket;教师连接在后端有 teacher_id 校验,收到的管理指令服务端才认。
 *
 * 交互要点(为「上课时随手审核」优化):
 * 1. 删除/禁言按钮**常驻可点**(不再 hover 才显)——老师多用 iPad/触屏,触屏没有 hover,
 *    hover-only 会让审核按钮在平板上永远点不出来;桌面端 hover 时再加重不透明度做强调。
 * 2. **滚动不打断**:老师往上翻看旧弹幕时,新弹幕不再把视图硬拽回底部;改为底部弹一个
 *    「↓ N 条新弹幕」提示,点一下才回底。只有本就贴底时才自动跟随。
 * 3. **配色呼应学生端**:每条前置一个角色色点(老师金 / 学生青),与学生端弹幕层同色。
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useLiveSocket, type LiveWsEvent } from '../hooks/useLiveSocket';
import type { DanmakuItem } from './DanmakuOverlay';

const MAX_KEPT = 300;
const NEAR_BOTTOM_PX = 40;   // 距底 <= 此像素算「贴底」,贴底才自动跟随

export default function TeacherDanmakuPanel({ sessionId }: { sessionId: number }) {
  const token = localStorage.getItem('access_token') || '';
  const [list, setList] = useState<DanmakuItem[]>([]);
  const [online, setOnline] = useState(0);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [unread, setUnread] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  // 用户当前是否贴底。只由 onScroll(用户动作)与 scrollToBottom 改写;
  // 内容追加不碰它 —— 这是「贴底跟随 / 上翻不打断」不打架的关键。
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottomRef.current = true;
    setUnread(0);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    atBottomRef.current = bottom;
    if (bottom) setUnread(0);
  }, []);

  const onEvent = useCallback((e: LiveWsEvent) => {
    switch (e.type) {
      case 'history':
        setList((e.items || []) as DanmakuItem[]);
        atBottomRef.current = true;   // 进场直接贴底
        setUnread(0);
        break;
      case 'danmaku_batch': {
        const items = (e.items || []) as DanmakuItem[];
        if (!items.length) break;
        setList((prev) => {
          const merged = [...prev, ...items];
          return merged.length > MAX_KEPT ? merged.slice(-MAX_KEPT) : merged;
        });
        // 不贴底时累计未读:计数以真实收到的条数为准,与列表长度封顶无关
        if (!atBottomRef.current) setUnread((n) => n + items.length);
        break;
      }
      case 'deleted':
        setList((prev) => prev.filter((d) => d.id !== e.id));
        break;
      case 'cleared':
        setList([]);
        setUnread(0);
        break;
      case 'online':
        setOnline(e.count || 0);
        break;
      case 'muted':
        setMuted((prev) => new Set(prev).add(e.student_id));
        break;
      case 'unmuted':
        setMuted((prev) => {
          const next = new Set(prev);
          next.delete(e.student_id);
          return next;
        });
        break;
    }
  }, []);

  const { send, connected, failed, retry } = useLiveSocket({
    sessionId, token, onEvent, enabled: !!token,
  });

  // 列表渲染后再滚动(此时 DOM 已更新)。只有原本贴底才自动跟随,否则保持老师的位置。
  // 高频追加用瞬时 scrollTop,不做平滑(平滑会追不上、且抖)。
  useLayoutEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [list]);

  const del = (id: number) => send({ type: 'delete', danmaku_id: id });
  const toggleMute = (studentId: number) => {
    send({ type: muted.has(studentId) ? 'unmute' : 'mute', student_id: studentId });
  };
  const clearAll = () => {
    if (window.confirm('清空当前所有弹幕?学生端也会一起清掉。')) {
      send({ type: 'clear' });
    }
  };

  return (
    <div className="mt-3 border border-orange-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border-b border-orange-200">
        <span className="font-bold text-gray-700 text-sm">💬 弹幕互动</span>
        <span className="text-xs text-gray-500">👥 {online} 人在线</span>
        <span className={`text-xs ${connected ? 'text-green-600' : 'text-gray-400'}`}>
          {connected ? '● 已连接' : failed ? '○ 已断开' : '○ 连接中'}
        </span>
        {failed && (
          <button onClick={retry} className="text-xs text-[#FF6B35] underline">重连</button>
        )}
        <button
          onClick={clearAll}
          className="ml-auto px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 text-xs font-bold"
        >
          🧹 清屏
        </button>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-64 overflow-y-auto px-3 py-2 space-y-1.5 bg-white"
        >
          {list.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-6">还没有弹幕</p>
          )}
          {list.map((d) => (
            <div key={d.id} className="flex items-start gap-2 text-sm group">
              {/* 角色色点:与学生端弹幕层同色(老师金 / 学生青),白底加浅描边保证可见 */}
              <span
                className="mt-1.5 shrink-0 w-2 h-2 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: d.role === 'teacher' ? '#FFD23F' : '#00D9FF' }}
              />
              <span className={`shrink-0 font-bold ${d.role === 'teacher' ? 'text-[#FF6B35]' : 'text-[#0090aa]'}`}>
                {d.name}
              </span>
              <span className="flex-1 min-w-0 break-words text-gray-700">{d.content}</span>
              {d.role !== 'teacher' && d.student_id != null && (
                <div className="shrink-0 flex gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => del(d.id)}
                    className="px-1.5 py-0.5 rounded bg-red-50 text-red-500 text-xs"
                    title="删除这条"
                  >
                    删
                  </button>
                  <button
                    onClick={() => toggleMute(d.student_id!)}
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      muted.has(d.student_id) ? 'bg-gray-200 text-gray-600' : 'bg-amber-50 text-amber-600'
                    }`}
                    title={muted.has(d.student_id) ? '解除禁言' : '禁言该学生'}
                  >
                    {muted.has(d.student_id) ? '解禁' : '禁言'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 未读提示:老师上翻看旧弹幕时,新弹幕不硬拽视图,底部弹条,点了才回底 */}
        {unread > 0 && (
          <button
            onClick={() => scrollToBottom(true)}
            className="absolute left-1/2 -translate-x-1/2 bottom-2 px-3 py-1 rounded-full bg-[#FF6B35] text-white text-xs font-bold shadow-md"
          >
            ↓ {unread} 条新弹幕
          </button>
        )}
      </div>
    </div>
  );
}
