/**
 * 教师端 - 实时课堂 · 监控中心
 * - EKG 心电波形(全班专注度)持续流动
 * - 浅色/深色双主题(记住选择,默认浅色);班级选择也记住上次的
 * - 5 秒轮询;framer-motion 布局动画
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface LiveStudent {
  user_id: number;
  student_name: string;
  status: 'away' | 'distracted' | 'studying' | 'offline';
  away_seconds: number;
  switch_count_today: number;
  distracted_count_today: number;
  unit_name: string | null;
  last_seen_ago: number;
}

interface LiveSnapshot {
  class_id: number;
  class_name: string;
  total_students: number;
  online_count: number;
  students: LiveStudent[];
  never_seen: { user_id: number; student_name: string }[];
}

interface ClassOption { id: number; name: string; student_count: number }

/** 今日统计行(来自 daily-stats 端点,已是修复后的真实口径) */
interface DailyStatRow {
  user_id: number;
  full_name: string;
  words_learned: number;
  study_duration: number;   // 秒
  accuracy_rate: number;
  sessions_count: number;
  review_done_today: number;
}

/** 学生最近完成的任务(recent-activities 按学生过滤) */
interface StudentActivity {
  type: 'homework' | 'unit';
  student_name: string;
  title: string;
  score: number | null;
  time: string;
}

/** 班级签到数据 */
interface CheckinData {
  date: string;
  total_students: number;
  checked_count: number;
  checked: { user_id: number; student_name: string; checkin_time: string | null; rank: number }[];
  unchecked: { user_id: number; student_name: string }[];
}

const POLL_MS = 5_000;
const THEME_KEY = 'live_classroom_theme';       // 'light' | 'dark'
const CLASS_KEY = 'live_classroom_class_id';    // 上次选中的班级

/* ============ 双主题配色 ============ */
const THEMES = {
  dark: {
    pageBg: 'linear-gradient(180deg, #0b1226 0%, #070c1c 60%, #060a18 100%)',
    navBg: 'rgba(7,12,28,0.8)', navBorder: '1px solid rgba(148,163,184,0.12)',
    cyan: '#6ff2dd', red: '#ff9daf', yellow: '#ffe08a', gray: '#94a3b8',
    text: 'rgba(241,245,249,0.96)', sub: 'rgba(203,213,225,0.85)', dim: 'rgba(203,213,225,0.72)', dimmer: 'rgba(148,163,184,0.6)',
    cardBg: 'rgba(203,213,225,0.06)', cardBorder: 'rgba(203,213,225,0.16)',
    awayBg: 'rgba(255,157,175,0.08)', awayBorder: 'rgba(255,157,175,0.45)',
    alertBg: 'rgba(255,157,175,0.10)', alertBorder: 'rgba(255,157,175,0.4)',
    chipBg: 'rgba(203,213,225,0.07)', chipBorder: 'rgba(203,213,225,0.18)',
    selectBg: 'rgba(148,163,184,0.08)', selectBorder: 'rgba(148,163,184,0.2)',
    ekgBg: 'rgba(10,16,36,0.6)', ekgBorder: 'rgba(111,242,221,0.16)', ekgGrid: 'rgba(111,242,221,0.4)',
    ekgFade: 'rgba(7,12,28,0.055)',   // canvas 尾迹(必须接近页面底色)
    hoverBg: 'rgba(255,255,255,0.06)',
    glow: (c: string) => `0 0 6px ${c}`,
    numGlow: (c: string) => `0 0 14px ${c}55`,
    statTint: (c: string) => `${c}14`, statBorder: (c: string) => `${c}4d`,
  },
  light: {
    pageBg: 'linear-gradient(180deg, #f6f8fc 0%, #eef2f9 100%)',
    navBg: 'rgba(255,255,255,0.85)', navBorder: '1px solid rgba(15,23,42,0.08)',
    cyan: '#0d9488', red: '#e11d48', yellow: '#b45309', gray: '#64748b',
    text: 'rgba(15,23,42,0.92)', sub: 'rgba(51,65,85,0.85)', dim: 'rgba(71,85,105,0.75)', dimmer: 'rgba(100,116,139,0.65)',
    cardBg: '#ffffff', cardBorder: 'rgba(15,23,42,0.08)',
    awayBg: 'rgba(225,29,72,0.05)', awayBorder: 'rgba(225,29,72,0.35)',
    alertBg: 'rgba(225,29,72,0.06)', alertBorder: 'rgba(225,29,72,0.3)',
    chipBg: '#ffffff', chipBorder: 'rgba(15,23,42,0.1)',
    selectBg: '#ffffff', selectBorder: 'rgba(15,23,42,0.15)',
    ekgBg: '#0f172a', ekgBorder: 'rgba(15,23,42,0.2)', ekgGrid: 'rgba(111,242,221,0.35)',
    ekgFade: 'rgba(15,23,42,0.055)',  // 浅色模式下示波器仍保留深色屏(仪器感,波形更清楚)
    hoverBg: 'rgba(15,23,42,0.05)',
    glow: () => 'none',
    numGlow: () => 'none',
    statTint: (c: string) => `${c}12`, statBorder: (c: string) => `${c}55`,
  },
};
type Theme = typeof THEMES.dark;

const fmtAway = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`);

/* ============ EKG 心电波形 · 全息示波器 ============
 * 多层渲染:极光渐变主波(面积发光填充) + 幽灵副波 + 粒子拖尾 + 扫描光束 + 峰值火花
 * 有人切出 → 全屏警报模式:配色转红、波形紊乱、边框呼吸
 */
const EKGWave = ({ focusRatio, awayCount, t }: { focusRatio: number; awayCount: number; t: Theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef({ focusRatio, awayCount, fade: t.ekgFade });
  dataRef.current = { focusRatio, awayCount, fade: t.ekgFade };
  const WAVE_CYAN = '#6ff2dd';
  const WAVE_RED = '#ff9daf';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let x = 0;
    let lastY: number | null = null;
    let ghostLastY: number | null = null;
    let spikePhase = 0;
    let tick = 0;
    // 粒子系统:扫描点经过峰值时喷出火花
    const particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, clientWidth, clientHeight);
      x = 0; lastY = null; ghostLastY = null;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0) { raf = requestAnimationFrame(draw); return; }
      const midY = h * 0.58;
      const { focusRatio: fr, awayCount: ac, fade } = dataRef.current;
      const alert = ac > 0;
      const main = alert ? WAVE_RED : WAVE_CYAN;
      const accent = alert ? '#ff5c8a' : '#7dd3fc';   // 副波:警报玫红 / 平时天蓝
      tick++;

      // 尾迹淡出
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);

      const speed = 1.8;
      const nx = x + speed;
      spikePhase += 0.045;

      // --- 主波形 ---
      const jitter = alert ? (Math.random() - 0.5) * 6 : 0;   // 警报时波形紊乱
      const calm = Math.sin(nx * 0.045) * (3 + (1 - fr) * 5)
                 + Math.sin(nx * 0.011 + 2) * 2.5 + jitter;
      const beatT = (nx * 0.02 + spikePhase) % (Math.PI * 2);
      let spike = 0;
      let atPeak = false;
      if (beatT < 0.5) {
        const k = beatT / 0.5;
        const amp = 10 + Math.min(ac, 5) * 9;
        spike = -Math.sin(k * Math.PI) * amp;
        if (beatT > 0.25) spike *= -0.45;
        atPeak = k > 0.4 && k < 0.6;
      }
      const ny = midY + calm + spike;

      // --- 幽灵副波(反相低频,错开半个屏幕,若隐若现) ---
      const gy = midY + Math.sin((nx + w / 2) * 0.03) * 6 + Math.cos(nx * 0.008) * 4;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ghostLastY ?? gy);
      ctx.lineTo(nx, gy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ghostLastY = gy;

      // --- 主波:垂直渐变描边 + 双层辉光 ---
      const grad = ctx.createLinearGradient(0, midY - 40, 0, midY + 30);
      grad.addColorStop(0, alert ? '#ffd3e0' : '#d9fffa');
      grad.addColorStop(0.5, main);
      grad.addColorStop(1, accent);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.shadowColor = main;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(x, lastY ?? ny);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      // 第二层细芯线(白热感)
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, lastY ?? ny);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      // --- 波下发光面积(极光垂幕) ---
      const areaGrad = ctx.createLinearGradient(0, ny, 0, midY + 34);
      areaGrad.addColorStop(0, alert ? 'rgba(255,92,138,0.22)' : 'rgba(111,242,221,0.20)');
      areaGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = areaGrad;
      ctx.fillRect(x, Math.min(ny, midY + 34), speed + 0.5, Math.abs(midY + 34 - ny));

      // --- 峰值火花粒子 ---
      if (atPeak && particles.length < 60) {
        for (let i = 0; i < (alert ? 5 : 3); i++) {
          particles.push({
            x: nx, y: ny,
            vx: (Math.random() - 0.2) * 1.6,
            vy: -Math.random() * 1.8 - 0.4,
            life: 1,
            color: Math.random() > 0.5 ? main : '#ffffff',
          });
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 0.025;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life * 0.9;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;

      lastY = ny;
      x = nx;
      if (x > w) { x = 0; lastY = null; ghostLastY = null; }

      // --- 扫描光柱(竖直光束跟着扫描点) ---
      const beam = ctx.createLinearGradient(x - 14, 0, x + 2, 0);
      beam.addColorStop(0, 'rgba(0,0,0,0)');
      beam.addColorStop(1, alert ? 'rgba(255,92,138,0.14)' : 'rgba(111,242,221,0.12)');
      ctx.fillStyle = beam;
      ctx.fillRect(x - 14, 0, 16, h);

      // --- 扫描点:呼吸光环 + 十字准星 ---
      const pulse = 2.4 + Math.sin(tick * 0.25) * 0.9;
      ctx.strokeStyle = main;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, ny, pulse + 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(x - 9, ny); ctx.lineTo(x + 9, ny);
      ctx.moveTo(x, ny - 9); ctx.lineTo(x, ny + 9);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = main;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, ny, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const pct = Math.round(focusRatio * 100);
  const alert = awayCount > 0;
  const frameColor = alert ? WAVE_RED : WAVE_CYAN;
  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden"
      style={{ background: t.ekgBg }}
      animate={{
        boxShadow: alert
          ? ['0 0 0px rgba(255,157,175,0)', '0 0 26px rgba(255,157,175,0.4)', '0 0 0px rgba(255,157,175,0)']
          : '0 0 14px rgba(111,242,221,0.10)',
        borderColor: alert ? 'rgba(255,157,175,0.6)' : 'rgba(111,242,221,0.25)',
      }}
      transition={alert ? { duration: 1.4, repeat: Infinity } : { duration: 0.5 }}
      // border 必须真实存在才能被 animate 上色
      initial={false}
      // @ts-ignore framer-motion style passthrough
      // eslint-disable-next-line
      {...{}}
    >
      <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ border: `1px solid ${alert ? 'rgba(255,157,175,0.55)' : 'rgba(111,242,221,0.22)'}` }} />
      {/* 四角 HUD 括号 */}
      {[
        'top-1.5 left-1.5 border-t-2 border-l-2 rounded-tl',
        'top-1.5 right-1.5 border-t-2 border-r-2 rounded-tr',
        'bottom-1.5 left-1.5 border-b-2 border-l-2 rounded-bl',
        'bottom-1.5 right-1.5 border-b-2 border-r-2 rounded-br',
      ].map(cls => (
        <span key={cls} className={`absolute w-3.5 h-3.5 pointer-events-none ${cls}`} style={{ borderColor: `${frameColor}88` }} />
      ))}
      {/* 网格底 + 中线 */}
      <div
        className="absolute inset-0 opacity-[0.13] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(${t.ekgGrid} 1px, transparent 1px), linear-gradient(90deg, ${t.ekgGrid} 1px, transparent 1px)`,
          backgroundSize: '28px 28px',
        }}
      />
      <canvas ref={canvasRef} className="w-full h-32 md:h-40 block relative" />
      {/* 左上标签:状态灯 + 打字机式标题 */}
      <div className="absolute top-2.5 left-4 flex items-center gap-2 text-xs font-mono tracking-[0.25em]" style={{ color: 'rgba(226,232,240,0.9)' }}>
        <span className="relative flex h-2 w-2">
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full"
            style={{ background: frameColor }}
            animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
            transition={{ duration: alert ? 0.8 : 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: frameColor, boxShadow: `0 0 6px ${frameColor}` }} />
        </span>
        班级专注度
        <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} style={{ color: frameColor }}>▌</motion.span>
      </div>
      {/* 右上:大号百分比翻牌 */}
      <div className="absolute top-1.5 right-4 flex items-baseline gap-1">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={pct}
            initial={{ y: -14, opacity: 0, filter: 'blur(4px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: 14, opacity: 0, filter: 'blur(4px)' }}
            className="text-2xl md:text-3xl font-black font-mono leading-none"
            style={{ color: frameColor, textShadow: `0 0 16px ${frameColor}99` }}
          >
            {pct}
          </motion.span>
        </AnimatePresence>
        <span className="text-xs font-mono" style={{ color: `${frameColor}aa` }}>%</span>
      </div>
      {/* 底部状态条 */}
      <div className="absolute bottom-2 left-4 right-4 flex items-center justify-between text-[10px] font-mono tracking-widest pointer-events-none" style={{ color: 'rgba(148,163,184,0.55)' }}>
        <span>{alert ? '⚠ SIGNAL LOST × ' + awayCount : '● LIVE MONITORING'}</span>
        <span>15s HEARTBEAT · 5s SCAN</span>
      </div>
    </motion.div>
  );
};

/** 学生行迷你活动波 */
const MiniWave = ({ color, active }: { color: string; active: boolean }) => (
  <svg viewBox="0 0 64 16" className="w-16 h-4 shrink-0 opacity-80">
    <motion.path
      d="M0 8 L8 8 L11 3 L15 13 L18 8 L30 8 L33 5 L36 11 L39 8 L52 8 L55 4 L58 12 L61 8 L64 8"
      fill="none"
      stroke={color}
      strokeWidth="1.4"
      strokeLinecap="round"
      initial={{ pathLength: 0 }}
      animate={active
        ? { pathLength: [0, 1], opacity: [0.9, 0.9, 0.3] }
        : { pathLength: 1, opacity: 0.22 }}
      transition={active ? { duration: 2.2, repeat: Infinity, ease: 'linear' } : { duration: 0.4 }}
    />
  </svg>
);

/* ============ 主页面 ============ */

const TeacherLiveClassroom = () => {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  // 今日统计(60 秒一刷,与 5 秒实时轮询分频)
  const [daily, setDaily] = useState<DailyStatRow[]>([]);
  const [showDaily, setShowDaily] = useState(true);
  const dailyTimerRef = useRef<ReturnType<typeof setInterval>>();
  // 今日签到(60 秒随 daily 一起刷)
  const [checkins, setCheckins] = useState<CheckinData | null>(null);
  const [showCheckins, setShowCheckins] = useState(true);
  // 学生最近任务抽屉
  const [drawerStudent, setDrawerStudent] = useState<{ id: number; name: string } | null>(null);
  const [drawerActs, setDrawerActs] = useState<StudentActivity[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const openStudentDrawer = async (id: number, name: string) => {
    setDrawerStudent({ id, name });
    setDrawerLoading(true);
    try {
      const r = await axios.get(`${API_BASE_URL}/teacher/recent-activities`, {
        headers: authHeaders(),
        params: { days: 7, limit: 30, student_id: id },
      });
      setDrawerActs(r.data?.activities ?? []);
    } catch (e) {
      console.error('加载学生任务记录失败:', e);
      setDrawerActs([]);
    } finally {
      setDrawerLoading(false);
    }
  };
  // 主题:默认浅色(白天教室);记住选择
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem(THEME_KEY) as 'light' | 'dark') || 'light'
  );
  const t = THEMES[theme];
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  };

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });

  useEffect(() => {
    axios.get(`${API_BASE_URL}/teacher/classes`, { headers: authHeaders() })
      .then(r => {
        const list: ClassOption[] = Array.isArray(r.data) ? r.data : (r.data?.items ?? []);
        setClasses(list);
        if (list.length > 0) {
          // 恢复上次选中的班级(仍存在才用,否则回落第一个)
          const saved = Number(localStorage.getItem(CLASS_KEY));
          setClassId(list.some(c => c.id === saved) ? saved : list[0].id);
        } else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const pickClass = (id: number) => {
    setClassId(id);
    localStorage.setItem(CLASS_KEY, String(id));
  };

  const poll = useCallback(async (cid: number) => {
    try {
      const r = await axios.get(`${API_BASE_URL}/teacher/classes/${cid}/live`, { headers: authHeaders() });
      setSnap(r.data);
    } catch (e) {
      console.error('实时状态获取失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    poll(classId);
    timerRef.current = setInterval(() => {
      if (!document.hidden) poll(classId);
    }, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [classId, poll]);

  // 今日统计:进入/切班级立即拉一次,之后 60 秒一刷(数据是聚合口径,无需 5 秒级)
  const pollDaily = useCallback(async (cid: number) => {
    try {
      const r = await axios.get(`${API_BASE_URL}/teacher/classes/${cid}/daily-stats`, { headers: authHeaders() });
      setDaily(r.data?.students ?? []);
    } catch (e) {
      console.error('今日统计获取失败:', e);
    }
    try {
      const c = await axios.get(`${API_BASE_URL}/teacher/classes/${cid}/checkins`, { headers: authHeaders() });
      setCheckins(c.data);
    } catch (e) {
      console.error('签到列表获取失败:', e);
    }
  }, []);

  useEffect(() => {
    if (!classId) return;
    pollDaily(classId);
    dailyTimerRef.current = setInterval(() => {
      if (!document.hidden) pollDaily(classId);
    }, 60_000);
    return () => clearInterval(dailyTimerRef.current);
  }, [classId, pollDaily]);

  const counts = useMemo(() => {
    const c = { away: 0, distracted: 0, studying: 0, offline: 0 };
    snap?.students.forEach(s => { c[s.status] += 1; });
    return c;
  }, [snap]);

  const onlineActive = counts.studying + counts.distracted + counts.away;
  const focusRatio = onlineActive > 0 ? counts.studying / onlineActive : 1;

  // 今日统计聚合(班级层)+ 学生排行(按学词数降序,只列今天学过的)
  const dailyAgg = useMemo(() => {
    const active = daily.filter(d => d.words_learned > 0 || d.study_duration > 0);
    return {
      studiedCount: active.length,
      totalWords: active.reduce((s, d) => s + d.words_learned, 0),
      totalMinutes: Math.round(active.reduce((s, d) => s + d.study_duration, 0) / 60),
      avgAccuracy: active.length > 0
        ? Math.round(active.reduce((s, d) => s + d.accuracy_rate, 0) / active.length)
        : 0,
      rows: [...active].sort((a, b) => b.words_learned - a.words_learned),
    };
  }, [daily]);

  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}时${m % 60}分` : `${m}分钟`);

  const summary = [
    { key: 'studying', label: '学习中', value: counts.studying, color: t.cyan },
    { key: 'away', label: '切出页面', value: counts.away, color: t.red },
    { key: 'distracted', label: '疑似走神', value: counts.distracted, color: t.yellow },
    { key: 'offline', label: '离线', value: counts.offline, color: t.gray },
  ];

  return (
    <div className="min-h-screen" style={{ background: t.pageBg }}>
      {/* 顶栏 */}
      <nav className="sticky top-0 z-10 backdrop-blur-md" style={{ background: t.navBg, borderBottom: t.navBorder }}>
        <div className="max-w-4xl mx-auto px-5 py-3.5 flex items-center gap-3">
          <button onClick={() => navigate('/teacher/dashboard')} className="p-2 -ml-2 rounded-lg transition" style={{ color: t.dim }}
            onMouseEnter={e => (e.currentTarget.style.background = t.hoverBg)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold flex items-center gap-2.5 flex-1" style={{ color: t.text }}>
            <span className="relative flex h-2.5 w-2.5">
              <motion.span
                className="absolute inline-flex h-full w-full rounded-full"
                style={{ background: t.cyan }}
                animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: t.cyan }} />
            </span>
            实时课堂
            <span className="text-xs font-normal font-mono" style={{ color: t.dim }}>每 5 秒刷新</span>
          </h1>
          {/* 投屏大屏入口:新窗口打开,不影响当前操作;把新窗口拖去电视/投影即可 */}
          <button
            onClick={() => window.open(`/teacher/bigscreen${classId ? `?class=${classId}` : ''}`, '_blank', 'noopener')}
            title="教室大屏(新窗口打开,拖到电视屏幕全屏)"
            className="p-2 rounded-lg text-lg transition active:scale-90"
            style={{ background: t.selectBg, border: `1px solid ${t.selectBorder}` }}
          >
            📺
          </button>
          {/* 主题切换 */}
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
            className="p-2 rounded-lg text-lg transition active:scale-90"
            style={{ background: t.selectBg, border: `1px solid ${t.selectBorder}` }}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          {classes.length > 0 && (
            <select
              value={classId ?? ''}
              onChange={e => pickClass(Number(e.target.value))}
              className="rounded-lg px-3 py-1.5 text-sm [&>option]:text-gray-800"
              style={{ background: t.selectBg, border: `1px solid ${t.selectBorder}`, color: t.text }}
            >
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-5 py-7 space-y-6">
        {/* EKG 波形 */}
        {snap && <EKGWave focusRatio={focusRatio} awayCount={counts.away} t={t} />}

        {/* 警报条 */}
        <AnimatePresence>
          {counts.away > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: t.alertBg, border: `1px solid ${t.alertBorder}` }}>
                <motion.span
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: t.red }}
                />
                <span className="text-[15px] font-medium" style={{ color: t.red }}>
                  {counts.away} 名学生切出了学习页面,已在下方标出
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 状态计数大卡片 */}
        {snap && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {summary.map(c => (
                <div
                  key={c.key}
                  className="rounded-2xl px-4 py-4 text-center"
                  style={{ background: t.statTint(c.color), border: `1px solid ${t.statBorder(c.color)}` }}
                >
                  <div className="flex items-center justify-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color, boxShadow: t.glow(c.color) }} />
                    <span className="text-sm font-medium" style={{ color: t.sub }}>{c.label}</span>
                  </div>
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={c.value}
                      initial={{ y: -12, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 12, opacity: 0 }}
                      className="text-4xl font-bold font-mono leading-none"
                      style={{ color: c.color, textShadow: t.numGlow(c.color) }}
                    >
                      {c.value}
                    </motion.div>
                  </AnimatePresence>
                  <div className="text-xs mt-1.5 font-mono" style={{ color: t.dimmer }}>人</div>
                </div>
              ))}
            </div>
            <div className="text-right mt-2 text-sm font-mono" style={{ color: t.dim }}>
              在线 {snap.online_count}/{snap.total_students}
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20">
            <motion.div
              className="inline-block w-9 h-9 rounded-full mb-4"
              style={{ border: `2px solid ${t.statBorder(t.cyan)}`, borderTopColor: t.cyan }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
            />
            <p className="text-sm" style={{ color: t.sub }}>连接教室中…</p>
          </div>
        ) : !snap || (snap.students.length === 0 && snap.never_seen.length === 0) ? (
          <div className="text-center py-16 rounded-2xl" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
            <div className="text-4xl mb-3">🏫</div>
            <p style={{ color: t.sub }}>{classes.length === 0 ? '你还没有班级' : '这个班还没有学生'}</p>
          </div>
        ) : (
          <>
            <motion.div layout className="space-y-2.5">
              <AnimatePresence>
                {snap.students.map(s => {
                  const color = s.status === 'away' ? t.red : s.status === 'distracted' ? t.yellow : s.status === 'studying' ? t.cyan : t.gray;
                  return (
                    <motion.div
                      key={s.user_id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      onClick={() => openStudentDrawer(s.user_id, s.student_name)}
                      title="点击查看最近做过的任务"
                      className="rounded-xl px-4 py-3.5 flex items-center gap-4 cursor-pointer"
                      style={{
                        background: s.status === 'away' ? t.awayBg : t.cardBg,
                        border: `1px solid ${s.status === 'away' ? t.awayBorder : t.cardBorder}`,
                        opacity: s.status === 'offline' ? 0.6 : 1,
                        boxShadow: theme === 'light' ? '0 1px 3px rgba(15,23,42,0.05)' : 'none',
                      }}
                    >
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        {(s.status === 'studying' || s.status === 'away') && (
                          <motion.span
                            className="absolute inline-flex h-full w-full rounded-full"
                            style={{ background: color }}
                            animate={{ scale: [1, 2.1], opacity: [0.45, 0] }}
                            transition={{ duration: s.status === 'away' ? 1.1 : 2, repeat: Infinity, ease: 'easeOut' }}
                          />
                        )}
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: color }} />
                      </span>

                      <div className="flex-1 min-w-0">
                        <p className="truncate" style={{ color: t.text }}>
                          <span className="font-semibold text-[15px]">{s.student_name}</span>
                          <span className="ml-2.5 text-[13px] font-medium" style={{ color }}>
                            {s.status === 'away' && (s.away_seconds >= 180
                              ? `离开很久了(约 ${Math.floor(s.away_seconds / 60)} 分钟)`
                              : `已切出 ${fmtAway(s.away_seconds)}`)}
                            {s.status === 'distracted' && '页面在但没操作'}
                            {s.status === 'studying' && '专注学习中'}
                            {s.status === 'offline' && `${Math.max(1, Math.floor(s.last_seen_ago / 60))} 分钟前在线`}
                          </span>
                        </p>
                        <p className="text-xs mt-1 truncate" style={{ color: t.dim }}>
                          {s.unit_name || '—'}
                        </p>
                      </div>

                      <MiniWave color={color} active={s.status === 'studying'} />

                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {s.switch_count_today > 0 && (
                          <span
                            className="text-xs font-mono font-medium px-2 py-1 rounded-md whitespace-nowrap"
                            style={s.switch_count_today > 5
                              ? { color: t.red, border: `1px solid ${t.awayBorder}`, background: t.awayBg }
                              : { color: t.sub, border: `1px solid ${t.cardBorder}` }}
                          >
                            切屏 {s.switch_count_today}
                          </span>
                        )}
                        {s.distracted_count_today > 0 && (
                          <span
                            className="text-xs font-mono font-medium px-2 py-1 rounded-md whitespace-nowrap"
                            style={s.distracted_count_today > 5
                              ? { color: t.red, border: `1px solid ${t.awayBorder}`, background: t.awayBg }
                              : { color: t.sub, border: `1px solid ${t.cardBorder}` }}
                          >
                            走神 {s.distracted_count_today}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>

            {/* ===== 今日签到 ===== */}
            {checkins && (
              <div className="pt-4">
                <button
                  onClick={() => setShowCheckins(v => !v)}
                  className="w-full flex items-center gap-2 px-1 mb-3 text-left"
                >
                  <span className="text-base font-semibold" style={{ color: t.text }}>📍 今日签到</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-mono font-semibold"
                    style={{
                      color: checkins.checked_count === checkins.total_students ? t.cyan : t.yellow,
                      border: `1px solid ${t.cardBorder}`,
                    }}
                  >
                    {checkins.checked_count}/{checkins.total_students}
                  </span>
                  <span
                    onClick={(e) => { e.stopPropagation(); navigate('/teacher/checkins', { state: { from: 'live' } }); }}
                    className="text-xs cursor-pointer hover:underline"
                    style={{ color: t.cyan }}
                  >
                    完整记录 / 查历史 →
                  </span>
                  <motion.span className="ml-auto text-sm" style={{ color: t.dim }} animate={{ rotate: showCheckins ? 0 : -90 }}>
                    ▾
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {showCheckins && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden space-y-3"
                    >
                      {/* 已签到:时间升序,前3名奖牌 */}
                      {checkins.checked.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {checkins.checked.map(c => (
                            <span
                              key={c.user_id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
                              style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, color: t.text }}
                            >
                              {c.rank <= 3 && <span>{['🥇', '🥈', '🥉'][c.rank - 1]}</span>}
                              {c.student_name}
                              <span className="text-xs font-mono" style={{ color: t.dim }}>{c.checkin_time}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 未签到 */}
                      {checkins.unchecked.length > 0 ? (
                        <div>
                          <p className="text-xs mb-1.5 px-1" style={{ color: t.red }}>
                            还没签到({checkins.unchecked.length} 人)
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {checkins.unchecked.map(s => (
                              <span
                                key={s.user_id}
                                className="px-3 py-1.5 rounded-lg text-sm"
                                style={{ background: t.awayBg, border: `1px solid ${t.awayBorder}`, color: t.red }}
                              >
                                {s.student_name}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : checkins.checked.length > 0 && (
                        <p className="text-sm px-1" style={{ color: t.cyan }}>🎉 全班都签到了</p>
                      )}
                      {checkins.checked.length === 0 && checkins.unchecked.length === 0 && (
                        <p className="text-sm px-1" style={{ color: t.dim }}>这个班还没有学生</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* ===== 今日统计 ===== */}
            <div className="pt-4">
              <button
                onClick={() => setShowDaily(v => !v)}
                className="w-full flex items-center gap-2 px-1 mb-3 text-left"
              >
                <span className="text-base font-semibold" style={{ color: t.text }}>📊 今日统计</span>
                <span className="text-xs font-mono" style={{ color: t.dimmer }}>每分钟更新</span>
                <motion.span
                  className="ml-auto text-sm"
                  style={{ color: t.dim }}
                  animate={{ rotate: showDaily ? 0 : -90 }}
                >
                  ▾
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {showDaily && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    {/* 班级汇总四格 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {[
                        { label: '今天学过的人', value: `${dailyAgg.studiedCount}`, unit: `/${snap.total_students}人` },
                        { label: '全班学词', value: `${dailyAgg.totalWords}`, unit: '词' },
                        { label: '全班学习时长', value: fmtMin(dailyAgg.totalMinutes), unit: '' },
                        { label: '平均正确率', value: `${dailyAgg.avgAccuracy}`, unit: '%' },
                      ].map(item => (
                        <div
                          key={item.label}
                          className="rounded-xl px-4 py-3 text-center"
                          style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
                        >
                          <div className="text-2xl font-bold font-mono" style={{ color: t.text }}>
                            {item.value}<span className="text-sm font-normal ml-0.5" style={{ color: t.dim }}>{item.unit}</span>
                          </div>
                          <div className="text-xs mt-1" style={{ color: t.dim }}>{item.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* 学生排行:今天学过的,按词数降序 */}
                    {dailyAgg.rows.length > 0 ? (
                      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${t.cardBorder}` }}>
                        {dailyAgg.rows.map((d, i) => {
                          const maxWords = dailyAgg.rows[0]?.words_learned || 1;
                          return (
                            <div
                              key={d.user_id}
                              onClick={() => openStudentDrawer(d.user_id, d.full_name)}
                              title="点击查看最近做过的任务"
                              className="relative flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:brightness-95 transition"
                              style={{
                                background: t.cardBg,
                                borderTop: i > 0 ? `1px solid ${t.cardBorder}` : 'none',
                              }}
                            >
                              {/* 词数比例条(打底) */}
                              <div
                                className="absolute inset-y-0 left-0 pointer-events-none"
                                style={{
                                  width: `${(d.words_learned / maxWords) * 100}%`,
                                  background: `${t.cyan}${theme === 'light' ? '14' : '10'}`,
                                }}
                              />
                              <span className="relative text-xs font-mono w-5 text-center shrink-0" style={{ color: i < 3 ? t.cyan : t.dimmer }}>
                                {i + 1}
                              </span>
                              <span className="relative text-sm font-medium flex-1 truncate" style={{ color: t.text }}>
                                {d.full_name}
                              </span>
                              <span className="relative text-xs font-mono shrink-0" style={{ color: t.sub }}>
                                {d.words_learned} 词
                              </span>
                              <span className="relative text-xs font-mono shrink-0 w-16 text-right" style={{ color: t.dim }}>
                                {fmtMin(Math.round(d.study_duration / 60))}
                              </span>
                              <span
                                className="relative text-xs font-mono shrink-0 w-12 text-right"
                                style={{ color: d.accuracy_rate >= 80 ? t.cyan : d.accuracy_rate >= 60 ? t.yellow : t.red }}
                              >
                                {d.accuracy_rate}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 rounded-xl" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
                        <p className="text-sm" style={{ color: t.dim }}>今天还没有人学习</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {snap.never_seen.length > 0 && (
              <div className="pt-2">
                <p className="text-sm mb-2.5 px-1" style={{ color: t.dim }}>
                  今天还没打开学习页({snap.never_seen.length} 人)
                </p>
                <div className="flex flex-wrap gap-2">
                  {snap.never_seen.map(s => (
                    <span
                      key={s.user_id}
                      className="px-3 py-1.5 rounded-lg text-sm"
                      style={{ background: t.chipBg, border: `1px solid ${t.chipBorder}`, color: t.sub }}
                    >
                      {s.student_name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 学生最近任务抽屉 */}
      <AnimatePresence>
        {drawerStudent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex justify-end"
            onClick={() => setDrawerStudent(null)}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="w-full max-w-md h-full overflow-y-auto"
              style={{ background: theme === 'light' ? '#f8fafc' : '#0d142b' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 px-5 py-4 flex items-center gap-3 backdrop-blur-md"
                   style={{ background: t.navBg, borderBottom: t.navBorder }}>
                <h3 className="font-semibold flex-1" style={{ color: t.text }}>
                  📋 {drawerStudent.name} · 最近 7 天做过的任务
                </h3>
                <button
                  onClick={() => setDrawerStudent(null)}
                  className="p-1.5 rounded-lg text-lg leading-none"
                  style={{ color: t.dim }}
                >
                  ✕
                </button>
              </div>
              <div className="p-4 space-y-2">
                {drawerLoading ? (
                  <p className="text-center py-10 text-sm" style={{ color: t.dim }}>加载中…</p>
                ) : drawerActs.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-2">🌱</div>
                    <p className="text-sm" style={{ color: t.dim }}>最近 7 天没有完成记录</p>
                  </div>
                ) : (
                  drawerActs.map((a, i) => (
                    <div
                      key={i}
                      className="rounded-xl px-4 py-3 flex items-center gap-3"
                      style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
                    >
                      <span className="text-lg shrink-0">{a.type === 'homework' ? '📘' : '✅'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: t.text }}>
                          {a.type === 'homework' ? '完成作业:' : '学完:'}{a.title}
                        </p>
                        <p className="text-xs mt-0.5 font-mono" style={{ color: t.dim }}>{a.time}</p>
                      </div>
                      {a.score !== null && (
                        <span
                          className="shrink-0 text-xs font-bold px-2 py-1 rounded-full"
                          style={{
                            color: a.score >= 80 ? t.cyan : a.score >= 60 ? t.yellow : t.red,
                            border: `1px solid ${t.cardBorder}`,
                          }}
                        >
                          {a.score}分
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherLiveClassroom;
