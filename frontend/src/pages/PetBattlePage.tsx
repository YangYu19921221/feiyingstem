import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, RefreshCw, Swords, WifiOff, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BattleWebSocket,
  AnswerWebSocket,
  Battle,
  BattlePetOption,
  QuestionData,
  RoundResult,
  type BattleEndData,
} from '../api/petBattle';
import {
  getPetDefinition,
  getPetImage,
  getPetBackImage,
  hasPetBackImage,
  FINALE_KO_SECONDS,
  FINALE_PLAIN_SECONDS,
} from '../config/petSpecies';
import BattleStage, { type StagePet } from '../components/battle/BattleStage';
import { buildRoundFx, pickArena, type BattleFx, type Side } from '../components/battle/fx';
import { bindBattleSfxUnlock } from '../utils/battleSfx';
import BattleEnd from '../components/battle/BattleEnd';
import { useAudio } from '../hooks/useAudio';
import {
  getPetType,
  getEffectiveness,
  TYPE_ICONS,
  TYPE_COLORS,
  TYPE_NAMES
} from '../utils/typeEffectiveness';

type BattlePhase = 'waiting' | 'countdown' | 'question' | 'answering' | 'result' | 'end';

export default function PetBattlePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const { battleId } = useParams<{ battleId: string }>();
  const { playAudio } = useAudio();

  const [phase, setPhase] = useState<BattlePhase>('waiting');
  const [battle, setBattle] = useState<Battle | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [myAnswer, setMyAnswer] = useState<string | null>(null);
  const [opponentAnswered, setOpponentAnswered] = useState(false);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [endResult, setEndResult] = useState<BattleEndData | null>(null);
  // 当前回合的特效列表; 回合开始时清空
  const [battleFx, setBattleFx] = useState<BattleFx[]>([]);
  // 结算页是否已可见(等特效和终幕动画播完才打开)
  const [endVisible, setEndVisible] = useState(false);
  const [switchingPetId, setSwitchingPetId] = useState<number | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState('');
  // 场地背景(battle_start 时按属性和对战编号固定)
  const arenaUrlRef = useRef<string>('/battle-arena/meadow.jpg');
  const [arenaUrl, setArenaUrl] = useState('/battle-arena/meadow.jpg');

  const battleWs = useRef<BattleWebSocket | null>(null);
  const answerWs = useRef<AnswerWebSocket | null>(null);
  const battleStateRef = useRef<Battle | null>(null);
  const fxClearTimer = useRef<number | null>(null);
  const questionStartTime = useRef<number>(0);
  // 战斗结束后忽略一切残留的回合消息,防止结算页被拉回答题界面
  const battleEndedRef = useRef(false);
  // 保存最后一回合结果里的 KO 信息,用于决定终幕等待时长
  const lastRoundKoRef = useRef(false);

  // 解锁 Web Audio(首次用户交互后激活,对战页每次点答案都算)
  useEffect(() => {
    const cleanup = bindBattleSfxUnlock();
    return cleanup;
  }, []);

  // 获取Token
  // 注意：全项目登录时存的是 access_token 和 user(对象)，
  // 这里必须用相同的 key，否则 token 读空 → WS 永不连接 → 卡在"准备战斗中"
  const token = localStorage.getItem('access_token') || '';
  const currentUserId = (() => {
    try {
      return Number(JSON.parse(localStorage.getItem('user') || '{}').id) || 0;
    } catch {
      return 0;
    }
  })();

  // 判断是玩家1还是玩家2
  const isPlayer1 = battle?.player1_id === currentUserId;
  const myPet = isPlayer1 ? battle?.player1_pet : battle?.player2_pet;
  const opponentPet = isPlayer1 ? battle?.player2_pet : battle?.player1_pet;
  const myRoster = (isPlayer1 ? battle?.player1_roster : battle?.player2_roster) || [];
  const mySkill = myPet ? getPetDefinition(myPet.species).ultimate : null;
  const skillProgress = myPet
    ? (myPet.ultimate_charges > 0 ? 3 : myPet.combo % 3)
    : 0;

  // 计算属性克制关系
  const myType = myPet ? getPetType(myPet.species) : 'normal';
  const opponentType = opponentPet ? getPetType(opponentPet.species) : 'normal';
  const myEffectiveness = getEffectiveness(myType, opponentType);
  const opponentEffectiveness = getEffectiveness(opponentType, myType);
  const myTypeIcon = TYPE_ICONS[myType];
  const opponentTypeIcon = TYPE_ICONS[opponentType];

  useEffect(() => {
    const species = new Set([myPet?.species, opponentPet?.species]);
    species.forEach((value) => {
      if (!value) return;
      const image = new Image();
      image.src = getPetDefinition(value).ultimate.image;
    });
  }, [myPet?.species, opponentPet?.species]);

  useEffect(() => {
    console.log('PetBattlePage mounted, battleId:', battleId, 'token:', token ? 'exists' : 'missing');

    if (!battleId || !token) {
      console.error('缺少battleId或token');
      setConnectionError('没有找到这场对战，请返回宠物页面重新进入。');
      return;
    }

    setConnectionError('');
    battleEndedRef.current = false;

    // 连接WebSocket
    console.log('正在连接WebSocket...');
    const ws = new BattleWebSocket(Number(battleId), token);
    const ansWs = new AnswerWebSocket(Number(battleId), token);

    battleWs.current = ws;
    answerWs.current = ansWs;

    // 连接
    Promise.all([ws.connect(), ansWs.connect()]).then(() => {
      console.log('✅ WebSocket连接成功');
    }).catch((error) => {
      console.error('❌ WebSocket连接失败:', error);
      setConnectionError('暂时没有连上对战服务器，请检查网络后重试。');
    });

    // 监听事件
    ws.on('waiting', (data) => {
      setPhase('waiting');
    });

    ws.on('countdown', (data) => {
      setPhase('countdown');
      setCountdown(data.seconds);
      let count = data.seconds;
      const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) clearInterval(interval);
      }, 1000);
    });

    ws.on('battle_start', (data) => {
      battleStateRef.current = data.battle;
      setBattle(data.battle);
      // 场地按双方属性 + 对战编号固定,整场不变
      const b = data.battle;
      const myIsP1 = b.player1_id === currentUserId;
      const myEl = getPetDefinition(myIsP1 ? b.player1_pet.species : b.player2_pet.species).element;
      const oppEl = getPetDefinition(myIsP1 ? b.player2_pet.species : b.player1_pet.species).element;
      const url = `/battle-arena/${pickArena(b.id, myEl, oppEl)}.jpg`;
      arenaUrlRef.current = url;
      setArenaUrl(url);
    });

    ws.on('new_round', (data) => {
      if (battleEndedRef.current) return;
      setPhase('question');
      setCurrentRound(data.round_number);
      setCurrentQuestion(data.question);
      setTimeLeft(data.time_limit);
      setSelectedAnswer(null);
      setMyAnswer(null);
      setOpponentAnswered(false);
      setRoundResult(null);
      setBattleFx([]);
      setSwitchingPetId(null);
      setSwitchError(null);
      if (fxClearTimer.current) {
        window.clearTimeout(fxClearTimer.current);
        fxClearTimer.current = null;
      }
      questionStartTime.current = Date.now();

      // 倒计时
      let time = data.time_limit;
      const interval = setInterval(() => {
        time--;
        setTimeLeft(time);
        if (time <= 0) clearInterval(interval);
      }, 1000);
    });

    ws.on('answer_received', (data) => {
      if (data.player_id !== currentUserId) {
        setOpponentAnswered(true);
      }
    });

    ws.on('round_result', (data) => {
      if (battleEndedRef.current) return;
      const result: RoundResult = data.result;
      setPhase('result');
      setRoundResult(result);

      const currentBattle = battleStateRef.current;
      if (!currentBattle) return;

      const newBattle: Battle = {
        ...currentBattle,
        player1_pet: {
          ...currentBattle.player1_pet,
          hp: result.player1_hp_after,
          combo: result.player1_combo,
          ultimate_charges: result.player1_ultimate_charges,
        },
        player1_roster: (currentBattle.player1_roster || []).map((pet) => ({
          ...pet,
          hp: pet.pet_id === currentBattle.player1_pet.pet_id
            ? result.player1_hp_after
            : pet.hp,
        })),
        player2_pet: {
          ...currentBattle.player2_pet,
          hp: result.player2_hp_after,
          combo: result.player2_combo,
          ultimate_charges: result.player2_ultimate_charges,
        },
        player2_roster: (currentBattle.player2_roster || []).map((pet) => ({
          ...pet,
          hp: pet.pet_id === currentBattle.player2_pet.pet_id
            ? result.player2_hp_after
            : pet.hp,
        })),
      };
      battleStateRef.current = newBattle;
      setBattle(newBattle);

      // 用 fx.ts 的纯函数生成这一回合的特效时间轴
      const localIsPlayer1 = currentBattle.player1_id === currentUserId;
      const fx = buildRoundFx(result, currentBattle, localIsPlayer1);
      setBattleFx(fx);

      // 记录是否有 KO(血量归零),决定终幕等待时长
      const myIsP1 = currentBattle.player1_id === currentUserId;
      const myHpAfter = myIsP1 ? result.player1_hp_after : result.player2_hp_after;
      const oppHpAfter = myIsP1 ? result.player2_hp_after : result.player1_hp_after;
      lastRoundKoRef.current = myHpAfter <= 0 || oppHpAfter <= 0;

      if (fxClearTimer.current) window.clearTimeout(fxClearTimer.current);
      // fx 由 buildRoundFx 负责,旧的手工 effects 构建已移除

      // 结算等到特效播完再出现(由 BattleStage.onFinale 回调触发)
    });

    ws.on('pet_switched', (data) => {
      battleStateRef.current = data.battle;
      setBattle(data.battle);
      setSwitchingPetId(null);
      setSwitchError(null);
    });

    ws.on('battle_end', (data: BattleEndData) => {
      battleEndedRef.current = true;
      // 先保存结果,等 BattleStage 播完终幕动画后再显示结算页
      setEndResult(data);
      if (data.capture?.success) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['myPet'] }),
          queryClient.invalidateQueries({ queryKey: ['petCollection'] }),
          queryClient.invalidateQueries({ queryKey: ['petEvents'] }),
        ]);
      }
      // 如果最后一回合有 KO 就等更长的终幕
      const finaleMs = (lastRoundKoRef.current ? FINALE_KO_SECONDS : FINALE_PLAIN_SECONDS) * 1000;
      window.setTimeout(() => {
        setPhase('end');
        setEndVisible(true);
      }, finaleMs);
    });

    ws.on('error', (data) => {
      setConnectionError(data.message || '对战连接出现问题，请重试。');
    });

    ansWs.on('switch_error', (data) => {
      setSwitchingPetId(null);
      setSwitchError(data.message || '换宠失败');
    });

    ansWs.on('switch_accepted', () => {
      setSwitchingPetId(null);
    });

    return () => {
      if (fxClearTimer.current) window.clearTimeout(fxClearTimer.current);
      ws.close();
      ansWs.close();
    };
  }, [battleId, token, queryClient]);

  // 提交答案
  const submitAnswer = (answer: string, useUltimate = false) => {
    if (myAnswer) return; // 已答过

    const timeMs = Date.now() - questionStartTime.current;
    setMyAnswer(answer);
    setPhase('answering');

    answerWs.current?.submitAnswer(currentRound, answer, timeMs, useUltimate);
  };

  // 使用必杀技
  const useUltimate = () => {
    if (!myPet || myPet.ultimate_charges < 1) {
      alert('必杀技充能不足！连续答对3题可充能');
      return;
    }
    if (!selectedAnswer) {
      alert('请先选择答案');
      return;
    }
    submitAnswer(selectedAnswer, true);
  };

  const switchPet = (petId: number) => {
    if (phase !== 'result' || switchingPetId !== null) return;
    setSwitchError(null);
    setSwitchingPetId(petId);
    answerWs.current?.switchPet(petId);
  };

  if (!battle) {
    if (connectionError) {
      return (
        <main className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-4 py-10">
          <section className="card-soft w-full max-w-md rounded-2xl p-6 text-center sm:p-8" role="alert">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
              <WifiOff className="h-8 w-8" aria-hidden="true" />
            </div>
            <h1 className="font-display text-xl font-semibold text-ink">对战暂时没连上</h1>
            <p className="mt-2 text-sm leading-6 text-ink-soft">{connectionError} 宠物状态不会受影响。</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                再试一次
              </button>
              <button type="button" onClick={() => navigate('/student/pet')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-black/[0.05] px-5 text-sm font-semibold text-ink transition hover:bg-black/[0.08]">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                返回宠物页面
              </button>
            </div>
          </section>
        </main>
      );
    }

    return (
      <div className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-5">
        <div className="text-center">
          <motion.div
            className="mb-4 text-6xl"
            animate={reduceMotion ? undefined : {
              rotate: [0, 10, -10, 0],
              scale: [1, 1.1, 1]
            }}
            transition={{
              repeat: Infinity,
              duration: 1.5
            }}
          >
            ⚔️
          </motion.div>
          <div className="mb-2 font-display text-xl font-bold text-ink">准备战斗中...</div>
          <div className="text-sm text-ink-soft">
            {phase === 'waiting' ? '等待对手连接...' : '加载战斗数据...'}
          </div>
          <div className="mx-auto mt-4 h-2 w-48 overflow-hidden rounded-full bg-orange-100">
            <motion.div
              className="h-full w-1/2 rounded-full bg-accent-warm"
              animate={reduceMotion ? undefined : { x: ['-100%', '200%'] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          <button type="button" onClick={() => navigate('/student/pet')} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-50">
            返回宠物页面
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-paper">
      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/student/pet')}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-orange-50"
            aria-label="返回宠物页面"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="text-center">
            <div className="text-lg font-bold text-gray-800">
              回合 {currentRound}/{battle.max_rounds}
            </div>
            {phase === 'question' && (
              <div className="text-sm text-orange-500 font-bold">⏱️ {timeLeft}秒</div>
            )}
          </div>
          <div className="w-12" />
        </div>
      </nav>

      {/* 主战场 */}
      <div className="max-w-7xl mx-auto px-2.5 py-3 sm:px-4 sm:py-6">
        {/* 等待阶段 */}
        {phase === 'waiting' && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4 animate-pulse">⏳</div>
            <div className="text-2xl font-bold text-gray-700 mb-2">等待对手连接...</div>
            <div className="text-gray-500">请稍候</div>
          </div>
        )}

        {/* 倒计时阶段 */}
        {phase === 'countdown' && (
          <div className="text-center py-20">
            <motion.div
              className="text-9xl font-bold text-orange-500"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ duration: 0.5 }}
              key={countdown}
            >
              {countdown}
            </motion.div>
            <div className="text-2xl text-gray-600 mt-4">对战即将开始！</div>
          </div>
        )}

        {/* 战斗阶段 */}
        {(phase === 'question' || phase === 'answering' || phase === 'result' || phase === 'end') && battle && myPet && opponentPet && (
          <div className="space-y-3 sm:space-y-4">
            {/* 属性克制提示 */}
            {phase !== 'end' && (
              <TypeMatchupBanner
                myType={myType}
                opponentType={opponentType}
                myTypeIcon={myTypeIcon}
                opponentTypeIcon={TYPE_ICONS[opponentType]}
                myEffectiveness={myEffectiveness}
                opponentEffectiveness={opponentEffectiveness}
              />
            )}

            {/* 3D 战场(BattleStage 自带懒加载降级,不需要再套 Suspense) */}
            <div className="h-[clamp(260px,52vw,460px)] w-full sm:h-[360px] lg:h-[460px]">
            <BattleStage
              arenaUrl={arenaUrl}
              arenaName=""
              my={{
                image: getPetBackImage(myPet.species, myPet.evolution_stage)
                  || getPetImage(myPet.species, myPet.evolution_stage),
                name: myPet.name,
                level: myPet.level,
                hp: myPet.hp,
                maxHp: myPet.max_hp,
                gem: myPet.evolution_stage >= 4,
                typeIcon: TYPE_ICONS[getPetType(myPet.species)] ?? '',
                typeName: TYPE_NAMES[getPetType(myPet.species)] ?? '',
                combo: myPet.combo,
              }}
              opp={{
                image: getPetImage(opponentPet.species, opponentPet.evolution_stage),
                name: opponentPet.name,
                level: opponentPet.level,
                hp: opponentPet.hp,
                maxHp: opponentPet.max_hp,
                gem: opponentPet.evolution_stage >= 4,
                typeIcon: TYPE_ICONS[getPetType(opponentPet.species)] ?? '',
                typeName: TYPE_NAMES[getPetType(opponentPet.species)] ?? '',
                combo: opponentPet.combo,
              }}
              fx={battleFx}
              fxKey={`${currentRound}`}
              finale={phase === 'end' && endResult ? (() => {
                const winnerId = endResult.winner_id;
                if (!winnerId) return { loser: null, winner: null };
                const winnerIsMe = winnerId === currentUserId;
                return { loser: winnerIsMe ? (2 as const) : (1 as const), winner: winnerIsMe ? (1 as const) : (2 as const) };
              })() : null}
              calm={false}
            />
            </div>

            {/* 题目区域 */}
            {currentQuestion && phase !== 'result' && (
              <div className="card-soft rounded-xl p-3 sm:rounded-3xl sm:p-6">
                <div className="mb-3 text-center sm:mb-6">
                  <div className="mb-1 break-words text-lg font-bold text-gray-800 sm:mb-2 sm:text-2xl">
                    {currentQuestion.question_text}
                  </div>
                  <div className="break-words text-3xl font-bold text-orange-500 sm:text-4xl">
                    {currentQuestion.word}
                  </div>
                </div>

                {/* 选项 */}
                <div className="mb-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:mb-4 sm:gap-4">
                  {currentQuestion.options.map((option, index) => {
                    const letter = option[0]; // A/B/C/D
                    const isSelected = selectedAnswer === letter;
                    const isMyAnswer = myAnswer === letter;

                    return (
                      <motion.button
                        key={index}
                        whileHover={{ scale: myAnswer ? 1 : 1.02 }}
                        whileTap={{ scale: myAnswer ? 1 : 0.98 }}
                        disabled={!!myAnswer}
                        onClick={() => setSelectedAnswer(letter)}
                        className={`min-h-12 rounded-lg p-3 text-left transition-all sm:min-h-14 sm:rounded-xl sm:p-4 ${
                          isMyAnswer
                            ? 'bg-orange-500 text-white ring-4 ring-orange-300'
                            : isSelected
                            ? 'bg-orange-100 text-orange-700 border-2 border-orange-400'
                            : 'bg-gray-50 hover:bg-gray-100 border-2 border-gray-200'
                        }`}
                      >
                        <div className="break-words text-sm font-bold sm:text-lg">{option}</div>
                      </motion.button>
                    );
                  })}
                </div>

                {/* 操作按钮 */}
                {!myAnswer && (
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-700 sm:text-sm">
                          {myPet && myPet.ultimate_charges > 0
                            ? `${mySkill?.name || '技能攻击'}已就绪`
                            : '连续答对 3 题解锁技能'}
                        </div>
                        <div className="mt-1 flex gap-1.5" aria-label={`技能进度 ${skillProgress}/3`}>
                          {[1, 2, 3].map((step) => (
                            <span
                              key={step}
                              className={`h-1.5 w-8 rounded-full transition-colors sm:w-10 ${
                                step <= skillProgress ? 'bg-amber-500' : 'bg-slate-200'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs font-black tabular-nums text-amber-700 sm:text-sm">
                        {myPet?.ultimate_charges || 0} 次
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        disabled={!selectedAnswer}
                        onClick={() => selectedAnswer && submitAnswer(selectedAnswer)}
                        className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg bg-orange-500 px-3 py-3 text-sm font-bold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-45 sm:text-base"
                      >
                        <Swords className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
                        <span className="truncate">普通攻击</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: myPet && myPet.ultimate_charges > 0 ? 1.02 : 1 }}
                        whileTap={{ scale: myPet && myPet.ultimate_charges > 0 ? 0.98 : 1 }}
                        disabled={!selectedAnswer || !myPet || myPet.ultimate_charges < 1}
                        onClick={useUltimate}
                        className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-3 text-sm font-bold text-white shadow-md disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none sm:text-base"
                      >
                        <Zap className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
                        <span className="truncate">{mySkill?.name || '技能攻击'}</span>
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* 等待状态 */}
                {myAnswer && (
                  <div className="text-center py-4">
                    <div className="text-green-600 font-bold mb-2">✅ 已提交答案</div>
                    {!opponentAnswered && (
                      <div className="text-gray-500 text-sm animate-pulse">
                        等待对手答题...
                      </div>
                    )}
                    {opponentAnswered && (
                      <div className="font-semibold text-orange-700">
                        对手已答题，计算结果中...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 回合结果 */}
            {phase === 'result' && roundResult && (
              <>
                {myPet && myRoster.length > 1 && (
                  <PetSwitchPanel
                    roster={myRoster}
                    currentPetId={myPet.pet_id}
                    switchingPetId={switchingPetId}
                    error={switchError}
                    onSwitch={switchPet}
                  />
                )}
                <RoundResultPanel result={roundResult} isPlayer1={isPlayer1} />
              </>
            )}
          </div>
        )}

        {/* 结束阶段 */}
        {phase === 'end' && endResult && endVisible && battle && (
          <BattleEnd
            result={endResult}
            battle={battle}
            isPlayer1={isPlayer1}
            onBack={() => navigate('/student/pet')}
            onSpeak={(word, wordId) => playAudio(word, 1, wordId)}
          />
        )}
      </div>
    </div>
  );
}

function PetSwitchPanel({
  roster,
  currentPetId,
  switchingPetId,
  error,
  onSwitch,
}: {
  roster: BattlePetOption[];
  currentPetId: number;
  switchingPetId: number | null;
  error: string | null;
  onSwitch: (petId: number) => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-orange-100 bg-white/90 px-3 py-3 shadow-sm sm:px-4 sm:py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-800 sm:text-base">回合间歇 · 更换宠物</div>
          <div className="text-xs font-semibold text-orange-700">生命 {roster.find((pet) => pet.pet_id === currentPetId)?.hp || 0} HP</div>
        </div>
        <RefreshCw className="h-5 w-5 text-accent-warm" aria-hidden="true" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible">
        {roster.map((pet) => {
          const isCurrent = pet.pet_id === currentPetId;
          const isSwitching = switchingPetId === pet.pet_id;
          const hpPercent = Math.max(0, Math.min(100, (pet.hp / pet.max_hp) * 100));
          const disabled = isCurrent || !pet.can_switch || switchingPetId !== null;
          return (
            <motion.button
              key={pet.pet_id}
              whileTap={{ scale: disabled ? 1 : 0.97 }}
              disabled={disabled}
              onClick={() => onSwitch(pet.pet_id)}
              aria-label={isCurrent ? `${pet.name}正在出战` : `切换为${pet.name}`}
              className={`relative min-w-[132px] rounded-lg border-2 p-2 text-left transition-colors sm:min-w-0 ${
                isCurrent
                  ? 'border-orange-400 bg-orange-50'
                  : pet.can_switch
                    ? 'border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50'
                    : 'border-slate-200 bg-slate-100 opacity-55'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center">
                  <img
                    src={getPetImage(pet.species, pet.evolution_stage)}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-slate-800">{pet.name}</div>
                  <div className="text-[10px] font-semibold text-slate-500">Lv.{pet.level}</div>
                  <div className={`mt-1 text-[10px] font-bold ${
                    isCurrent ? 'text-orange-700' : pet.can_switch ? 'text-emerald-700' : 'text-slate-500'
                  }`}>
                    {isSwitching ? '切换中...' : isCurrent ? '出战中' : pet.can_switch ? '可切换' : '不可出战'}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${hpPercent > 50 ? 'bg-emerald-500' : hpPercent > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${hpPercent}%` }}
                  />
                </div>
                <span className="shrink-0 text-[9px] font-bold tabular-nums text-slate-500">{pet.hp}/{pet.max_hp}</span>
              </div>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 text-xs font-bold text-red-600"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// 属性克制提示横幅
function TypeMatchupBanner({
  myType,
  opponentType,
  myTypeIcon,
  opponentTypeIcon,
  myEffectiveness,
  opponentEffectiveness,
}: {
  myType: string;
  opponentType: string;
  myTypeIcon: string;
  opponentTypeIcon: string;
  myEffectiveness: number;
  opponentEffectiveness: number;
}) {
  const getMatchupText = () => {
    if (myEffectiveness === 2 && opponentEffectiveness === 0.5) {
      return { text: '你占优势！', color: 'text-green-600', emoji: '💪' };
    } else if (myEffectiveness === 0.5 && opponentEffectiveness === 2) {
      return { text: '对手占优势！', color: 'text-red-600', emoji: '⚠️' };
    } else if (myEffectiveness === 2) {
      return { text: '属性克制！你的攻击伤害翻倍', color: 'text-green-600', emoji: '💥' };
    } else if (opponentEffectiveness === 2) {
      return { text: '被克制了！对手的攻击伤害翻倍', color: 'text-orange-600', emoji: '🛡️' };
    } else if (myEffectiveness === 0) {
      return { text: '你的攻击完全无效！', color: 'text-gray-600', emoji: '❌' };
    } else if (opponentEffectiveness === 0) {
      return { text: '对手攻击完全无效！', color: 'text-green-600', emoji: '✨' };
    } else if (myEffectiveness === 0.5) {
      return { text: '你的攻击效果不好...', color: 'text-yellow-600', emoji: '🛡️' };
    } else if (opponentEffectiveness === 0.5) {
      return { text: '对手攻击效果不好', color: 'text-emerald-700', emoji: '💪' };
    }
    return { text: '势均力敌', color: 'text-gray-600', emoji: '⚖️' };
  };

  const matchup = getMatchupText();

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-white/90 px-3 py-2 shadow-lg backdrop-blur-sm sm:rounded-2xl sm:p-4"
    >
      <div className="flex items-center justify-center gap-2 sm:gap-4">
        <div className="text-2xl sm:text-3xl">{myTypeIcon}</div>
        <div className="min-w-0 text-center">
          <div className={`text-sm font-bold sm:text-lg ${matchup.color}`}>
            {matchup.emoji} {matchup.text}
          </div>
          <div className="mt-0.5 whitespace-nowrap text-[10px] text-gray-500 sm:mt-1 sm:text-xs">
            你 {myEffectiveness === 2 ? '×2.0' : myEffectiveness === 0.5 ? '×0.5' : myEffectiveness === 0 ? '×0' : '×1.0'} |
            对手 {opponentEffectiveness === 2 ? '×2.0' : opponentEffectiveness === 0.5 ? '×0.5' : opponentEffectiveness === 0 ? '×0' : '×1.0'}
          </div>
        </div>
        <div className="text-2xl sm:text-3xl">{opponentTypeIcon}</div>
      </div>
    </motion.div>
  );
}

// 宠物卡片 3D 组件 - 立体对战
function PetCard({
  pet,
  username,
  isMe,
  damage,
  typeEffectText,
}: {
  pet: any;
  username: string;
  isMe: boolean;
  damage: number | null;
  typeEffectText?: string;
}) {
  const petImage = getPetImage(pet.species, pet.evolution_stage);
  const hpPercent = (pet.hp / pet.max_hp) * 100;
  const [isHit, setIsHit] = useState(false);

  // 获取宠物属性
  const petType = getPetType(pet.species);
  const typeIcon = TYPE_ICONS[petType];
  const typeColor = TYPE_COLORS[petType];
  const typeName = TYPE_NAMES[petType];

  // 监听 damage 触发受击动画
  useEffect(() => {
    if (damage) {
      setIsHit(true);
      const timer = setTimeout(() => setIsHit(false), 600);
      return () => clearTimeout(timer);
    }
  }, [damage]);

  const isOpponent = !isMe;

  return (
    <motion.div
      className="relative"
      style={{ transformStyle: 'preserve-3d' }}
      animate={isHit ? {
        rotateY: isOpponent ? [-5, -20, -5] : [5, 20, 5],
        x: isOpponent ? [0, -15, 0] : [0, 15, 0],
        scale: [1, 0.92, 1],
      } : {
        y: [0, -8, 0],
      }}
      transition={isHit ? {
        duration: 0.6,
        times: [0, 0.3, 1]
      } : {
        repeat: Infinity,
        duration: 2.5,
        ease: 'easeInOut'
      }}
    >
      {/* 受击红闪遮罩 */}
      <AnimatePresence>
        {isHit && (
          <motion.div
            className="absolute inset-0 bg-red-500 rounded-3xl pointer-events-none z-30"
            initial={{ opacity: 0.8 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{ mixBlendMode: 'color-dodge' }}
          />
        )}
      </AnimatePresence>

      {/* 伤害数字 3D 弹出 */}
      <AnimatePresence>
        {damage && (
          <motion.div
            className="absolute -top-10 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
            initial={{ opacity: 1, y: 0, scale: 0.5, rotateX: -30 }}
            animate={{ opacity: 0, y: -90, scale: 2.2, rotateX: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            <div
              className="text-6xl font-black text-red-600"
              style={{
                textShadow: '0 4px 12px rgba(0,0,0,0.6), 0 0 30px rgba(255,0,0,0.9), 0 2px 0 white, 0 -2px 0 white, 2px 0 0 white, -2px 0 0 white',
                WebkitTextStroke: '3px white',
                filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))'
              }}
            >
              -{damage}
            </div>
            {typeEffectText && (
              <motion.div
                className="text-xl font-bold text-yellow-300 mt-1 text-center"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                style={{
                  textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(255,215,0,1)',
                  WebkitTextStroke: '1px rgba(139,69,19,0.8)'
                }}
              >
                {typeEffectText}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 立体地面投影 */}
      <div
        className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-[85%] h-10 bg-black/25 rounded-full blur-xl"
        style={{
          transform: 'translateZ(-15px) scaleX(1.3)',
          filter: 'blur(20px)'
        }}
      />

      {/* 卡片本体 */}
      <div
        className={`relative bg-white/95 backdrop-blur-sm rounded-3xl p-5 border-2 ${
          isMe ? 'border-blue-400 shadow-blue-500/40' : 'border-red-400 shadow-red-500/40'
        }`}
        style={{
          transform: 'translateZ(15px)',
          boxShadow: isHit
            ? '0 15px 50px rgba(255,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.3) inset'
            : '0 12px 45px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.2) inset',
          filter: isHit ? 'brightness(1.3) saturate(0.7)' : 'none'
        }}
      >
        {/* 用户名 */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-800">{username}</span>
              <span
                className="text-lg px-2 py-0.5 rounded-full text-white text-xs font-bold shadow-md"
                style={{ backgroundColor: typeColor }}
                title={typeName}
              >
                {typeIcon}
              </span>
            </div>
            <div className="text-xs text-gray-500 font-medium">Lv.{pet.level} {pet.name}</div>
          </div>
          {pet.ultimate_charges > 0 && (
            <div className="flex items-center gap-0.5 text-amber-500">
              {Array.from({ length: pet.ultimate_charges }).map((_, i) => (
                <Zap key={i} className="w-4 h-4 fill-current drop-shadow-md" />
              ))}
            </div>
          )}
        </div>

        {/* 宠物图片 - 微妙倾斜制造深度 */}
        <div className="flex justify-center mb-3">
          <motion.img
            src={petImage}
            alt={pet.name}
            className="w-36 h-36 object-contain"
            style={{
              filter: 'drop-shadow(0 10px 25px rgba(0,0,0,0.4))',
              transform: isOpponent ? 'rotateY(-12deg)' : 'rotateY(12deg)'
            }}
          />
        </div>

        {/* HP条 */}
        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-600 font-semibold">HP</span>
            <span className="font-bold text-gray-700">
              {pet.hp}/{pet.max_hp}
            </span>
          </div>
          <div className="h-3.5 bg-gray-200 rounded-full overflow-hidden shadow-inner">
            <motion.div
              className={`h-full ${
                hpPercent > 50
                  ? 'bg-gradient-to-r from-green-400 to-green-500'
                  : hpPercent > 20
                  ? 'bg-gradient-to-r from-yellow-400 to-orange-400'
                  : 'bg-gradient-to-r from-red-500 to-red-600'
              }`}
              initial={{ width: '100%' }}
              animate={{ width: `${hpPercent}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              style={{
                boxShadow: hpPercent < 30 ? '0 0 10px rgba(239, 68, 68, 0.7)' : 'none'
              }}
            />
          </div>
        </div>

        {/* 连击数 */}
        {pet.combo > 0 && (
          <motion.div
            className="flex items-center gap-1.5 justify-center text-orange-500 font-bold text-sm"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.2, 1] }}
            transition={{ duration: 0.4 }}
          >
            <span className="text-lg">🔥</span>
            {pet.combo} 连击!
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// 回合结果面板
function RoundResultPanel({ result, isPlayer1 }: { result: RoundResult; isPlayer1: boolean }) {
  const myResult = isPlayer1
    ? {
        answer: result.player1_answer,
        correct: result.player1_correct,
        damage: result.player1_damage,
        ultimate: result.player1_used_ultimate,
        typeText: result.player1_type_text,
      }
    : {
        answer: result.player2_answer,
        correct: result.player2_correct,
        damage: result.player2_damage,
        ultimate: result.player2_used_ultimate,
        typeText: result.player2_type_text,
      };

  const opponentResult = isPlayer1
    ? {
        answer: result.player2_answer,
        correct: result.player2_correct,
        damage: result.player2_damage,
        ultimate: result.player2_used_ultimate,
        typeText: result.player2_type_text,
      }
    : {
        answer: result.player1_answer,
        correct: result.player1_correct,
        damage: result.player1_damage,
        ultimate: result.player1_used_ultimate,
        typeText: result.player1_type_text,
      };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl bg-white p-3 shadow-xl sm:rounded-3xl sm:p-6"
    >
      <div className="mb-3 text-center sm:mb-6">
        <div className="mb-1 text-xl font-bold text-gray-800 sm:mb-2 sm:text-3xl">回合结果</div>
        <div className="break-words text-sm text-gray-600 sm:text-base">
          正确答案: <span className="font-bold text-green-600">{result.question.options.find(opt => opt[0] === result.question.correct_answer)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-6">
        {/* 我的结果 */}
        <div className={`rounded-xl p-2 sm:p-4 ${myResult.correct ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          <div className="text-center">
            <div className="mb-1 text-2xl sm:mb-2 sm:text-4xl">{myResult.correct ? '✅' : '❌'}</div>
            <div className="break-words text-xs font-bold text-gray-700 sm:text-base">你的答案: {myResult.answer}</div>
            {myResult.ultimate && <div className="mt-1 text-xs font-bold text-amber-700 sm:text-base">⚡ 使用了技能攻击</div>}
            {myResult.damage > 0 && (
              <div className="mt-1 sm:mt-2">
                <div className="text-sm font-bold text-red-600 sm:text-2xl">
                  造成 {myResult.damage} 伤害!
                </div>
                {myResult.typeText && (
                  <div className="mt-1 text-xs font-bold text-yellow-600 sm:text-lg">
                    {myResult.typeText}
                  </div>
                )}
              </div>
            )}
            {myResult.damage < 0 && (
              <div className="mt-2 text-sm font-bold text-gray-600 sm:text-xl">
                受到 {Math.abs(myResult.damage)} 伤害
              </div>
            )}
          </div>
        </div>

        {/* 对手结果 */}
        <div className={`rounded-xl p-2 sm:p-4 ${opponentResult.correct ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          <div className="text-center">
            <div className="mb-1 text-2xl sm:mb-2 sm:text-4xl">{opponentResult.correct ? '✅' : '❌'}</div>
            <div className="break-words text-xs font-bold text-gray-700 sm:text-base">对手答案: {opponentResult.answer}</div>
            {opponentResult.ultimate && <div className="mt-1 text-xs font-bold text-amber-700 sm:text-base">⚡ 使用了技能攻击</div>}
            {opponentResult.damage > 0 && (
              <div className="mt-1 sm:mt-2">
                <div className="text-sm font-bold text-red-600 sm:text-2xl">
                  造成 {opponentResult.damage} 伤害!
                </div>
                {opponentResult.typeText && (
                  <div className="mt-1 text-xs font-bold text-yellow-600 sm:text-lg">
                    {opponentResult.typeText}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-xs text-gray-500 sm:mt-6 sm:text-sm">
        下一回合即将开始...
      </div>
    </motion.div>
  );
}

