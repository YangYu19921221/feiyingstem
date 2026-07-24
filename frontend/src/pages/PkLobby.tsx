import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { pkApi } from '../api/pk';
import PkInviteModal from '../components/pk/PkInviteModal';
import { tournamentApi, type MyMatch } from '../api/tournament';
import { toast } from '../components/Toast';

const QUICK_COUNTS = [2, 4, 6, 10, 20];
const WORD_COUNTS = [5, 10, 15, 20];
const TEAM_COUNTS = [2, 3, 4];
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
  const navTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (navTimer.current !== null) window.clearTimeout(navTimer.current);
  }, []);

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
      navTimer.current = window.setTimeout(() => navigate(`/pk/arena/${data.room_id}`), 1500);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const msg = detail === 'USER_ALREADY_IN_ROOM'
        ? '你已开了一个 PK 房间,先结束它再开新的'
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
              ? '你来组织,学生实时对战——四阶段闯关比拼单词功底'
              : '和同学实时对战,四阶段闯关比拼单词功底'}
          </p>
          {/* 规则条 */}
          <div className="flex flex-wrap gap-2 mt-4 sm:mt-6">
            {(isTeacher
              ? ['🎛️ 老师建房不下场', '🧠 各考各背过的词', '⏱️ 全场限时竞速']
              : ['🧠 各考各背过的词', '⚡ 答对越快分越高', '⏱️ 限时内比谁分高']
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

            {/* 分组赛:队伍数 */}
            {mode === 'team' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-ink-soft mb-2">分几队</label>
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

            {/* 题量 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">
              单词数量 <span className="text-ink-mute font-normal">(每词过 4 关 ≈ {wordCount * 4} 题)</span>
            </label>
            <div className="flex gap-2 mb-6">
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
              每个学生各考「自己背过的词」,{countdownMin} 分钟内答完循环续刷,比谁得分高
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
                <p>至少 2 名学生进房即可开局(分组赛要求每队都有人)。开局后你在控制台看每个学生的实时进度和得分,但不答题。随时可「结束本场对战」。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 每人考自己背过的词,限时竞速</p>
                <p>系统给<span className="font-semibold text-ink">每个学生各抽他自己背过的词</span>——所以小学、初中、高中的孩子放一起也公平,谁都不会被拉去考自己没学过的词。每人各答各的、答完立刻下一题、不用等别人;倒计时内把自己的词答完了会<span className="font-semibold text-ink">循环续刷继续拿分</span>。时间一到,谁分高谁赢。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">⑤ 每个词要闯 4 关</p>
                <p>🗂️分类 → 🎤语音 → ✍️听写 → 🏁过关。四关都算一道题的一部分,答对各得一份分。</p>
              </div>
              {/* 计分规则:大白话讲清楚 */}
              <div className="rounded-2xl bg-orange-50/70 border border-orange-100 p-3">
                <p className="font-semibold text-ink mb-1.5">💯 分数怎么算(重点)</p>
                <ul className="space-y-1 list-disc pl-4">
                  <li><span className="font-medium text-ink">答对才有分,答错或超时得 0 分</span>,不倒扣。</li>
                  <li>每道题的<span className="font-medium text-ink">基础分按单词难度</span>:小学词 <b>100</b> 分 / 初中词 <b>120</b> 分 / 高中词 <b>150</b> 分。</li>
                  <li><span className="font-medium text-ink">答得越快,加分越多</span>:在基础分上再加最多 30%。比如一个初中词(120 分)秒答,最高能拿约 156 分;拖到快超时才答对,只拿接近 120 分。</li>
                  <li>连续答对会有连击 🔥(只是展示,不额外加分)。</li>
                  <li><span className="font-medium text-ink">分组赛按「人均分」排名</span>——队里人多也不占便宜,人少的队照样能赢。</li>
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
                <p className="font-semibold text-ink mb-1">② 每个词要闯 4 关</p>
                <p>🗂️ <span className="font-medium text-ink">分类</span>:判断词属于哪类 → 🎤 <span className="font-medium text-ink">语音</span>:跟读单词 → ✍️ <span className="font-medium text-ink">听写</span>:听发音拼出来 → 🏁 <span className="font-medium text-ink">过关</span>:看中文拼出单词。你答完一题立刻进下一题,<span className="font-semibold text-ink">不用等别人</span>。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">③ 考的是你自己背过的词</p>
                <p>题目从<span className="font-semibold text-ink">你自己背过的单词</span>里出,和同学考的不一样,所以不管你是几年级都公平。在<span className="font-semibold text-ink">倒计时结束前</span>比谁分高;把自己的词答完了会自动从头再来一轮继续拿分。想赢?平时多去学习页面背单词。</p>
              </div>
              {/* 计分规则:大白话讲清楚 */}
              <div className="rounded-2xl bg-orange-50/70 border border-orange-100 p-3">
                <p className="font-semibold text-ink mb-1.5">💯 怎么才能拿高分</p>
                <ul className="space-y-1 list-disc pl-4">
                  <li><span className="font-medium text-ink">答对才有分</span>,答错或超时是 0 分(但不扣分,别怕)。</li>
                  <li><span className="font-medium text-ink">越难的词分越高</span>:小学词 <b>100</b> 分、初中词 <b>120</b> 分、高中词 <b>150</b> 分。</li>
                  <li><span className="font-medium text-ink">答得越快,加分越多</span>——又快又对最赚,最多能多拿 30%。</li>
                  <li>连续答对会亮连击 🔥,越连越有气势。</li>
                  <li>时间到的时候,谁总分高谁就是本场单词王 👑。</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 分组赛</p>
                <p>老师开分组赛时你会被分到某个队,右侧「队伍榜」看哪个队领先——按<span className="font-semibold text-ink">人均分</span>算,和队友一起冲榜。</p>
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
