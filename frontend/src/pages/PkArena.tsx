import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { usePkSocket, type PkServerEvent } from '../hooks/usePkSocket';
import { pkApi, type PkRoomSnapshot, type PkPhase, type PkLiveRankItem, type PkTeamRankItem } from '../api/pk';
import ClassificationPhase from '../components/classify/ClassificationPhase';
import SpeechVerifyCard from '../components/classify/SpeechVerifyCard';
import DictationSingle from '../components/classify/DictationSingle';
import PkExamCard, { type PkExamType } from '../components/pk/PkExamCard';
import PkPhaseStepper from '../components/pk/PkPhaseStepper';
import PkLiveRanking from '../components/pk/PkLiveRanking';
import PkResultBoard from '../components/pk/PkResultBoard';

interface CurrentQuestion {
  word_idx: number;
  phase: PkPhase;
  word: { id: number; word: string; translation: string };
  points?: number; // 本题分值(按该词学段)
  exam_type?: PkExamType;  // 过关阶段题型(服务端权威),仅 phase==='exam' 时有
  options?: string[];      // 过关选择题选项(en_to_cn/cn_to_en)
}

interface RankItem {
  user_id: number;
  nickname?: string;
  rank: number;
  correct: number;
  wrong: number;
  total_time_ms: number;
  accuracy: number;
  final_score: number;
  best_streak?: number;
  team?: number | null;
}

function getMeId(): number {
  // JWT sub is canonical: server uses it for auth, so we use it for "我" identity.
  // localStorage user/user_id can drift between tabs; don't trust it.
  const token = localStorage.getItem('access_token') || '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    const fromJwt = Number(payload.sub);
    if (fromJwt) return fromJwt;
  } catch {
    // fall through — invalid/missing token. Auth guard will handle navigation.
  }
  return 0;
}

const noOp = () => {};
const noOpAudio: (w: string) => void = () => {};

const PHASE_LABEL: Record<string, string> = {
  classify: '🗂️ 分类',
  speech: '🎤 语音',
  dictation: '✍️ 听写',
  exam: '🏁 过关',
};

/** 从房间快照推导初始榜单(开局/重连时 live_ranking 还没来) */
function rankingFromSnapshot(snap: PkRoomSnapshot): PkLiveRankItem[] {
  const items = snap.players.map((p) => ({
    user_id: p.user_id,
    nickname: p.nickname,
    points: p.points ?? 0,
    correct: p.correct,
    wrong: p.wrong,
    streak: p.streak ?? 0,
    total_time_ms: p.total_time_ms,
    current_word_idx: p.current_word_idx,
    online: p.online,
    rank: 0,
  }));
  items.sort((a, b) => (b.points - a.points) || (a.total_time_ms - b.total_time_ms));
  items.forEach((it, i) => { it.rank = i + 1; });
  return items;
}

export default function PkArena() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const meId = getMeId();
  const token = localStorage.getItem('access_token') || '';

  const [snapshot, setSnapshot] = useState<PkRoomSnapshot | null>(null);
  const [currentQ, setCurrentQ] = useState<CurrentQuestion | null>(null);
  const questionStartedAtRef = useRef<number>(0);
  const [submitting, setSubmitting] = useState(false);  // 提交中防重复(并行竞速无"等其他人")
  const [liveRanking, setLiveRanking] = useState<PkLiveRankItem[] | null>(null);
  const [teamRanking, setTeamRanking] = useState<PkTeamRankItem[] | null>(null);
  const [lastGains, setLastGains] = useState<Record<string, number>>({});
  const [settleSeq, setSettleSeq] = useState(0);
  const [ranking, setRanking] = useState<RankItem[] | null>(null);
  const [teamFinal, setTeamFinal] = useState<PkTeamRankItem[] | null>(null);
  const [errorBanner, setErrorBanner] = useState('');
  const [copied, setCopied] = useState(false);

  const handleEvent = useCallback(
    (event: PkServerEvent) => {
      switch (event.type) {
        case 'room_state': {
          const room = event.room as PkRoomSnapshot;
          setSnapshot(room);
          setLiveRanking((cur) => cur ?? rankingFromSnapshot(room));
          setErrorBanner('');
          break;
        }
        case 'question_pushed':
          // 并行竞速:服务端只推「我自己的下一题」(带 target_user_id)。教师控制台会镜像收到
          // 每个学生的题,但教师不答题,忽略即可(靠 live_ranking 看多人进度)。
          if (event.target_user_id != null && event.target_user_id !== meId) break;
          setCurrentQ({
            word_idx: event.word_idx,
            phase: event.phase as PkPhase,
            word: event.word,
            points: event.points,
            exam_type: event.exam_type as PkExamType | undefined,
            options: event.options as string[] | undefined,
          });
          questionStartedAtRef.current = Date.now();
          setSubmitting(false);   // 新题到,解禁答题
          break;
        case 'question_settled': {
          // 「我这题」的即时回执(仅自己):驱动 +分浮动动画
          if (event.target_user_id != null && event.target_user_id !== meId) break;
          const gains: Record<string, number> = {};
          const results = (event.results ?? {}) as Record<string, { points_gained?: number }>;
          for (const [uid, r] of Object.entries(results)) {
            gains[uid] = r?.points_gained ?? 0;
          }
          setLastGains(gains);
          setSettleSeq((s) => s + 1);
          break;
        }
        case 'live_ranking':
          setLiveRanking(event.ranking as PkLiveRankItem[]);
          if (event.team_ranking) setTeamRanking(event.team_ranking as PkTeamRankItem[]);
          break;
        case 'game_finished':
          setRanking(event.ranking as RankItem[]);
          if (event.team_ranking) setTeamFinal(event.team_ranking as PkTeamRankItem[]);
          break;
        case 'room_closed':
          setErrorBanner(event.message || '房间已解散');
          window.setTimeout(() => navigate('/pk/lobby'), 1600);
          break;
        case 'error':
          setErrorBanner(event.message || event.code || 'Error');
          // 观众断线后服务端会立即移除:收到 ROOM_NOT_FOUND 时自动重新登记观战,
          // 配合 socket 的自动重连即可无感恢复
          if (event.code === 'ROOM_NOT_FOUND') {
            setSnapshot((snap) => {
              const wasSpectator = snap && !snap.players.some((pl) => pl.user_id === meId);
              if (wasSpectator && snap?.invite_code) {
                pkApi.spectateByCode(snap.invite_code).catch(() => {});
              }
              return snap;
            });
          }
          break;
        default:
          // player_disconnected / reconnected / kicked / host_changed:
          // server follows up with room_state for visible UI changes
          break;
      }
    },
    [meId, navigate]
  );

  const { send, connected } = usePkSocket({
    roomId: Number(roomId),
    token,
    onEvent: handleEvent,
    onClose: () => setErrorBanner('连接已断开,正在重连…'),
  });

  const submit = useCallback(
    (payload: object, timeSpentMs: number) => {
      if (!currentQ || submitting) return;
      setSubmitting(true);   // 防重复提交;新题到达(question_pushed)时解禁
      send({
        type: 'submit_answer',
        word_idx: currentQ.word_idx,
        phase: currentQ.phase,
        payload,
        time_spent_ms: timeSpentMs,
      });
    },
    [send, currentQ, submitting]
  );

  const copyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard 可能被拒绝,忽略
    }
  };

  // 教师控制台(组织者):我是房主且房主不下场
  const isHostConsole = !!snapshot && snapshot.host_id === meId && snapshot.host_is_player === false;
  const isTeamMode = snapshot?.mode === 'team';

  const setTeam = useCallback((userId: number, team: number) => {
    send({ type: 'set_team', user_id: userId, team });
  }, [send]);

  const kickPlayer = useCallback((userId: number) => {
    send({ type: 'kick_player', user_id: userId });
  }, [send]);

  const closeRoom = useCallback(() => {
    send({ type: 'close_room' });
    navigate('/teacher/dashboard');
  }, [send, navigate]);

  // 终局 → 结算榜
  if (ranking) {
    return (
      <PkResultBoard
        ranking={ranking}
        meId={meId}
        teamRanking={teamFinal}
        onExit={() => navigate(isHostConsole ? '/teacher/dashboard' : '/student/dashboard')}
        onAgain={isHostConsole ? undefined : () => navigate('/pk/lobby')}
      />
    );
  }

  // 连接/加载中
  if (!snapshot) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
            className="text-4xl mb-3"
          >
            ⚔️
          </motion.div>
          <p className="text-ink-soft">{connected ? '加载中…' : '连接中…'}</p>
        </div>
      </div>
    );
  }

  // 等待室(房主未开局)
  if (snapshot.status === 'waiting') {
    // 房主下场时才算「玩家房主」;教师组织房的房主是控制台,不在 players 里
    const isPlayerHost = snapshot.host_id === meId && snapshot.host_is_player;
    // 观战 = 既不是玩家、也不是教师控制台
    const isSpectator = !isHostConsole && !snapshot.players.some((p) => p.user_id === meId);
    const canStart = isPlayerHost || isHostConsole;
    const onlineCount = snapshot.players.filter((p) => p.online).length;
    const specCount = snapshot.spectators?.length ?? 0;
    const teamColors = ['bg-blue-50 ring-blue-200', 'bg-rose-50 ring-rose-200', 'bg-emerald-50 ring-emerald-200', 'bg-amber-50 ring-amber-200'];
    return (
      <div className="min-h-screen bg-paper relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-secondary/20 blur-3xl" />
        <div className="pointer-events-none absolute top-1/2 -left-32 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative max-w-2xl mx-auto p-5 sm:py-10">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
              {isHostConsole ? '🎛️ 组织者控制台' : isSpectator ? '👀 观战 · 等待开始' : '⚔️ 等待开始'}
            </h2>
            <span className="text-xs sm:text-sm px-3 py-1.5 rounded-full bg-secondary/25 text-amber-700 font-medium">
              {isTeamMode ? `👥 ${snapshot.team_count} 队 · ` : '👤 个人 · '}
              {snapshot.word_count} 词 ≈ {snapshot.word_count * 4} 题
            </span>
          </div>

          {/* 邀请码大卡 */}
          <div className="rounded-3xl bg-gradient-to-br from-primary via-orange-400 to-secondary p-[2px] shadow-xl mb-5">
            <div className="rounded-3xl bg-white px-6 py-6 sm:py-8 text-center">
              <p className="text-sm text-ink-mute mb-2">邀请码 · 发给同学一起 PK</p>
              <p className="font-mono text-5xl sm:text-6xl font-bold tracking-[0.3em] text-primary select-all">
                {snapshot.invite_code}
              </p>
              <button
                onClick={() => copyInvite(snapshot.invite_code)}
                className="mt-4 text-sm px-5 py-2 rounded-full bg-orange-100 text-primary font-medium active:scale-95 transition"
              >
                {copied ? '✅ 已复制' : '📋 复制邀请码'}
              </button>
            </div>
          </div>

          {/* 玩家网格 */}
          <div className="card-soft rounded-3xl p-5 sm:p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-ink">玩家</h3>
              <div className="flex items-center gap-3">
                {specCount > 0 && (
                  <span className="text-xs text-ink-mute">👀 {specCount} 人观战</span>
                )}
                <span className="font-numeric text-ink-soft">
                  {snapshot.players.length}/{snapshot.max_players} 人
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <AnimatePresence>
                {snapshot.players.map((p) => (
                  <motion.div
                    key={p.user_id}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 22 }}
                    className={`flex items-center gap-2.5 rounded-2xl px-3.5 py-3 ${
                      p.user_id === meId ? 'bg-orange-50 ring-2 ring-primary/40'
                        : isTeamMode && p.team ? `${teamColors[(p.team - 1) % teamColors.length]} ring-2` : 'bg-gray-50'
                    } ${!p.online ? 'opacity-50' : ''}`}
                  >
                    <span className="text-2xl">🧑‍🎓</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{p.nickname}</p>
                      <p className="text-[11px] text-ink-mute">
                        {isTeamMode && p.team ? `第 ${p.team} 队` : '玩家'}
                        {p.user_id === meId ? ' · 我' : ''}
                        {!p.online ? ' · 掉线' : ''}
                      </p>
                    </div>
                    {/* 教师控制台:调队 / 踢人 */}
                    {isHostConsole && (
                      <div className="flex flex-col gap-1 shrink-0">
                        {isTeamMode && (
                          <select
                            value={p.team ?? 1}
                            onChange={(e) => setTeam(p.user_id, Number(e.target.value))}
                            className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white text-ink-soft"
                          >
                            {Array.from({ length: snapshot.team_count }).map((_, i) => (
                              <option key={i + 1} value={i + 1}>{i + 1} 队</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => kickPlayer(p.user_id)}
                          className="text-[11px] text-red-400 hover:text-red-600"
                        >
                          移出
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {/* 空位 */}
              {Array.from({ length: Math.max(0, Math.min(snapshot.max_players - snapshot.players.length, 6)) }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="flex items-center justify-center rounded-2xl px-3.5 py-3 border-2 border-dashed border-orange-200 text-ink-mute text-xs min-h-[3.5rem]"
                >
                  等待加入…
                </div>
              ))}
            </div>
          </div>

          {canStart ? (
            <>
              <motion.button
                onClick={() => send({ type: 'start_game' })}
                disabled={onlineCount < 2}
                animate={onlineCount >= 2 ? { scale: [1, 1.02, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.6 }}
                className="btn-glow w-full py-4 text-white rounded-2xl font-semibold text-lg"
              >
                {onlineCount < 2 ? '至少需要 2 名在线玩家' : `🚀 开始 PK(${onlineCount} 人在线)`}
              </motion.button>
              {isHostConsole && (
                <button
                  onClick={closeRoom}
                  className="w-full py-3 mt-2.5 rounded-2xl font-medium text-base bg-gray-100 hover:bg-red-50 hover:text-red-500 text-ink-soft transition"
                >
                  解散房间
                </button>
              )}
            </>
          ) : (
            <p className="text-center text-ink-soft py-4">⏳ 等待老师开始…</p>
          )}

          <p className="text-xs text-ink-mute text-center mt-4">
            {isHostConsole
              ? '你是组织者,开局后监控战况,不下场答题'
              : `每人各考自己背过的 ${snapshot.word_count} 个词,限时内答完循环续刷,比谁得分高`}
          </p>

          {errorBanner && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 text-sm text-error bg-red-50 rounded-2xl px-4 py-3"
            >
              ⚠️ {errorBanner}
            </motion.p>
          )}
        </div>
      </div>
    );
  }

  // 对局中(并行竞速):进度条反映「我自己」的进度。我的私有词表大小 = 我的 n_words。
  const me = snapshot.players.find((p) => p.user_id === meId);
  const myWordCount = me?.n_words || snapshot.word_count || 1;
  const wordsPerPhase = myWordCount;
  const totalQ = myWordCount * 4;
  // 个人进度指针累计(答完循环续刷),对一轮题量取模映射到当前轮内位置
  const globalIdx = (currentQ?.word_idx ?? 0) % (myWordCount * 4);
  const phase = currentQ?.phase ?? 'classify';
  // 教师控制台是监控视角(非玩家、非普通观众);普通观众才走脱敏只读题卡
  const isSpectator = !isHostConsole && !snapshot.players.some((p) => p.user_id === meId);
  // 只有真正的参赛玩家才渲染答题卡(教师控制台虽 isSpectator=false,但不下场答题)
  const isPlayer = !isHostConsole && !isSpectator;
  const specCount = snapshot.spectators?.length ?? 0;
  const wordDataStub = currentQ
    ? {
        id: currentQ.word.id,
        word: currentQ.word.word,
        translation: currentQ.word.translation,
      }
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <PkPhaseStepper
        phase={phase}
        currentIdx={globalIdx}
        wordsPerPhase={wordsPerPhase}
        currentPoints={currentQ?.points}
      />
      {snapshot.deadline_at && <CountdownBar deadlineIso={snapshot.deadline_at} />}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 flex-1 max-w-5xl mx-auto w-full">
        <div className="md:col-span-2 relative">
          {errorBanner && (
            <div className="mb-2 text-error text-sm bg-red-50 rounded-lg px-3 py-2">⚠️ {errorBanner}</div>
          )}
          {/* 教师控制台:并行竞速无"全场当前题",改看多人进度面板(靠右侧实时榜);这里只放控制 */}
          {isHostConsole && (
            <div className="card-soft rounded-3xl p-8 text-center">
              <p className="text-xs text-ink-mute mb-2">🎛️ 组织者监控 · 全场限时竞速中</p>
              <p className="text-sm text-ink-soft mb-4">
                每个学生各考自己背过的词,右侧实时榜可看每人进度与得分。
              </p>
              <button
                onClick={closeRoom}
                className="text-xs px-4 py-2 rounded-full bg-gray-100 hover:bg-red-50 hover:text-red-500 text-ink-soft transition"
              >
                结束本场对战
              </button>
            </div>
          )}
          {/* 观众:并行竞速下无统一题目,看右侧实时榜 */}
          {isSpectator && (
            <div className="card-soft rounded-3xl p-8 text-center text-ink-mute">
              👀 观战中 · 各人各答各的词,看右侧实时榜比拼
            </div>
          )}
          {isPlayer && currentQ && wordDataStub && currentQ.phase === 'classify' && (
            <ClassificationPhase
              key={`classify-${currentQ.word_idx}`}
              words={[]}
              onComplete={noOp}
              playAudio={noOpAudio}
              mode="pk"
              pkCurrentWord={wordDataStub}
              pkOnAnswer={(category, ms) => submit({ category }, ms)}
              pkDisabled={submitting}
            />
          )}
          {isPlayer && currentQ && wordDataStub && currentQ.phase === 'speech' && (
            <SpeechVerifyCard
              key={`speech-${currentQ.word_idx}`}
              word={wordDataStub as any}
              onNext={() => submit({ result: 'pass' }, Date.now() - questionStartedAtRef.current)}
              onSkip={() => submit({ result: 'skip' }, Date.now() - questionStartedAtRef.current)}
              playAudio={noOpAudio}
              disabled={submitting}
            />
          )}
          {isPlayer && currentQ && wordDataStub && currentQ.phase === 'dictation' && (
            <DictationSingle
              key={`dictation-${currentQ.word_idx}`}
              word={wordDataStub}
              onAnswer={(text, ms) => submit({ text }, ms)}
              disabled={submitting}
              timeoutMs={60_000}
            />
          )}
          {isPlayer && currentQ && wordDataStub && currentQ.phase === 'exam' && (
            // 过关阶段:题型由服务端权威决定(英译中/中译英选择 + 听音/看义拼写),
            // 与分类记忆法的过关检测一致。判分仍由服务端做(超时 30s)。
            <PkExamCard
              key={`exam-${currentQ.word_idx}`}
              word={wordDataStub}
              examType={currentQ.exam_type ?? 'spelling'}
              options={currentQ.options}
              onSelect={(selected, ms) => submit({ selected }, ms)}
              onText={(text, ms) => submit({ text }, ms)}
              disabled={submitting}
              timeoutMs={30_000}
            />
          )}
          {isPlayer && !currentQ && (
            <div className="p-6 text-center text-ink-mute">等待第一题…</div>
          )}
        </div>

        <div className="space-y-3">
          {specCount > 0 && (
            <p className="text-xs text-ink-mute mb-2 text-right">👀 {specCount} 人观战</p>
          )}
          {isTeamMode && teamRanking && <TeamRankingPanel items={teamRanking} />}
          {liveRanking && (
            <PkLiveRanking
              items={liveRanking}
              meId={meId}
              totalQuestions={totalQ}
              gains={lastGains}
              settleSeq={settleSeq}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const TEAM_TONE = ['from-blue-400 to-blue-500', 'from-rose-400 to-rose-500', 'from-emerald-400 to-emerald-500', 'from-amber-400 to-amber-500'];
const TEAM_RANK_BADGE: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** 全场倒计时条:每秒刷新,剩余时间越少越红。到 0 显示"结算中"(服务端会推 game_finished)。 */
function CountdownBar({ deadlineIso }: { deadlineIso: string }) {
  const deadline = new Date(deadlineIso).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor((deadline - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const urgent = left <= 30;
  return (
    <div className={`flex items-center justify-center gap-2 py-1.5 text-sm font-semibold ${
      urgent ? 'text-red-500' : 'text-ink-soft'
    }`}>
      <span>⏱️</span>
      <span className="font-numeric tabular-nums">{left > 0 ? `${mm}:${ss}` : '结算中…'}</span>
      {left > 0 && <span className="text-xs font-normal text-ink-mute">全场倒计时</span>}
    </div>
  );
}

/** 分组赛队伍榜:队伍聚合得分,复用现有 card-soft 风格。 */
function TeamRankingPanel({ items }: { items: PkTeamRankItem[] }) {
  return (
    <div className="card-soft rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="font-display font-semibold text-ink flex items-center gap-1.5">
          <span>👥</span> 队伍榜
        </h3>
        <span className="text-[11px] text-ink-mute">按人均分排名</span>
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <motion.div
            key={it.team}
            layout
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            className="flex items-center gap-2 rounded-xl px-2.5 py-2 bg-gray-50"
          >
            <span className="w-7 text-center shrink-0">
              {TEAM_RANK_BADGE[it.rank] ?? (
                <span className="text-sm font-semibold text-ink-mute font-numeric">{it.rank}</span>
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-full bg-gradient-to-br ${TEAM_TONE[(it.team - 1) % TEAM_TONE.length]}`} />
                <span className="truncate text-sm font-medium text-ink">第 {it.team} 队</span>
                <span className="text-[11px] text-ink-mute shrink-0">{it.online_count}/{it.member_count} 人</span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-base font-bold text-ink font-numeric block leading-none">人均 {it.avg_points}</span>
              <span className="text-[10px] text-ink-mute font-numeric">总 {it.points}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
