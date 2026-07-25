import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { pkApi, type MyRoomItem } from '../api/pk';
import PkInviteModal from '../components/pk/PkInviteModal';
import { tournamentApi, type MyMatch } from '../api/tournament';
import { toast } from '../components/Toast';

const QUICK_COUNTS = [2, 4, 6, 10, 20];
const WORD_COUNTS = [5, 10, 15, 20];
const TEAM_COUNTS = [2, 3, 4, 5, 6];
// 后端校验范围(与 schemas/pk.py 一致):队伍 2-6、词数 4-30
const MIN_TEAMS = 2, MAX_TEAMS = 6;
const MIN_WORDS = 4, MAX_WORDS = 30;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 20;

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
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [playersRaw, setPlayersRaw] = useState('4'); // 输入框原始文本,失焦时才 clamp
  const [wordCount, setWordCount] = useState(10);
  const [mode, setMode] = useState<'individual' | 'team'>('individual');
  const [teamCount, setTeamCount] = useState(2);
  const [countdownMin, setCountdownMin] = useState(5);  // 全场倒计时(分钟)
  const [inviteCode, setInviteCode] = useState('');
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [myMatches, setMyMatches] = useState<MyMatch[]>([]);
  const [entering, setEntering] = useState<number | null>(null);
  const [myRooms, setMyRooms] = useState<MyRoomItem[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const navTimer = useRef<number | null>(null);

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
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '删除失败');
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
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(detail === 'MATCH_ALREADY_FINISHED' ? '这场对局已结束' : detail || '进入对局失败');
      setEntering(null);
      tournamentApi.myMatches().then(setMyMatches).catch(() => {});
    }
  };

  const clampPlayers = (n: number) =>
    Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(n) || MIN_PLAYERS));

  /** 统一设置人数(步进器/快捷档/输入框失焦共用),同步输入框显示 */
  const setPlayers = (n: number) => {
    const v = clampPlayers(n);
    setMaxPlayers(v);
    setPlayersRaw(String(v));
  };

  const handleCreate = async () => {
    setError('');
    setCreating(true);
    try {
      const data = await pkApi.createRoom(maxPlayers, wordCount, mode, teamCount, countdownMin * 60);
      setShowInvite(data.invite_code);
      loadMyRooms();
      navTimer.current = window.setTimeout(() => navigate(`/pk/arena/${data.room_id}`), 1500);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const msg = detail === 'USER_ALREADY_IN_ROOM'
        ? '你有一场对战正在进行中,请先进去点「结束本场对战」再创建新房'
        : e?.response?.status === 403
          ? '只有教师可以创建 PK 房间'
          : detail || e?.message || '创建失败';
      setError(msg);
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    setError('');
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('邀请码必须是 6 位');
      return;
    }
    try {
      const data = await pkApi.joinRoomByCode(code);
      navigate(`/pk/arena/${data.room_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const errorMap: Record<string, string> = {
        ROOM_NOT_FOUND: '邀请码无效',
        ROOM_FINISHED: '该房间的 PK 已结束',
        ROOM_FULL: '房间已满——可以点「👀 观战」进去看比赛',
        ROOM_ALREADY_STARTED: '房间已开始——可以点「👀 观战」进去看比赛',
        USER_ALREADY_IN_ROOM: '你已在另一个 PK 房间中',
      };
      setError(errorMap[detail] || detail || e?.message || '加入失败');
    }
  };

  const handleSpectate = async () => {
    setError('');
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('邀请码必须是 6 位');
      return;
    }
    try {
      const data = await pkApi.spectateByCode(code);
      navigate(`/pk/arena/${data.room_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const errorMap: Record<string, string> = {
        ROOM_NOT_FOUND: '邀请码无效',
        ROOM_FINISHED: '该房间的 PK 已结束',
        SPECTATORS_FULL: '观众席满啦(30 人)',
      };
      setError(errorMap[detail] || detail || e?.message || '观战失败');
    }
  };

  return (
    <div className="min-h-screen bg-paper relative overflow-hidden">
      {/* 装饰光晕 */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-secondary/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 -left-32 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative max-w-4xl mx-auto px-5 py-6 sm:py-10">
        <button
          onClick={() => navigate(isTeacher ? '/teacher/dashboard' : '/student/dashboard')}
          className="text-sm text-ink-mute hover:text-ink mb-4"
        >
          ← 返回主页
        </button>

        {/* 大头图 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl bg-gradient-to-br from-primary via-orange-400 to-secondary p-6 sm:p-10 text-white shadow-xl mb-6 relative overflow-hidden"
        >
          <motion.span
            className="absolute right-6 top-4 text-6xl sm:text-8xl opacity-25 select-none"
            animate={{ rotate: [0, -8, 8, 0] }}
            transition={{ repeat: Infinity, duration: 4 }}
          >
            ⚔️
          </motion.span>
          <h1 className="font-display text-3xl sm:text-5xl font-bold">PK 竞技场</h1>
          <p className="text-sm sm:text-lg text-white/90 mt-2 max-w-md">
            {isTeacher
              ? '你来组织,学生用分类记忆法同场竞速——谁先把单词全部掌握谁赢'
              : '用分类记忆法和同学同场竞速——谁先把单词全部掌握谁赢'}
          </p>
          {/* 规则条 */}
          <div className="flex flex-wrap gap-2 mt-4 sm:mt-6">
            {(isTeacher
              ? ['🎛️ 老师建房不下场', '🧠 各考各背过的词', '⚖️ 题量全场统一', '🏁 率先掌握者赢']
              : ['🧠 考你自己背过的词', '🔁 不会的词反复练到会', '🏁 谁先全掌握谁赢']
            ).map((t) => (
              <span key={t} className="text-[11px] sm:text-sm bg-white/20 backdrop-blur px-3 py-1.5 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </motion.div>

        {/* 晋级赛待打对局:老师办的正式赛事,置顶醒目 */}
        {myMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 mb-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🏆</span>
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
                    className="shrink-0 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow disabled:opacity-50"
                  >
                    {entering === m.match_id ? '进入中…' : m.invite_code ? '⚔️ 对手在等你!' : '⚔️ 开打'}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 我的房间(教师):切网页/关标签页后房间保留,回来在这里重进或删除 */}
        {isTeacher && myRooms.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border-2 border-primary/25 bg-orange-50/60 p-4 mb-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🏠</span>
              <h2 className="font-bold text-ink">我的房间 · {myRooms.length} 个进行中</h2>
              <span className="text-[11px] text-ink-mute">切网页也不会消失,用完记得删除</span>
            </div>
            <div className="space-y-2">
              {myRooms.map((r) => (
                <div key={r.room_id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 shadow-sm">
                  <span className="font-mono text-lg font-bold tracking-widest text-primary shrink-0">{r.invite_code}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-soft">
                      {r.status === 'waiting' ? '⏳ 等待中' : '⚔️ 对战中'}
                      {' · '}{r.mode === 'team' ? '分组赛' : '个人赛'}
                      {' · '}{r.word_count} 词
                    </p>
                    <p className="text-[11px] text-ink-mute">
                      {r.online_count}/{r.player_count} 人在线
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/pk/arena/${r.room_id}`)}
                    className="shrink-0 px-3.5 py-2 rounded-lg bg-primary text-white text-sm font-semibold shadow active:scale-95 transition"
                  >
                    进入
                  </button>
                  <button
                    onClick={() => handleDeleteRoom(r.room_id)}
                    disabled={deleting === r.room_id}
                    className="shrink-0 px-3 py-2 rounded-lg bg-gray-100 hover:bg-red-50 hover:text-red-500 text-ink-soft text-sm font-medium transition disabled:opacity-50"
                  >
                    {deleting === r.room_id ? '删除中…' : '删除'}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 创建(教师) / 加入(学生) */}
        <div className={`grid grid-cols-1 ${isTeacher ? 'md:grid-cols-2' : ''} gap-5`}>
          {/* 创建房间:仅教师(组织者)可见 */}
          {isTeacher && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="card-soft rounded-3xl p-6 sm:p-7"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              🏠 创建房间
            </h2>
            <p className="text-xs text-ink-mute mb-4">你作为组织者建房、发码给学生,开局后监控战况(不下场答题)</p>

            {/* 模式切换:个人赛 / 分组赛 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">对战模式</label>
            <div className="flex gap-2 mb-4">
              {([
                { k: 'individual', label: '👤 个人赛', desc: '各自排名' },
                { k: 'team', label: '👥 分组赛', desc: '按队伍比拼' },
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

            {/* 分组赛:队伍数(快捷档 + 自定义) */}
            {mode === 'team' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-ink-soft mb-2">
                  分几队 <span className="text-ink-mute font-normal">({MIN_TEAMS}~{MAX_TEAMS} 队)</span>
                </label>
                <div className="flex gap-2">
                  {TEAM_COUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setTeamCount(n)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold transition ${
                        teamCount === n
                          ? 'bg-primary text-white shadow-sm'
                          : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                      }`}
                    >
                      {n} 队
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-ink-mute">自定义</span>
                  <input
                    type="number" min={MIN_TEAMS} max={MAX_TEAMS} value={teamCount}
                    onChange={(e) => setTeamCount(Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, Number(e.target.value) || MIN_TEAMS)))}
                    className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center"
                  />
                  <span className="text-xs text-ink-mute">队</span>
                </div>
                <p className="text-[11px] text-ink-mute mt-2">学生进房自动均衡分队,开局前你可在竞技场调整</p>
              </div>
            )}

            {/* 人数步进器 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">
              房间人数 <span className="text-ink-mute font-normal">({MIN_PLAYERS}~{MAX_PLAYERS} 人)</span>
            </label>
            <div className="flex items-center gap-4 mb-2">
              <button
                onClick={() => setPlayers(maxPlayers - 1)}
                disabled={maxPlayers <= MIN_PLAYERS}
                className="w-12 h-12 rounded-2xl bg-orange-100 text-primary text-2xl font-bold disabled:opacity-40 active:scale-95 transition"
              >
                −
              </button>
              <div className="flex-1 text-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={playersRaw}
                  onChange={(e) => setPlayersRaw(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  onBlur={() => setPlayers(Number(playersRaw))}
                  className="w-24 text-center text-4xl font-bold text-primary font-numeric bg-transparent focus:outline-none"
                />
                <span className="text-base text-ink-mute">人</span>
              </div>
              <button
                onClick={() => setPlayers(maxPlayers + 1)}
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
                  onClick={() => setPlayers(n)}
                  className={`flex-1 py-1.5 rounded-xl text-sm font-medium transition ${
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
                  onClick={() => setWordCount(n)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
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
              <input
                type="number" min={MIN_WORDS} max={MAX_WORDS} value={wordCount}
                onChange={(e) => setWordCount(Math.min(MAX_WORDS, Math.max(MIN_WORDS, Number(e.target.value) || MIN_WORDS)))}
                className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center"
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
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
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
                className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center"
              />
              <span className="text-xs text-ink-mute">分钟(1–30)</span>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-glow w-full py-3.5 text-white rounded-2xl font-semibold text-base"
            >
              {creating ? '创建中…' : '🚀 创建并获取邀请码'}
            </button>
            <p className="text-[11px] text-ink-mute mt-3 text-center">
              每个学生各考「自己背过的词」,题量按全场最少的学生统一(最多 {wordCount} 词),
              走完分类→听写→过关全流程,谁先全部掌握谁赢;{countdownMin} 分钟到点未完成则比进度
            </p>
          </motion.div>
          )}

          {/* 加入房间:学生凭老师发的邀请码进场 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="card-soft rounded-3xl p-6 sm:p-7 flex flex-col"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              🎟️ 加入房间
            </h2>
            <p className="text-xs text-ink-mute mb-5">
              {isTeacher ? '也可以用邀请码进入别的老师开的房观战' : '输入老师发你的 6 位邀请码'}
            </p>

            <div className="flex-1 flex flex-col justify-center">
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                className="w-full px-4 py-4 border-2 border-orange-200 rounded-2xl font-mono tracking-[0.45em] text-center text-3xl uppercase text-ink focus:outline-none focus:border-primary bg-white"
                maxLength={6}
                placeholder="ABC123"
              />
              {!isTeacher && (
                <button
                  onClick={handleJoin}
                  className="btn-glow w-full py-3.5 mt-5 text-white rounded-2xl font-semibold text-base"
                >
                  ⚔️ 加入对战
                </button>
              )}
              <button
                onClick={handleSpectate}
                className={`w-full py-3 ${isTeacher ? 'mt-5' : 'mt-2.5'} rounded-2xl font-semibold text-base bg-gray-100 hover:bg-orange-100 text-ink-soft transition`}
              >
                👀 观战(满员/已开局也能看)
              </button>
            </div>
            <p className="text-[11px] text-ink-mute mt-3 text-center">
              {isTeacher ? '学生在自己的 PK 大厅输入邀请码即可加入你的房间' : '没有邀请码?等老师创建房间后发给你'}
            </p>
          </motion.div>
        </div>

        {/* 玩法说明:教师看「怎么组织」,学生看「怎么打」 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24 }}
          className="card-soft rounded-3xl p-6 sm:p-7 mt-5"
        >
          <h2 className="font-display text-lg font-bold text-ink flex items-center gap-2 mb-4">
            📖 玩法说明
          </h2>

          {isTeacher ? (
            <div className="space-y-4 text-sm text-ink-soft leading-relaxed">
              <div>
                <p className="font-semibold text-ink mb-1">① 建房(你是组织者,全程不答题)</p>
                <p>选「个人赛 / 分组赛」→ 定房间人数、每人词数、<span className="font-semibold text-ink">全场倒计时</span>(1–30 分钟)→ 点创建,拿到 6 位邀请码发给学生。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">② 学生加入</p>
                <p>学生在自己的 PK 大厅输入邀请码进房。分组赛会自动把学生均衡分到各队,开局前你可在竞技场里手动调队、移出学生。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">③ 你开局并监控</p>
                <p>至少 2 名学生进房即可开局(分组赛要求每队都有人)。开局后自动进<span className="font-semibold text-ink">全屏大屏监控台</span>,看每个学生的实时阶段与掌握进度,但不答题。随时可「提前结束」并出正式榜。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 每人考自己背过的词(题量全场统一)</p>
                <p>系统给<span className="font-semibold text-ink">每个学生各抽他自己背过的词</span>——小学、初中、高中的孩子放一起也公平,谁都不会被考自己没学过的词。</p>
                <p className="mt-1">但<span className="font-semibold text-ink">题量会按「全场背得最少的那个学生」统一</span>:比如 A 背过 300 词、B 只背过 8 词,则两人都只考 8 个(各考自己的)。这样大家工作量一样,「谁先掌握完」才是公平比较,不会出现背得少的人因为任务轻而稳赢。若有学生背过的词不足 4 个,则无法开局。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">⑤ 每人走一遍分类记忆法全流程</p>
                <p>词按 10 个一组,每组:🗂️<span className="font-medium text-ink">分类</span>(标熟悉/学过/陌生,<span className="font-semibold text-ink">夹生和陌生的词会反复出现直到全部标熟悉</span>)→ ✍️<span className="font-medium text-ink">听写</span>(拼错要照着抄对 3 遍,错词再复听一轮)→ 🏁<span className="font-medium text-ink">过关检测</span>(4 种题型随机:英译中/中译英/听音拼写/看义拼写,<span className="font-semibold text-ink">正确率≥60% 才过关</span>,不过则重考)。过关才进下一组。</p>
              </div>
              {/* 胜负规则 */}
              <div className="rounded-2xl bg-orange-50/70 border border-orange-100 p-3">
                <p className="font-semibold text-ink mb-1.5">🏁 怎么定胜负(重点)</p>
                <ul className="space-y-1 list-disc pl-4">
                  <li><span className="font-medium text-ink">率先把全部组走完并过关的学生赢</span>,按完成时刻先后排名。</li>
                  <li><span className="font-medium text-ink">全员完成即立刻结算</span>,不用等倒计时走完。</li>
                  <li>倒计时到点仍有人没完成 → 按<span className="font-medium text-ink">掌握进度百分比</span>排名;同进度看用时。</li>
                  <li>因为不会的词会反复练到会,<span className="font-medium text-ink">拖时间不会有额外好处</span>——认真一遍过才最快。</li>
                  <li><span className="font-medium text-ink">分组赛按队内「人均掌握进度」排名</span>——队里人多不占便宜,人少的队照样能赢。</li>
                  <li>答题也会累计得分(答对得分、越快越多),但<span className="font-medium text-ink">得分只作展示</span>,不决定胜负。</li>
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
                <p className="font-semibold text-ink mb-1">② 考的是你自己背过的词</p>
                <p>题目从<span className="font-semibold text-ink">你自己背过的单词</span>里出,和同学考的不一样,所以不管你几年级都公平。</p>
                <p className="mt-1"><span className="font-semibold text-ink">题量大家一样多</span>——按全场背得最少的同学来定。所以<span className="font-medium text-ink">背得多不会被罚、背得少也占不到便宜</span>,大家做一样多的题,比谁先掌握。</p>
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
                  <li><span className="font-medium text-ink">谁先把所有组都过关,谁就赢</span>——最快完成的是本场单词王 👑。</li>
                  <li>大家都完成了就<span className="font-medium text-ink">马上出成绩</span>,不用等倒计时。</li>
                  <li>时间到了还没做完,就<span className="font-medium text-ink">比谁掌握的进度多</span>(右侧擂台榜上的百分比)。</li>
                  <li>不会的词会一直反复出现直到你会,所以<span className="font-medium text-ink">乱按、拖时间都没用</span>,认认真真一遍过反而最快。</li>
                  <li>答对也会涨分数(越快越多),但<span className="font-medium text-ink">分数只是好看</span>,不决定谁赢。</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 分组赛</p>
                <p>老师开分组赛时你会被分到某个队,右侧「队伍榜」看哪个队领先——按<span className="font-semibold text-ink">人均掌握进度</span>算,和队友一起冲榜。</p>
              </div>
            </div>
          )}
        </motion.div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 text-sm text-error bg-red-50 rounded-2xl px-4 py-3"
          >
            ⚠️ {error}
          </motion.p>
        )}

        {showInvite && (
          <PkInviteModal inviteCode={showInvite} onClose={() => setShowInvite(null)} />
        )}
      </div>
    </div>
  );
}
