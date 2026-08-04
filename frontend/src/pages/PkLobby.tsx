import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Brain, ChevronDown, CircleAlert, DoorOpen, Eye, Flag, Gauge, House, Swords, Trophy, Users } from 'lucide-react';
import axios from 'axios';
import { pkApi, type MyRoomItem } from '../api/pk';
import PkInviteModal from '../components/pk/PkInviteModal';
import { tournamentApi, type MyMatch } from '../api/tournament';
import { toast } from '../components/Toast';
import { useClampedNumber } from '../hooks/useClampedNumber';

const QUICK_COUNTS = [2, 10, 30, 50, 100];
const WORD_COUNTS = [5, 10, 20, 50];
// 分组赛的组由教师建房时自己建并命名(学生进房后自选);与后端 manager.MAX_TEAMS 一致
const MIN_TEAMS = 2, MAX_TEAMS = 8;
// 词数上限与后端 PkRoomCreate.word_count (ge=4, le=200) 一致。
// 实际生效题量 = min(这里设定值, 全场背得最少的学生的词汇量),开局时后端统一压,
// 所以填大只等于"用满该学生会的全部词",不会出超纲题。
const MIN_WORDS = 4, MAX_WORDS = 200;
const MIN_PLAYERS = 2;
// 与后端 CreateRoomRequest.max_players (le=200) 及库里 CHECK 一致。
// 实时榜已改为合并推送 + 按人裁剪,带宽不再随人数²暴涨,大房间可放心开
const MAX_PLAYERS = 200;

/** 从 localStorage 读当前角色(教师=组织者建房;学生=凭码加入)。 */
function getRole(): string {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').role || 'student';
  } catch {
    return 'student';
  }
}

export default function PkLobby() {
  const navigate = useNavigate();
  const role = getRole();
  const isTeacher = role === 'teacher' || role === 'admin';
  // 人数/词数都是「输入中不 clamp、失焦才收敛」,统一走 useClampedNumber
  const players = useClampedNumber(MIN_PLAYERS, MAX_PLAYERS, 4);
  const words = useClampedNumber(MIN_WORDS, MAX_WORDS, 10);
  const maxPlayers = players.value;
  const wordCount = words.value;
  const [mode, setMode] = useState<'individual' | 'team'>('individual');
  // 分组赛的组名(教师自己填);默认给两组占位,想多分就点「添加一组」
  const [teamNames, setTeamNames] = useState<string[]>(['', '']);
  const [countdownMin, setCountdownMin] = useState(5);  // 全场倒计时(分钟)
  // 同题公平赛(默认开):全员考「所有人都背过」的同一批词,先背完者分数必然最高。
  // 关掉则各考各背过的词(共同背过的词太少开不了同题局时的退路)
  const [sameWords, setSameWords] = useState(true);
  const [inviteCode, setInviteCode] = useState('');
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [createError, setCreateError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [creating, setCreating] = useState(false);
  const [roomAction, setRoomAction] = useState<'join' | 'spectate' | null>(null);
  const [myMatches, setMyMatches] = useState<MyMatch[]>([]);
  const [entering, setEntering] = useState<number | null>(null);
  const [myRooms, setMyRooms] = useState<MyRoomItem[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const navTimer = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => () => {
    if (navTimer.current !== null) window.clearTimeout(navTimer.current);
  }, []);

  // 教师大厅:我还开着的房间(切网页不再自动回收)。进大厅拉一次 + 每 15 秒刷在线数
  const loadMyRooms = () => pkApi.myRooms().then(setMyRooms).catch(() => {});
  useEffect(() => {
    if (!isTeacher) return;
    loadMyRooms();
    const t = setInterval(() => { if (!document.hidden) loadMyRooms(); }, 15000);
    return () => clearInterval(t);
  }, [isTeacher]);

  const handleDeleteRoom = async (roomId: number) => {
    if (!window.confirm('确定删除这个房间?房间里的学生会被请出。')) return;
    setDeleting(roomId);
    try {
      await pkApi.deleteRoom(roomId);
      setMyRooms((rs) => rs.filter((r) => r.room_id !== roomId));
    } catch (e: unknown) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.detail : undefined;
      toast.error(detail || '删除失败');
    } finally {
      setDeleting(null);
    }
  };

  // 晋级赛待打对局:仅学生需要(进大厅拉一次 + 每 20 秒刷,对手先开好房后能拿到 invite_code)
  useEffect(() => {
    if (isTeacher) return;
    const load = () => tournamentApi.myMatches().then(setMyMatches).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(t);
  }, [isTeacher]);

  const enterMatch = async (m: MyMatch) => {
    setEntering(m.match_id);
    try {
      const r = await tournamentApi.enterMatch(m.match_id);
      navigate(`/pk/arena/${r.room_id}`);
    } catch (e: unknown) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.detail : undefined;
      toast.error(detail === 'MATCH_ALREADY_FINISHED' ? '这场对局已结束' : detail || '进入对局失败');
      setEntering(null);
      tournamentApi.myMatches().then(setMyMatches).catch(() => {});
    }
  };

  const handleCreate = async () => {
    setCreateError('');
    setCreating(true);
    try {
      // 取输入框当前文本再 clamp:打完数字直接点"创建"不会触发 onBlur,
      // 只读 state 会漏掉最后一次输入
      // commit():以输入框当前文本为准取最终值 —— 打完数字直接点创建不会触发 onBlur
      const finalWords = words.commit();
      const finalPlayers = players.commit();
      const data = await pkApi.createRoom(
        finalPlayers, finalWords, mode, countdownMin * 60,
        mode === 'team' ? teamNames : [],
        sameWords,
      );
      setShowInvite(data.invite_code);
      loadMyRooms();
      navTimer.current = window.setTimeout(() => navigate(`/pk/arena/${data.room_id}`), 1500);
    } catch (e: unknown) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.detail : undefined;
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      const fallbackMessage = e instanceof Error ? e.message : '创建失败';
      const msg = detail === 'USER_ALREADY_IN_ROOM'
        ? '你有一场对战正在进行中,请先进去点「结束本场对战」再创建新房'
        : status === 403
          ? '只有教师可以创建 PK 房间'
          : detail || fallbackMessage;
      setCreateError(msg);
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (roomAction) return;
    setJoinError('');
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      setJoinError('请输入完整的 6 位邀请码');
      return;
    }
    setRoomAction('join');
    try {
      const data = await pkApi.joinRoomByCode(code);
      navigate(`/pk/arena/${data.room_id}`);
    } catch (e: unknown) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.detail : undefined;
      const fallbackMessage = e instanceof Error ? e.message : '加入失败';
      const errorMap: Record<string, string> = {
        ROOM_NOT_FOUND: '邀请码无效',
        ROOM_FINISHED: '该房间的 PK 已结束',
        ROOM_FULL: '房间已满，可以点“观战”进入比赛',
        ROOM_ALREADY_STARTED: '房间已开始，可以点“观战”进入比赛',
        USER_ALREADY_IN_ROOM: '你已在另一个 PK 房间中',
      };
      setJoinError(errorMap[detail] || detail || fallbackMessage);
      setRoomAction(null);
    }
  };

  const handleSpectate = async () => {
    if (roomAction) return;
    setJoinError('');
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      setJoinError('请输入完整的 6 位邀请码');
      return;
    }
    setRoomAction('spectate');
    try {
      const data = await pkApi.spectateByCode(code);
      navigate(`/pk/arena/${data.room_id}`);
    } catch (e: unknown) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.detail : undefined;
      const fallbackMessage = e instanceof Error ? e.message : '观战失败';
      const errorMap: Record<string, string> = {
        ROOM_NOT_FOUND: '邀请码无效',
        ROOM_FINISHED: '该房间的 PK 已结束',
        SPECTATORS_FULL: '观众席满啦(30 人)',
      };
      setJoinError(errorMap[detail] || detail || fallbackMessage);
      setRoomAction(null);
    }
  };

  const highlights = isTeacher
    ? [
        { label: '老师组织，不下场答题', icon: Gauge },
        { label: '每人练自己学过的词', icon: Brain },
        { label: '全场题量统一', icon: Users },
        { label: '总分高者获胜', icon: Trophy },
      ]
    : [
        { label: '只考自己学过的词', icon: Brain },
        { label: '不会的词继续巩固', icon: Gauge },
        { label: '掌握更多，得分更高', icon: Flag },
      ];

  const steps = isTeacher
    ? [
        ['1', '创建房间', '设置人数、题量和时间'],
        ['2', '发送邀请码', '学生进入后准备或选组'],
        ['3', '开始比赛', '查看实时进度，结束后出榜'],
      ]
    : [
        ['1', '输入邀请码', '加入老师创建的房间'],
        ['2', '完成三关', '分类、听写、过关检测'],
        ['3', '争取高分', '掌握更多，完成更快'],
      ];

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-5 sm:py-8">
        <button
          type="button"
          onClick={() => navigate(isTeacher ? '/teacher/dashboard' : '/student/dashboard')}
          className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-ink-mute transition hover:bg-orange-50 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          返回主页
        </button>

        {/* 竞技场简介 */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="student-colorful-surface relative mb-5 overflow-hidden rounded-2xl border border-orange-200 p-5 sm:p-8"
        >
          <span className="absolute right-5 top-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-accent-warm sm:right-7 sm:top-7 sm:h-14 sm:w-14" aria-hidden="true">
            <Swords className="h-6 w-6 sm:h-7 sm:w-7" />
          </span>
          <h1 className="font-display pr-16 text-2xl font-semibold text-ink sm:text-4xl">PK 竞技场</h1>
          <p className="mt-2 max-w-xl pr-8 text-sm leading-6 text-ink-soft sm:pr-16 sm:text-base">
            {isTeacher
              ? '你来组织,学生用分类记忆法同场竞速——掌握得最多、完成得最快的学生得分最高'
              : '用分类记忆法和同学同场竞速——掌握得越多、完成得越快,分数越高'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {highlights.map(({ label, icon: Icon }) => (
              <span key={label} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-xs font-medium text-ink-soft sm:text-sm">
                <Icon className="h-3.5 w-3.5 text-accent-warm" aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </motion.div>

        {/* 晋级赛待打对局:老师办的正式赛事,置顶醒目 */}
        {myMatches.length > 0 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.36, ease: [0.16, 1, 0.3, 1] }}
            className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Trophy className="h-5 w-5 text-amber-700" aria-hidden="true" />
              <h2 className="font-bold text-amber-900">晋级赛 · 你有 {myMatches.length} 场对局要打</h2>
            </div>
            <div className="space-y-2">
              {myMatches.map((m) => (
                <div key={m.match_id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 shadow-sm">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{m.tournament_name}</p>
                    <p className="text-xs text-ink-mute">
                      {m.stage === 'group' ? `小组赛` : m.stage === 'ko' ? '淘汰赛' : '黑马组'}
                      {' · 对阵 '}<span className="font-medium text-ink">{m.opponent_name}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => enterMatch(m)}
                    disabled={entering === m.match_id}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-accent-warm px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    <Swords className="h-4 w-4" aria-hidden="true" />
                    {entering === m.match_id ? '进入中…' : m.invite_code ? '对手在等你' : '开始对局'}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 我的房间(教师):切网页/关标签页后房间保留,回来在这里重进或删除 */}
        {isTeacher && myRooms.length > 0 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.36, ease: [0.16, 1, 0.3, 1] }}
            className="mb-5 rounded-2xl border border-orange-200 bg-orange-50/60 p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <House className="h-5 w-5 text-accent-warm" aria-hidden="true" />
              <h2 className="font-bold text-ink">我的房间 · {myRooms.length} 个进行中</h2>
              <span className="text-[11px] text-ink-mute">切网页也不会消失,用完记得删除</span>
            </div>
            <div className="space-y-2">
              {myRooms.map((r) => (
                <div key={r.room_id} className="flex flex-col gap-3 rounded-xl bg-white px-3 py-3 sm:flex-row sm:items-center">
                  <span className="font-numeric shrink-0 text-lg font-semibold tracking-[0.18em] text-accent-warm">{r.invite_code}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-soft">
                      {r.status === 'waiting' ? '等待中' : '对战中'}
                      {' · '}{r.mode === 'team' ? '分组赛' : '个人赛'}
                      {' · '}{r.word_count} 词
                    </p>
                    <p className="text-[11px] text-ink-mute">
                      {r.online_count}/{r.player_count} 人在线
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                    <button
                      onClick={() => navigate(`/pk/arena/${r.room_id}`)}
                      className="min-h-11 rounded-lg bg-accent-warm px-3.5 text-sm font-semibold text-white transition hover:opacity-90"
                    >
                      进入
                    </button>
                    <button
                      onClick={() => handleDeleteRoom(r.room_id)}
                      disabled={deleting === r.room_id}
                      className="min-h-11 rounded-lg bg-gray-100 px-3 text-sm font-medium text-ink-soft transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    >
                      {deleting === r.room_id ? '删除中…' : '删除'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 创建(教师) / 加入(学生) */}
        <div className={`grid grid-cols-1 gap-5 ${isTeacher ? 'md:grid-cols-2' : 'mx-auto max-w-2xl'}`}>
          {/* 创建房间:仅教师(组织者)可见 */}
          {isTeacher && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.08, duration: reduceMotion ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="card-soft rounded-2xl p-5 sm:p-6"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              <House className="h-5 w-5 text-accent-warm" aria-hidden="true" />
              创建房间
            </h2>
            <p className="text-xs text-ink-mute mb-4">你作为组织者建房、发码给学生,开局后监控战况(不下场答题)</p>

            {/* 模式切换:个人赛 / 分组赛 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">对战模式</label>
            <div className="flex gap-2 mb-4">
              {([
                { k: 'individual', label: '个人赛', desc: '各自排名' },
                { k: 'team', label: '分组赛', desc: '按小组比拼' },
              ] as const).map((m) => (
                <button
                  key={m.k}
                  onClick={() => setMode(m.k)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                    mode === m.k
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {m.label}
                  <span className={`block text-[10px] font-normal ${mode === m.k ? 'text-white/80' : 'text-ink-mute'}`}>{m.desc}</span>
                </button>
              ))}
            </div>

            {/* 分组赛:教师自己建组命名,学生进房后自己选组 */}
            {mode === 'team' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-ink-soft mb-2">
                  分组设置 <span className="text-ink-mute font-normal">(2~{MAX_TEAMS} 组,学生进房后自己选组)</span>
                </label>
                <div className="space-y-2">
                  {teamNames.map((name, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-6 text-center text-xs font-bold text-ink-mute">{i + 1}</span>
                      <input
                        type="text"
                        value={name}
                        maxLength={12}
                        placeholder={`第 ${i + 1} 组`}
                        aria-label={`第 ${i + 1} 组组名`}
                        onChange={(e) => setTeamNames(teamNames.map((n, j) => (j === i ? e.target.value : n)))}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:border-primary focus:outline-none"
                      />
                      <button
                        onClick={() => setTeamNames(teamNames.filter((_, j) => j !== i))}
                        disabled={teamNames.length <= MIN_TEAMS}
                        aria-label={`删除第 ${i + 1} 组`}
                        className="h-11 w-11 rounded-xl bg-gray-100 text-lg text-ink-mute transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                {teamNames.length < MAX_TEAMS && (
                  <button
                    onClick={() => setTeamNames([...teamNames, ''])}
                    className="mt-2 min-h-11 w-full rounded-xl border border-dashed border-orange-200 text-sm font-medium text-primary transition hover:bg-orange-50"
                  >
                    ＋ 添加一组
                  </button>
                )}
                <p className="text-[11px] text-ink-mute mt-2">
                  组名留空会自动叫「第N组」。学生在等待室点组名加入,你也能在那里帮他们改。
                </p>
              </div>
            )}

            {/* 人数步进器 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">
              房间人数 <span className="text-ink-mute font-normal">({MIN_PLAYERS}~{MAX_PLAYERS} 人,可自定义)</span>
            </label>
            <div className="flex items-center gap-4 mb-2">
              <button
                onClick={() => players.set(maxPlayers - 1)}
                disabled={maxPlayers <= MIN_PLAYERS}
                className="w-12 h-12 rounded-2xl bg-orange-100 text-primary text-2xl font-bold disabled:opacity-40 active:scale-95 transition"
              >
                −
              </button>
              <div className="flex-1 text-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={players.raw}
                  onChange={(e) => players.onChangeText(e.target.value)}
                  onBlur={players.onBlur}
                  className="w-24 text-center text-4xl font-bold text-primary font-numeric bg-transparent focus:outline-none"
                />
                <span className="text-base text-ink-mute">人</span>
              </div>
              <button
                onClick={() => players.set(maxPlayers + 1)}
                disabled={maxPlayers >= MAX_PLAYERS}
                className="w-12 h-12 rounded-2xl bg-orange-100 text-primary text-2xl font-bold disabled:opacity-40 active:scale-95 transition"
              >
                +
              </button>
            </div>
            <div className="flex gap-2 mb-5">
              {QUICK_COUNTS.map((n) => (
                <button
                  key={n}
                  onClick={() => players.set(n)}
                  className={`min-h-11 flex-1 rounded-xl text-sm font-medium transition ${
                    maxPlayers === n
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {n}人
                </button>
              ))}
            </div>

            {/* 题量(快捷档 + 自定义) */}
            <label className="block text-sm font-medium text-ink-soft mb-2">
              单词数量上限 <span className="text-ink-mute font-normal">({MIN_WORDS}~{MAX_WORDS} 词 · 实际按全场背得最少的学生统一)</span>
            </label>
            <div className="flex gap-2 mb-2">
              {WORD_COUNTS.map((n) => (
                <button
                  key={n}
                  onClick={() => words.set(n)}
                  className={`min-h-11 flex-1 rounded-xl text-sm font-semibold transition ${
                    wordCount === n
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {n} 词
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mb-6">
              <span className="text-xs text-ink-mute">自定义</span>
              {/* 失焦才 clamp:原来每敲一键就 clamp,想输 100 时打到 "1" 会被顶成 4,
                  三位数根本打不进去(上限从 30 放开到 200 后这个坑才显形) */}
              <input
                type="text"
                inputMode="numeric"
                value={words.raw}
                aria-label="自定义单词数量上限"
                onChange={(e) => words.onChangeText(e.target.value)}
                onBlur={words.onBlur}
                className="h-11 w-20 rounded-lg border border-gray-200 px-2 text-center text-sm"
              />
              <span className="text-xs text-ink-mute">词({MIN_WORDS}–{MAX_WORDS})</span>
            </div>

            {/* 全场倒计时 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">
              全场倒计时 <span className="text-ink-mute font-normal">(时间到比谁得分高)</span>
            </label>
            <div className="flex gap-2 mb-2">
              {[1, 3, 5, 8, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setCountdownMin(n)}
                  className={`min-h-11 flex-1 rounded-xl text-sm font-semibold transition ${
                    countdownMin === n
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {n} 分
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mb-6">
              <span className="text-xs text-ink-mute">自定义</span>
              <input
                type="number" min={1} max={30} value={countdownMin}
                onChange={(e) => setCountdownMin(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                className="h-11 w-20 rounded-lg border border-gray-200 px-2 text-center text-sm"
              />
              <span className="text-xs text-ink-mute">分钟(1–30)</span>
            </div>

            {/* 选词方式:同题公平赛(默认) / 各考各的 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">选词方式</label>
            <div className="flex gap-2 mb-2">
              {([
                { k: true, label: '同题公平赛', desc: '全员同一批词' },
                { k: false, label: '各考各的', desc: '各抽自己背过的词' },
              ] as const).map((m) => (
                <button
                  key={String(m.k)}
                  onClick={() => setSameWords(m.k)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                    sameWords === m.k
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {m.label}
                  <span className={`block text-[10px] font-normal ${sameWords === m.k ? 'text-white/80' : 'text-ink-mute'}`}>{m.desc}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-mute mb-6">
              {sameWords
                ? '从所有人共同背过的词里抽同一批,先背完的分数一定最高 —— 发奖品选这个。共同背过的词太少会开不了局'
                : '每人从自己背过的词里抽(词汇量差异大凑不出共同词时用),题量仍全场统一'}
            </p>

            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-glow min-h-12 w-full rounded-xl text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? '创建中…' : '创建并获取邀请码'}
            </button>
            {createError && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-error" role="alert">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{createError}</span>
              </p>
            )}
            <p className="text-[11px] text-ink-mute mt-3 text-center">
              {sameWords
                ? `全员考同一批共同背过的词(最多 ${wordCount} 词),`
                : `每个学生各考「自己背过的词」,题量按全场最少的学生统一(最多 ${wordCount} 词),`}
              走完分类→听写→过关全流程;总分(掌握分+速度分)最高者赢,{countdownMin} 分钟到点按当时总分排名
            </p>
          </motion.div>
          )}

          {/* 加入房间:学生凭老师发的邀请码进场 */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.1, duration: reduceMotion ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="card-soft flex flex-col rounded-2xl p-5 sm:p-6"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              <DoorOpen className="h-5 w-5 text-accent-warm" aria-hidden="true" />
              加入房间
            </h2>
            <p className="text-xs text-ink-mute mb-5">
              {isTeacher ? '也可以用邀请码进入别的老师开的房观战' : '输入老师发你的 6 位邀请码'}
            </p>

            <div className="flex-1 flex flex-col justify-center">
              <input
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
                  if (joinError) setJoinError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleJoin()}
                aria-label="6 位房间邀请码"
                aria-invalid={!!joinError}
                aria-describedby={joinError ? 'pk-join-error' : 'pk-join-help'}
                autoCapitalize="characters"
                autoComplete="one-time-code"
                className="w-full rounded-xl border border-orange-200 bg-white px-4 py-4 text-center font-numeric text-3xl font-semibold uppercase tracking-[0.32em] text-ink focus:border-primary focus:outline-none sm:text-4xl"
                maxLength={6}
                placeholder="ABC123"
              />
              {!isTeacher && (
                <button
                  onClick={handleJoin}
                  disabled={roomAction !== null}
                  className="btn-glow mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Swords className="h-5 w-5" aria-hidden="true" />
                  {roomAction === 'join' ? '正在加入…' : '加入对战'}
                </button>
              )}
              <button
                onClick={handleSpectate}
                disabled={roomAction !== null}
                className={`inline-flex min-h-12 w-full items-center justify-center gap-2 ${isTeacher ? 'mt-5' : 'mt-2.5'} rounded-xl bg-gray-100 text-base font-semibold text-ink-soft transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <Eye className="h-5 w-5" aria-hidden="true" />
                {roomAction === 'spectate' ? '正在进入观战…' : '观战（满员或已开局也能看）'}
              </button>
            </div>
            {joinError && (
              <p id="pk-join-error" className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-error" role="alert">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{joinError}</span>
              </p>
            )}
            <p id="pk-join-help" className="mt-3 text-center text-[11px] text-ink-mute">
              {isTeacher ? '学生在自己的 PK 大厅输入邀请码即可加入你的房间' : '没有邀请码?等老师创建房间后发给你'}
            </p>
          </motion.div>
        </div>

        {/* 玩法说明:教师看「怎么组织」,学生看「怎么打」 */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduceMotion ? 0 : 0.14, duration: reduceMotion ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="card-soft mt-5 rounded-2xl p-5 sm:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">玩法说明</h2>
              <p className="mt-1 text-xs text-ink-mute">先记住 3 步，详细规则需要时再看。</p>
            </div>
            <button
              type="button"
              onClick={() => setShowRules((visible) => !visible)}
              aria-expanded={showRules}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-accent-warm transition hover:bg-orange-50"
            >
              {showRules ? '收起规则' : '查看详细规则'}
              <ChevronDown className={`h-4 w-4 transition-transform ${showRules ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </div>

          <ol className="mt-5 grid border-y border-black/[0.06] sm:grid-cols-3 sm:divide-x sm:divide-black/[0.06]">
            {steps.map(([step, title, description]) => (
              <li key={step} className="flex gap-3 border-b border-black/[0.06] py-3.5 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:pl-0 sm:last:pr-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 font-numeric text-xs font-bold text-accent-warm">{step}</span>
                <div>
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-mute">{description}</p>
                </div>
              </li>
            ))}
          </ol>

          {showRules && (isTeacher ? (
            <div className="space-y-4 text-sm text-ink-soft leading-relaxed">
              <div>
                <p className="font-semibold text-ink mb-1">① 建房(你是组织者,全程不答题)</p>
                <p>选「个人赛 / 分组赛」→ 定房间人数、每人词数、<span className="font-semibold text-ink">全场倒计时</span>(1–30 分钟)→ 点创建,拿到 6 位邀请码发给学生。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">② 学生加入并自己选组</p>
                <p>学生在自己的 PK 大厅输入邀请码进房。分组赛里<span className="font-semibold text-ink">组由你建房时创建并命名</span>,学生进等待室后<span className="font-semibold text-ink">自己点组名加入</span>;个别学生没选或选错,你可以在竞技场里帮他指定,也能把人移出房间。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">③ 你开局并监控</p>
                <p>至少 2 名学生进房即可开局。分组赛还要求<span className="font-semibold text-ink">人人都选了组、且至少两组有人</span>(全挤在一组就没有对手了),没选组的学生名字会标「⚠️ 未选组」。开局后自动进<span className="font-semibold text-ink">全屏大屏监控台</span>,看每个学生的实时阶段与掌握进度,但不答题。随时可「提前结束」并出正式榜。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 选词:同题公平赛(默认)或各考各的</p>
                <p><span className="font-semibold text-ink">同题公平赛</span>:系统从「所有参赛学生都背过的词」里抽<span className="font-semibold text-ink">同一批词、同一顺序</span>发给每个人——同词同量同满分,先背完的分数一定最高,<span className="font-semibold text-ink">要发奖品就用这个</span>。共同背过的词不足 4 个会开不了局(让学生先把相同单元背齐)。</p>
                <p className="mt-1"><span className="font-semibold text-ink">各考各的</span>:每个学生各抽他自己背过的词,适合词汇量差异太大、凑不出共同词的场次。题量仍按全场背得最少的学生统一,大家工作量一样。</p>
                <p className="mt-1 text-ink-mute">两种方式下满分都 = 词数 × 100,全场统一——分数天花板人人相同,不因抽到什么词而变。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">⑤ 每人走一遍分类记忆法全流程</p>
                <p>词按 10 个一组,每组:🗂️<span className="font-medium text-ink">分类</span>(标熟悉/学过/陌生,<span className="font-semibold text-ink">夹生和陌生的词会反复出现直到全部标熟悉</span>)→ ✍️<span className="font-medium text-ink">听写</span>(拼错要照着抄对 3 遍,错词再复听一轮)→ 🏁<span className="font-medium text-ink">过关检测</span>(4 种题型随机:英译中/中译英/听音拼写/看义拼写,<span className="font-semibold text-ink">正确率≥60% 才过关</span>,不过则重考)。过关才进下一组。</p>
              </div>
              {/* 胜负规则 */}
              <div className="rounded-2xl bg-orange-50/70 border border-orange-100 p-3">
                <p className="font-semibold text-ink mb-1.5">🏁 怎么定胜负(重点)</p>
                <ul className="space-y-1 list-disc pl-4">
                  <li><span className="font-medium text-ink">总分最高的学生赢</span>。总分 = 掌握分 + 速度分,大屏柱子的高度就是总分,所以<span className="font-medium text-ink">柱子最高的就是第一名</span>,不用另外解释名次。</li>
                  <li><span className="font-medium text-ink">掌握分 = 掌握进度 × 满分</span>(满分 = 词数 × 100,全场统一)。进度封顶,所以<span className="font-medium text-ink">反复刷题刷不出分</span>,只有真把词掌握了才涨分。</li>
                  <li><span className="font-medium text-ink">速度分只有全部完成才拿</span>,完成越早拿得越多(最多为满分的 30%),<span className="font-medium text-ink">只要在倒计时内完成就一定是正分、且比后完成的人高</span>——所以先背完的人总分必然最高,柱子高低和名次永远对得上。</li>
                  <li><span className="font-medium text-ink">全员完成即立刻结算</span>,不用等倒计时走完;倒计时到点仍有人没做完,就按当时的总分排名。</li>
                  <li>同分时依次看:先完成者优先 → 总用时更短 → 答对更多。</li>
                  <li><span className="font-medium text-ink">分组赛按队内「人均得分」排名</span>——队里人多不占便宜,人少的队照样能赢。</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm text-ink-soft leading-relaxed">
              <div>
                <p className="font-semibold text-ink mb-1">① 加入老师的房间</p>
                <p>输入老师发你的 6 位邀请码,点「加入对战」。房满或已开局也能点「观战」看比赛。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">② 考的都是你们背过的词</p>
                <p>一般比赛里<span className="font-semibold text-ink">全场考同一批词</span>——从你们所有人都背过的单词里抽,题目、顺序、满分完全一样,<span className="font-medium text-ink">谁先背完谁分最高</span>,绝对公平。老师也可以设成「各考各的」:每人考自己背过的词。</p>
                <p className="mt-1"><span className="font-semibold text-ink">题量大家一样多</span>,满分也一样(词数 × 100)。所以<span className="font-medium text-ink">背得多不会被罚、背得少也占不到便宜</span>,比的就是谁掌握得更好更快。</p>
                <p className="mt-1 text-ink-mute">如果你背过的词还不到 4 个,老师就开不了局——先去学习模式多背一些再来。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">③ 单词分组,每组闯 3 关</p>
                <p>词按 10 个一组。每组要过:</p>
                <ul className="mt-1 space-y-1 list-disc pl-4">
                  <li>🗂️ <span className="font-medium text-ink">分类</span>:每个词标「熟悉/学过/陌生」。标成夹生或陌生的词<span className="font-semibold text-ink">会再出现,直到你把它们都标成熟悉</span>。</li>
                  <li>✍️ <span className="font-medium text-ink">听写</span>:听发音拼出来。拼错了要<span className="font-semibold text-ink">照着抄对 3 遍</span>,错过的词后面还会再听一遍。</li>
                  <li>🏁 <span className="font-medium text-ink">过关检测</span>:4 种题型随机(英译中、中译英、听音拼写、看义拼写),<span className="font-semibold text-ink">对 60% 以上才算过关</span>,没过要重考。</li>
                </ul>
                <p className="mt-1">过关了才进下一组,你答完一题立刻进下一题,<span className="font-semibold text-ink">不用等别人</span>。</p>
              </div>
              {/* 胜负规则 */}
              <div className="rounded-2xl bg-orange-50/70 border border-orange-100 p-3">
                <p className="font-semibold text-ink mb-1.5">🏁 怎么赢(重点)</p>
                <ul className="space-y-1 list-disc pl-4">
                  <li><span className="font-medium text-ink">分数最高的人赢</span>,榜上柱子最高的就是第一名。分数 = 掌握分 + 速度分。</li>
                  <li><span className="font-medium text-ink">掌握分看你把词掌握了多少</span>:掌握得越多分越高,全部掌握就拿满分。<span className="font-medium text-ink">反复刷同一题刷不出分</span>,真会了才涨。</li>
                  <li><span className="font-medium text-ink">全部做完还能拿速度分</span>,越早做完拿得越多——<span className="font-medium text-ink">先做完的人分数一定比后做完的高</span>,所以做完了别磨蹭,快就是分。</li>
                  <li>大家都完成了就<span className="font-medium text-ink">马上出成绩</span>;时间到了还没做完,就按当时的分数排名。</li>
                  <li>不会的词会一直反复出现直到你会,所以<span className="font-medium text-ink">乱按、拖时间都没用</span>,认认真真一遍过反而最快、分最高。</li>
                  <li>分数一样时,看谁先完成、谁用时更短。</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 分组赛:进房后自己选组</p>
                <p>老师开分组赛时,他会先建好几个组。你进等待室后<span className="font-semibold text-ink">点一下组名就加入了</span>,想换组再点别的组名;<span className="font-medium text-ink">不选组老师开不了赛</span>,所以进去先选。</p>
                <p className="mt-1">比赛时看「队伍榜」哪个组领先——按<span className="font-semibold text-ink">组内人均得分</span>算,组里人多不占便宜,和组员一起冲榜。</p>
              </div>
            </div>
          ))}
        </motion.div>

        {showInvite && (
          <PkInviteModal inviteCode={showInvite} onClose={() => setShowInvite(null)} />
        )}
      </div>
    </div>
  );
}
