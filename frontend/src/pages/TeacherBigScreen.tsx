/**
 * 教师端 - 教室大屏(投屏专用)
 * 独立 URL /teacher/bigscreen?class=ID,全屏铺满,教室电视/投影常显
 * 左:实时监控(EKG 专注度波形 + 学生状态网格,5s 刷)
 * 右:今日排行榜(学词数,30s 刷,前三名领奖台式高亮)
 * 深空全息风:霓虹辉光、扫描动画、数字翻牌;无需任何操作,挂机即用
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

/* ---------- 类型 ---------- */
interface LiveStudent {
  user_id: number;
  student_name: string;
  status: 'away' | 'distracted' | 'studying' | 'offline';
  away_seconds: number;
  switch_count_today: number;
  unit_name: string | null;
  last_seen_ago: number;
}
interface LiveSnapshot {
  class_name: string;
  total_students: number;
  online_count: number;
  students: LiveStudent[];
  never_seen: { user_id: number; student_name: string }[];
}
interface DailyRow {
  user_id: number;
  full_name: string;
  words_learned: number;
  study_duration: number;
  accuracy_rate: number;
}
interface ClassOption { id: number; name: string }

const LIVE_MS = 5_000;
const DAILY_MS = 15_000;   // 排行刷新:热血播报要跟得上节奏

const C = {
  cyan: '#6ff2dd', red: '#ff5c8a', yellow: '#ffe08a', gray: '#475569',
  gold: '#ffd700', silver: '#c0c4cc', bronze: '#cd7f32',
};

/* 段位系统:按当日学词数定级,孩子看段位比看名次更上头 */
const TIERS = [
  { min: 100, name: '荣耀王者', icon: '👑', color: '#ffd700' },
  { min: 70,  name: '超凡大师', icon: '💎', color: '#b47cff' },
  { min: 50,  name: '璀璨钻石', icon: '🔷', color: '#4fc3f7' },
  { min: 30,  name: '华贵铂金', icon: '🌟', color: '#7ff2dd' },
  { min: 15,  name: '荣耀黄金', icon: '🥇', color: '#ffb300' },
  { min: 5,   name: '不屈白银', icon: '⚔️', color: '#cfd8dc' },
  { min: 1,   name: '倔强青铜', icon: '🛡️', color: '#cd7f32' },
];
const tierOf = (words: number) => TIERS.find(t => words >= t.min) ?? TIERS[TIERS.length - 1];

/* ---------- 全屏 EKG(大屏加高版) ---------- */
const BigWave = ({ focusRatio, awayCount }: { focusRatio: number; awayCount: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef({ focusRatio, awayCount });
  dataRef.current = { focusRatio, awayCount };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0, x = 0, lastY: number | null = null, phase = 0, tick = 0;
    const particles: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.scale(dpr, dpr);
      x = 0; lastY = null;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w) { raf = requestAnimationFrame(draw); return; }
      const midY = h * 0.55;
      const { focusRatio: fr, awayCount: ac } = dataRef.current;
      const alert = ac > 0;
      const main = alert ? C.red : C.cyan;
      tick++;
      ctx.fillStyle = 'rgba(6,10,24,0.06)';
      ctx.fillRect(0, 0, w, h);
      const nx = x + 2.2;
      phase += 0.05;
      const jitter = alert ? (Math.random() - 0.5) * 8 : 0;
      const calm = Math.sin(nx * 0.04) * (4 + (1 - fr) * 7) + Math.sin(nx * 0.01 + 2) * 3 + jitter;
      const beatT = (nx * 0.018 + phase) % (Math.PI * 2);
      let spike = 0, atPeak = false;
      if (beatT < 0.5) {
        const k = beatT / 0.5;
        spike = -Math.sin(k * Math.PI) * (14 + Math.min(ac, 5) * 12);
        if (beatT > 0.25) spike *= -0.45;
        atPeak = k > 0.4 && k < 0.6;
      }
      const ny = midY + calm + spike;
      const grad = ctx.createLinearGradient(0, midY - 60, 0, midY + 40);
      grad.addColorStop(0, alert ? '#ffd3e0' : '#d9fffa');
      grad.addColorStop(0.5, main);
      grad.addColorStop(1, '#7dd3fc');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.shadowColor = main;
      ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.moveTo(x, lastY ?? ny); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, lastY ?? ny); ctx.lineTo(nx, ny); ctx.stroke();
      const area = ctx.createLinearGradient(0, ny, 0, midY + 44);
      area.addColorStop(0, alert ? 'rgba(255,92,138,0.25)' : 'rgba(111,242,221,0.22)');
      area.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = area;
      ctx.fillRect(x, Math.min(ny, midY + 44), 2.7, Math.abs(midY + 44 - ny));
      if (atPeak && particles.length < 80) {
        for (let i = 0; i < 4; i++) particles.push({ x: nx, y: ny, vx: (Math.random() - 0.2) * 2, vy: -Math.random() * 2.2 - 0.5, life: 1 });
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= 0.02;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = Math.random() > 0.5 ? main : '#fff';
        ctx.fillRect(p.x, p.y, 2, 2);
      }
      ctx.globalAlpha = 1;
      lastY = ny; x = nx;
      if (x > w) { x = 0; lastY = null; }
      const pulse = 3 + Math.sin(tick * 0.25);
      ctx.strokeStyle = main; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, ny, pulse + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.shadowColor = main; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(x, ny, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};

/* ---------- 主页面 ---------- */
const TeacherBigScreen = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState<number | null>(
    searchParams.get('class') ? Number(searchParams.get('class')) : null
  );
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [clock, setClock] = useState('');

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });

  // 时钟
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('zh-CN', { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  // 班级列表(大屏专用端点:display 账号可看全部班;URL 无 class 参数时取第一个)
  useEffect(() => {
    axios.get(`${API_BASE_URL}/bigscreen/classes`, { headers: authHeaders() })
      .then(r => {
        const list: ClassOption[] = Array.isArray(r.data) ? r.data : (r.data?.items ?? []);
        setClasses(list);
        if (!classId && list.length > 0) {
          setClassId(list[0].id);
          setSearchParams({ class: String(list[0].id) }, { replace: true });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 实时快照 5s
  useEffect(() => {
    if (!classId) return;
    const poll = async () => {
      try {
        const r = await axios.get(`${API_BASE_URL}/teacher/classes/${classId}/live`, { headers: authHeaders() });
        setSnap(r.data);
      } catch { /* 静默重试 */ }
    };
    poll();
    const t = setInterval(poll, LIVE_MS);
    return () => clearInterval(t);
  }, [classId]);

  // 排行 15s(大屏专用端点,display 账号可用)
  useEffect(() => {
    if (!classId) return;
    const poll = async () => {
      try {
        const r = await axios.get(`${API_BASE_URL}/bigscreen/classes/${classId}/daily-stats`, { headers: authHeaders() });
        setDaily(r.data?.students ?? []);
      } catch { /* 静默 */ }
    };
    poll();
    const t = setInterval(poll, DAILY_MS);
    return () => clearInterval(t);
  }, [classId]);

  const counts = useMemo(() => {
    const c = { away: 0, distracted: 0, studying: 0, offline: 0 };
    snap?.students.forEach(s => { c[s.status] += 1; });
    return c;
  }, [snap]);
  const active = counts.studying + counts.distracted + counts.away;
  const focusRatio = active > 0 ? counts.studying / active : 1;

  const ranking = useMemo(
    () => daily.filter(d => d.words_learned > 0).sort((a, b) => b.words_learned - a.words_learned),
    [daily]
  );
  const maxWords = ranking[0]?.words_learned || 1;
  const champion = ranking[0] ?? null;
  const totalWords = useMemo(() => daily.reduce((s, d) => s + d.words_learned, 0), [daily]);

  // 排行轮播:前3名钉住,4名以后每页8人、10秒自动翻页(全班都能露脸)
  const ROTATE_SIZE = 8;
  const [rotatePage, setRotatePage] = useState(0);
  const rest = ranking.slice(3);
  const rotatePages = Math.max(1, Math.ceil(rest.length / ROTATE_SIZE));
  useEffect(() => {
    if (rotatePages <= 1) { setRotatePage(0); return; }
    const t = setInterval(() => setRotatePage(p => (p + 1) % rotatePages), 10_000);
    return () => clearInterval(t);
  }, [rotatePages]);
  const visibleRest = rest.slice(rotatePage * ROTATE_SIZE, (rotatePage + 1) * ROTATE_SIZE);

  /* ---------- 热血互动:王座更替 / 超越播报 / 整班里程碑 ---------- */
  const [feed, setFeed] = useState<{ id: number; text: string; hot?: boolean }[]>([]);
  const [crownBlast, setCrownBlast] = useState<string | null>(null);   // 王座易主全屏爆发
  const [milestone, setMilestone] = useState<number | null>(null);      // 整班破百里程碑
  const prevRankRef = useRef<Map<number, number>>(new Map());           // user_id -> 上次名次
  const prevTierRef = useRef<Map<number, number>>(new Map());           // user_id -> 上次段位词数门槛
  const prevChampionRef = useRef<number | null>(null);
  const prevTotalRef = useRef<number>(-1);
  const feedIdRef = useRef(0);

  const pushFeed = useCallback((text: string, hot = false) => {
    const id = ++feedIdRef.current;
    setFeed(prev => [...prev.slice(-4), { id, text, hot }]);
    setTimeout(() => setFeed(prev => prev.filter(f => f.id !== id)), 9000);
  }, []);

  useEffect(() => {
    if (ranking.length === 0) return;
    const prev = prevRankRef.current;
    const isFirstLoad = prev.size === 0;

    // 王座易主
    const champId = ranking[0].user_id;
    if (!isFirstLoad && prevChampionRef.current !== null && prevChampionRef.current !== champId) {
      setCrownBlast(ranking[0].full_name);
      setTimeout(() => setCrownBlast(null), 4500);
    }
    prevChampionRef.current = champId;

    // 超越播报(名次上升的,报最靠前那条)
    if (!isFirstLoad) {
      for (let i = 0; i < ranking.length; i++) {
        const d = ranking[i];
        const old = prev.get(d.user_id);
        if (old !== undefined && i < old && i > 0) {
          const overtaken = ranking[i + 1] ?? null;
          pushFeed(`🔥 ${d.full_name} 超越了${overtaken ? ` ${overtaken.full_name},` : ''}升至第 ${i + 1} 名!`, true);
          break;
        }
      }
      // 逼近王座预警:第2名距第1名 ≤3 词
      if (ranking.length >= 2) {
        const gap = ranking[0].words_learned - ranking[1].words_learned;
        const key = `chase-${ranking[1].user_id}-${gap}`;
        if (gap > 0 && gap <= 3 && (window as any).__lastChaseKey !== key) {
          (window as any).__lastChaseKey = key;
          pushFeed(`🚀 ${ranking[1].full_name} 距离第一只差 ${gap} 个词!`, true);
        }
      }
      // 升段播报:跨过段位门槛(荣耀黄金→璀璨钻石…)
      for (const d of ranking) {
        const tier = tierOf(d.words_learned);
        const oldMin = prevTierRef.current.get(d.user_id);
        if (oldMin !== undefined && tier.min > oldMin) {
          pushFeed(`${tier.icon} ${d.full_name} 晋升「${tier.name}」段位!`);
          break;  // 每轮最多报一条,避免刷屏
        }
      }
    }
    prevTierRef.current = new Map(ranking.map(d => [d.user_id, tierOf(d.words_learned).min]));
    prevRankRef.current = new Map(ranking.map((d, i) => [d.user_id, i]));
  }, [ranking, pushFeed]);

  // 整班学词破百里程碑(300/400/500…)
  useEffect(() => {
    if (prevTotalRef.current >= 0) {
      const prevHundred = Math.floor(prevTotalRef.current / 100);
      const nowHundred = Math.floor(totalWords / 100);
      if (nowHundred > prevHundred && totalWords >= 100) {
        setMilestone(nowHundred * 100);
        setTimeout(() => setMilestone(null), 5000);
      }
    }
    prevTotalRef.current = totalWords;
  }, [totalWords]);

  const enterFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const statusColor = (s: LiveStudent['status']) =>
    s === 'away' ? C.red : s === 'distracted' ? C.yellow : s === 'studying' ? C.cyan : C.gray;

  return (
    <div
      className="fixed inset-0 overflow-hidden select-none"
      style={{ background: 'radial-gradient(ellipse at 50% -20%, #101b3d 0%, #080e22 50%, #05081a 100%)' }}
    >
      {/* 网格地板 */}
      <div
        className="absolute inset-0 opacity-[0.10] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(111,242,221,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.3) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          maskImage: 'radial-gradient(ellipse at 50% 30%, black 40%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, black 40%, transparent 85%)',
        }}
      />
      {/* 顶栏 */}
      <div className="relative z-10 h-16 px-8 flex items-center gap-5" style={{ borderBottom: '1px solid rgba(111,242,221,0.18)' }}>
        {(() => {
          try { return JSON.parse(localStorage.getItem('user') || '{}').role !== 'display'; } catch { return true; }
        })() && (
          <button onClick={() => navigate('/teacher/live')} className="text-white/40 hover:text-white/80 transition text-sm">
            ← 退出
          </button>
        )}
        <h1 className="text-xl font-black tracking-[0.3em] text-white font-mono flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <motion.span className="absolute h-full w-full rounded-full" style={{ background: C.cyan }}
              animate={{ scale: [1, 2.4], opacity: [0.7, 0] }} transition={{ duration: 1.8, repeat: Infinity }} />
            <span className="relative h-3 w-3 rounded-full" style={{ background: C.cyan, boxShadow: `0 0 10px ${C.cyan}` }} />
          </span>
          {snap?.class_name || '教室'} · 学习大屏
        </h1>
        <div className="ml-auto flex items-center gap-4">
          {classes.length > 1 && (
            <select
              value={classId ?? ''}
              onChange={e => { const id = Number(e.target.value); setClassId(id); setSearchParams({ class: String(id) }, { replace: true }); }}
              className="bg-white/5 text-white/80 border border-white/15 rounded-lg px-3 py-1.5 text-sm [&>option]:text-gray-800"
            >
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button onClick={enterFullscreen} className="px-3 py-1.5 rounded-lg text-sm text-white/60 border border-white/15 hover:bg-white/10 transition">
            ⛶ 全屏
          </button>
          <span className="font-mono text-2xl font-bold tracking-widest" style={{ color: C.cyan, textShadow: `0 0 14px ${C.cyan}88` }}>
            {clock}
          </span>
        </div>
      </div>

      {/* 主体:左监控 右排行 */}
      <div className="relative z-10 flex gap-5 p-5" style={{ height: 'calc(100vh - 64px)' }}>
        {/* ===== 左:实时监控 ===== */}
        <div className="flex-[3] flex flex-col gap-4 min-w-0">
          {/* EKG */}
          <div className="relative rounded-2xl overflow-hidden h-36 shrink-0"
               style={{ background: 'rgba(10,16,36,0.7)', border: `1px solid ${counts.away > 0 ? 'rgba(255,92,138,0.5)' : 'rgba(111,242,221,0.22)'}` }}>
            <BigWave focusRatio={focusRatio} awayCount={counts.away} />
            <div className="absolute top-3 left-5 text-sm font-mono tracking-[0.3em] text-white/70">班级专注度</div>
            <div className="absolute top-1 right-5 flex items-baseline gap-1">
              <AnimatePresence mode="popLayout">
                <motion.span key={Math.round(focusRatio * 100)}
                  initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
                  className="text-5xl font-black font-mono"
                  style={{ color: counts.away > 0 ? C.red : C.cyan, textShadow: `0 0 20px ${counts.away > 0 ? C.red : C.cyan}88` }}>
                  {Math.round(focusRatio * 100)}
                </motion.span>
              </AnimatePresence>
              <span className="text-lg font-mono text-white/40">%</span>
            </div>
            <div className="absolute bottom-2 left-5 flex gap-5 text-xs font-mono text-white/50">
              <span style={{ color: C.cyan }}>● 学习 {counts.studying}</span>
              <span style={{ color: C.red }}>● 切出 {counts.away}</span>
              <span style={{ color: C.yellow }}>● 走神 {counts.distracted}</span>
              <span>● 离线 {counts.offline}</span>
            </div>
          </div>

          {/* 警报横幅 */}
          <AnimatePresence>
            {counts.away > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="shrink-0 overflow-hidden">
                <motion.div
                  className="rounded-xl px-5 py-3 font-mono font-bold tracking-wider text-lg flex items-center gap-3"
                  style={{ background: 'rgba(255,92,138,0.15)', border: '1px solid rgba(255,92,138,0.55)', color: '#ff9db4' }}
                  animate={{ opacity: [1, 0.75, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                >
                  <motion.span animate={{ rotate: [0, -14, 14, 0] }} transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1 }}>🚨</motion.span>
                  {counts.away} 名学生离开了学习页面
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 学生状态网格(大屏字号) */}
          <div className="flex-1 overflow-y-auto rounded-2xl p-4"
               style={{ background: 'rgba(10,16,36,0.5)', border: '1px solid rgba(148,163,184,0.14)' }}>
            <motion.div layout className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              <AnimatePresence>
                {(snap?.students ?? []).filter(s => s.status !== 'offline').map(s => {
                  const color = statusColor(s.status);
                  return (
                    <motion.div
                      key={s.user_id} layout
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                      className="rounded-xl px-4 py-3 flex items-center gap-3"
                      style={{
                        background: s.status === 'away' ? 'rgba(255,92,138,0.12)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${color}${s.status === 'offline' ? '30' : '60'}`,
                        boxShadow: s.status === 'away' ? `0 0 16px ${C.red}40` : 'none',
                        opacity: s.status === 'offline' ? 0.45 : 1,
                      }}
                    >
                      <span className="relative flex h-3 w-3 shrink-0">
                        {(s.status === 'studying' || s.status === 'away') && (
                          <motion.span className="absolute h-full w-full rounded-full" style={{ background: color }}
                            animate={{ scale: [1, 2.2], opacity: [0.5, 0] }}
                            transition={{ duration: s.status === 'away' ? 0.9 : 1.8, repeat: Infinity }} />
                        )}
                        <span className="relative h-3 w-3 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-base truncate">{s.student_name}</p>
                        <p className="text-xs font-mono truncate" style={{ color }}>
                          {s.status === 'away' && `已离开 ${s.away_seconds >= 60 ? Math.floor(s.away_seconds / 60) + 'm' : s.away_seconds + 's'}`}
                          {s.status === 'studying' && (s.unit_name || '学习中')}
                          {s.status === 'distracted' && '发呆中 😶'}
                        </p>
                      </div>
                      {s.switch_count_today > 3 && (
                        <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: C.red, border: `1px solid ${C.red}55` }}>
                          ×{s.switch_count_today}
                        </span>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
            {(snap?.students?.length ?? 0) === 0 && (
              <div className="h-full flex items-center justify-center text-white/30 font-mono">等待学生上线…</div>
            )}
            {/* 未上线小注脚(大屏是荣誉场,离线的不占格子) */}
            {counts.offline > 0 && (
              <p className="mt-3 text-xs font-mono text-white/25 text-right">未上线 {counts.offline} 人</p>
            )}
          </div>
        </div>

        {/* ===== 右:今日排行榜 ===== */}
        <div className="flex-[2] flex flex-col rounded-2xl overflow-hidden min-w-0"
             style={{ background: 'rgba(10,16,36,0.5)', border: '1px solid rgba(255,215,0,0.22)' }}>
          <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(255,215,0,0.18)' }}>
            <motion.span className="text-2xl" animate={{ rotate: [0, -8, 8, 0] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}>🏆</motion.span>
            <h2 className="text-lg font-black tracking-[0.2em] text-white font-mono">今日学词排行</h2>
            <span className="ml-auto text-xs font-mono text-white/50">
              全班 <AnimatePresence mode="popLayout"><motion.span key={totalWords} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} className="inline-block font-black text-base" style={{ color: C.gold }}>{totalWords}</motion.span></AnimatePresence> 词
            </span>
          </div>
          {/* 👑 王座宣告 */}
          {champion && (
            <div className="px-4 pt-3">
              <motion.div
                className="rounded-xl px-4 py-2.5 flex items-center gap-3 overflow-hidden relative"
                style={{ background: `linear-gradient(90deg, ${C.gold}22, transparent)`, border: `1px solid ${C.gold}66`, boxShadow: `0 0 18px ${C.gold}30` }}
                animate={{ boxShadow: [`0 0 12px ${C.gold}25`, `0 0 26px ${C.gold}45`, `0 0 12px ${C.gold}25`] }}
                transition={{ duration: 2.4, repeat: Infinity }}
              >
                <motion.span className="text-3xl" animate={{ y: [0, -4, 0], rotate: [0, -6, 6, 0] }} transition={{ duration: 1.8, repeat: Infinity }}>👑</motion.span>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-black text-lg truncate">
                    {champion.full_name}
                    <span className="ml-2 text-sm font-normal" style={{ color: C.gold }}>正在统治今日榜单!</span>
                  </p>
                </div>
                <span className="font-mono font-black text-2xl shrink-0" style={{ color: C.gold, textShadow: `0 0 16px ${C.gold}` }}>
                  {champion.words_learned} <span className="text-xs text-white/40">词</span>
                </span>
              </motion.div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {/* 前三名:钉住不轮播,带段位徽章 */}
            <AnimatePresence>
              {ranking.slice(0, 3).map((d, i) => {
                const medal = i === 0 ? C.gold : i === 1 ? C.silver : C.bronze;
                const tier = tierOf(d.words_learned);
                return (
                  <motion.div
                    key={d.user_id} layout
                    initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                    className="relative rounded-xl px-4 py-3 flex items-center gap-3 overflow-hidden"
                    style={{
                      background: `${medal}14`,
                      border: `1px solid ${medal}55`,
                      boxShadow: i === 0 ? `0 0 22px ${C.gold}33` : 'none',
                    }}
                  >
                    <motion.div
                      className="absolute inset-y-0 left-0 pointer-events-none"
                      style={{ background: `${medal}12` }}
                      animate={{ width: `${(d.words_learned / maxWords) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                    <span className="relative w-9 text-center shrink-0">
                      <motion.span className="text-2xl inline-block" animate={i === 0 ? { y: [0, -3, 0] } : {}} transition={{ duration: 1.4, repeat: Infinity }}>{['🥇', '🥈', '🥉'][i]}</motion.span>
                    </span>
                    <div className="relative flex-1 min-w-0">
                      <span className={`block truncate font-semibold ${i === 0 ? 'text-xl' : 'text-lg'} text-white`}>
                        {d.full_name}
                      </span>
                      <span className="text-[11px] font-mono" style={{ color: tier.color }}>
                        {tier.icon} {tier.name}
                      </span>
                    </div>
                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={d.words_learned}
                        initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
                        className={`relative font-mono font-black shrink-0 ${i === 0 ? 'text-2xl' : 'text-lg'}`}
                        style={{ color: medal, textShadow: `0 0 12px ${medal}88` }}
                      >
                        {d.words_learned}
                      </motion.span>
                    </AnimatePresence>
                    <span className="relative text-xs font-mono text-white/35 shrink-0">词</span>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* 4名以后:每页8人,10秒自动轮播,全班都能露脸 */}
            {rest.length > 0 && (
              <div className="pt-1">
                <div className="flex items-center gap-2 px-1 mb-2">
                  <span className="text-[10px] font-mono tracking-widest text-white/30">CHALLENGERS</span>
                  {rotatePages > 1 && (
                    <span className="ml-auto flex gap-1">
                      {Array.from({ length: rotatePages }, (_, p) => (
                        <span key={p} className="w-1.5 h-1.5 rounded-full transition-all" style={{ background: p === rotatePage ? C.cyan : 'rgba(255,255,255,0.15)' }} />
                      ))}
                    </span>
                  )}
                </div>
                <AnimatePresence mode="popLayout">
                  {visibleRest.map((d) => {
                    const globalIdx = ranking.findIndex(r => r.user_id === d.user_id);
                    const tier = tierOf(d.words_learned);
                    return (
                      <motion.div
                        key={d.user_id} layout
                        initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                        className="relative rounded-xl px-4 py-2 mb-2 flex items-center gap-3 overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(148,163,184,0.15)' }}
                      >
                        <motion.div
                          className="absolute inset-y-0 left-0 pointer-events-none"
                          style={{ background: `${C.cyan}0e` }}
                          animate={{ width: `${(d.words_learned / maxWords) * 100}%` }}
                          transition={{ duration: 0.8 }}
                        />
                        <span className="relative w-9 text-center shrink-0 text-sm font-mono text-white/35">{globalIdx + 1}</span>
                        <span className="relative flex-1 truncate font-medium text-base text-white">{d.full_name}</span>
                        <span className="relative text-xs shrink-0" style={{ color: tier.color }}>{tier.icon}</span>
                        <span className="relative font-mono font-bold text-base shrink-0" style={{ color: C.cyan }}>{d.words_learned}</span>
                        <span className="relative text-xs font-mono text-white/35 shrink-0">词</span>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}

            {ranking.length === 0 && (
              <div className="h-40 flex flex-col items-center justify-center gap-2 text-white/30 font-mono">
                <span className="text-4xl">🌱</span>
                今天还没有人上榜,快来抢第一!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ⚔️ 超越播报(Kill Feed,右下角滚动) */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col-reverse gap-2 items-end pointer-events-none">
        <AnimatePresence>
          {feed.map(f => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, x: 80, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="px-5 py-2.5 rounded-xl font-bold text-base"
              style={f.hot
                ? { background: 'rgba(255,92,138,0.18)', border: `1px solid ${C.red}77`, color: '#ffb4c8', boxShadow: `0 0 18px ${C.red}44`, textShadow: `0 0 10px ${C.red}88` }
                : { background: 'rgba(111,242,221,0.12)', border: `1px solid ${C.cyan}55`, color: '#b8fff4' }}
            >
              {f.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ⚡ 王座易主全屏爆发 */}
      <AnimatePresence>
        {crownBlast && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at center, rgba(255,215,0,0.16), transparent 65%)' }}
          >
            {/* 金色粒子雨 */}
            {Array.from({ length: 24 }, (_, i) => (
              <motion.span
                key={i}
                className="absolute text-2xl"
                initial={{ x: (i - 12) * 60, y: -80, opacity: 1, rotate: 0 }}
                animate={{ y: '110vh', rotate: 360 * (i % 2 ? 1 : -1), opacity: [1, 1, 0.3] }}
                transition={{ duration: 2.6 + (i % 5) * 0.4, ease: 'easeIn' }}
              >
                {['✨', '⭐', '👑', '🎉'][i % 4]}
              </motion.span>
            ))}
            <motion.div
              initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
              animate={{ scale: [0.4, 1.15, 1], opacity: 1, rotate: 0 }}
              transition={{ duration: 0.6, times: [0, 0.7, 1] }}
              className="text-center px-10 py-8 rounded-3xl"
              style={{ background: 'rgba(8,12,30,0.88)', border: `2px solid ${C.gold}`, boxShadow: `0 0 60px ${C.gold}66` }}
            >
              <motion.div className="text-6xl mb-3" animate={{ y: [0, -8, 0] }} transition={{ duration: 0.9, repeat: Infinity }}>👑</motion.div>
              <p className="text-4xl font-black text-white mb-2" style={{ textShadow: `0 0 24px ${C.gold}` }}>
                ⚡ {crownBlast} 登上王座!
              </p>
              <p className="font-mono text-sm tracking-[0.3em]" style={{ color: C.gold }}>NEW CHAMPION</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🎉 整班里程碑 */}
      <AnimatePresence>
        {milestone && (
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <div className="px-8 py-4 rounded-2xl text-center" style={{ background: 'rgba(8,12,30,0.9)', border: `2px solid ${C.cyan}`, boxShadow: `0 0 40px ${C.cyan}55` }}>
              <p className="text-3xl font-black text-white" style={{ textShadow: `0 0 20px ${C.cyan}` }}>
                🎉 全班今日突破 <span style={{ color: C.gold }}>{milestone}</span> 词!
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherBigScreen;
