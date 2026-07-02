import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Zap, Heart, Shield } from 'lucide-react';
import { BattleWebSocket, AnswerWebSocket, Battle, QuestionData, RoundResult } from '../../api/petBattle';

// 宠物图片映射
const PET_IMAGES: Record<string, string[]> = {
  pikachu: ['/pets/pichu.png', '/pets/pichu.png', '/pets/pikachu.png', '/pets/raichu.png'],
  eevee: ['/pets/eevee.png', '/pets/eevee.png', '/pets/eevee.png', '/pets/eevee.png'],
  bulbasaur: ['/pets/bulbasaur.png', '/pets/bulbasaur.png', '/pets/ivysaur.png', '/pets/venusaur.png'],
  charmander: ['/pets/charmander.png', '/pets/charmander.png', '/pets/charmeleon.png', '/pets/charizard.png'],
  squirtle: ['/pets/squirtle.png', '/pets/squirtle.png', '/pets/wartortle.png', '/pets/blastoise.png'],
};

function getPetImage(species: string, stage: number): string {
  const images = PET_IMAGES[species] || PET_IMAGES.pikachu;
  return images[Math.min(stage, images.length - 1)];
}

// 必杀技配置
const ULTIMATE_SKILLS: Record<string, { name: string; emoji: string }> = {
  pikachu: { name: '十万伏特', emoji: '⚡' },
  bulbasaur: { name: '飞叶快刀', emoji: '🍃' },
  charmander: { name: '火焰喷射', emoji: '🔥' },
  squirtle: { name: '水炮', emoji: '💧' },
  eevee: { name: '高速星星', emoji: '✨' },
};

type BattlePhase = 'waiting' | 'countdown' | 'question' | 'answering' | 'result' | 'end';

export default function PetBattlePage() {
  const navigate = useNavigate();
  const { battleId } = useParams<{ battleId: string }>();
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
  const [endResult, setEndResult] = useState<any>(null);
  const [damageAnimation, setDamageAnimation] = useState<{player: 1 | 2, damage: number} | null>(null);

  const battleWs = useRef<BattleWebSocket | null>(null);
  const answerWs = useRef<AnswerWebSocket | null>(null);
  const questionStartTime = useRef<number>(0);

  // 获取Token
  const token = localStorage.getItem('token') || '';
  const currentUserId = Number(localStorage.getItem('user_id') || 0);

  // 判断是玩家1还是玩家2
  const isPlayer1 = battle?.player1_id === currentUserId;
  const myPet = isPlayer1 ? battle?.player1_pet : battle?.player2_pet;
  const opponentPet = isPlayer1 ? battle?.player2_pet : battle?.player1_pet;

  useEffect(() => {
    if (!battleId || !token) return;

    // 连接WebSocket
    const ws = new BattleWebSocket(Number(battleId), token);
    const ansWs = new AnswerWebSocket(Number(battleId), token);

    battleWs.current = ws;
    answerWs.current = ansWs;

    // 连接
    Promise.all([ws.connect(), ansWs.connect()]).catch((error) => {
      console.error('WebSocket连接失败:', error);
      alert('连接失败,请重试');
      navigate(-1);
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
      setBattle(data.battle);
    });

    ws.on('new_round', (data) => {
      setPhase('question');
      setCurrentRound(data.round_number);
      setCurrentQuestion(data.question);
      setTimeLeft(data.time_limit);
      setSelectedAnswer(null);
      setMyAnswer(null);
      setOpponentAnswered(false);
      setRoundResult(null);
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
      setPhase('result');
      setRoundResult(data.result);

      // 更新战斗状态
      if (battle) {
        const newBattle = { ...battle };
        if (isPlayer1) {
          newBattle.player1_pet.hp = data.result.player1_hp_after;
          newBattle.player1_pet.combo = data.result.player1_correct ? (newBattle.player1_pet.combo + 1) : 0;
          newBattle.player2_pet.hp = data.result.player2_hp_after;
          newBattle.player2_pet.combo = data.result.player2_correct ? (newBattle.player2_pet.combo + 1) : 0;
        } else {
          newBattle.player1_pet.hp = data.result.player1_hp_after;
          newBattle.player2_pet.hp = data.result.player2_hp_after;
        }
        setBattle(newBattle);

        // 显示伤害动画
        if (data.result.player1_damage > 0) {
          setDamageAnimation({ player: 2, damage: data.result.player1_damage });
          setTimeout(() => setDamageAnimation(null), 1500);
        }
        if (data.result.player2_damage > 0) {
          setDamageAnimation({ player: 1, damage: data.result.player2_damage });
          setTimeout(() => setDamageAnimation(null), 1500);
        }
      }
    });

    ws.on('battle_end', (data) => {
      setPhase('end');
      setEndResult(data);
    });

    ws.on('error', (data) => {
      alert(data.message);
    });

    return () => {
      ws.close();
      ansWs.close();
    };
  }, [battleId, token]);

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

  if (!battle) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">⚔️</div>
          <div className="text-gray-600">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-100 to-blue-100">
      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
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
      <div className="max-w-7xl mx-auto px-4 py-6">
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
        {(phase === 'question' || phase === 'answering' || phase === 'result') && (
          <div className="space-y-6">
            {/* 宠物对战区域 */}
            <div className="grid grid-cols-2 gap-8">
              {/* 我的宠物 */}
              <PetCard
                pet={myPet!}
                username={isPlayer1 ? battle.player1_username : battle.player2_username}
                isMe={true}
                damage={damageAnimation?.player === 1 ? damageAnimation.damage : null}
              />

              {/* 对手宠物 */}
              <PetCard
                pet={opponentPet!}
                username={isPlayer1 ? battle.player2_username : battle.player1_username}
                isMe={false}
                damage={damageAnimation?.player === 2 ? damageAnimation.damage : null}
              />
            </div>

            {/* 题目区域 */}
            {currentQuestion && phase !== 'result' && (
              <div className="bg-white rounded-3xl p-6 shadow-lg border-2 border-orange-200">
                <div className="text-center mb-6">
                  <div className="text-2xl font-bold text-gray-800 mb-2">
                    {currentQuestion.question_text}
                  </div>
                  <div className="text-4xl font-bold text-orange-500">
                    {currentQuestion.word}
                  </div>
                </div>

                {/* 选项 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
                        className={`p-4 rounded-xl text-left transition-all ${
                          isMyAnswer
                            ? 'bg-orange-500 text-white ring-4 ring-orange-300'
                            : isSelected
                            ? 'bg-orange-100 text-orange-700 border-2 border-orange-400'
                            : 'bg-gray-50 hover:bg-gray-100 border-2 border-gray-200'
                        }`}
                      >
                        <div className="font-bold text-lg">{option}</div>
                      </motion.button>
                    );
                  })}
                </div>

                {/* 操作按钮 */}
                {!myAnswer && (
                  <div className="flex gap-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      disabled={!selectedAnswer}
                      onClick={() => selectedAnswer && submitAnswer(selectedAnswer)}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-400 to-yellow-400 text-white font-bold text-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      确认答案
                    </motion.button>

                    {myPet && myPet.ultimate_charges > 0 && (
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={useUltimate}
                        className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold shadow-lg flex items-center gap-2"
                      >
                        <Zap className="w-5 h-5" />
                        必杀技 ({myPet.ultimate_charges})
                      </motion.button>
                    )}
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
                      <div className="text-blue-600 font-semibold">
                        对手已答题，计算结果中...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 回合结果 */}
            {phase === 'result' && roundResult && (
              <RoundResultPanel result={roundResult} isPlayer1={isPlayer1} />
            )}
          </div>
        )}

        {/* 结束阶段 */}
        {phase === 'end' && endResult && (
          <EndResultPanel
            result={endResult}
            isPlayer1={isPlayer1}
            battle={battle}
            onBack={() => navigate('/student/pet')}
          />
        )}
      </div>
    </div>
  );
}

// 宠物卡片组件
function PetCard({
  pet,
  username,
  isMe,
  damage,
}: {
  pet: any;
  username: string;
  isMe: boolean;
  damage: number | null;
}) {
  const petImage = getPetImage(pet.species, pet.evolution_stage);
  const hpPercent = (pet.hp / pet.max_hp) * 100;
  const skill = ULTIMATE_SKILLS[pet.species] || ULTIMATE_SKILLS.pikachu;

  return (
    <div className={`relative ${isMe ? 'text-left' : 'text-right'}`}>
      {/* 伤害数字动画 */}
      <AnimatePresence>
        {damage && (
          <motion.div
            initial={{ opacity: 1, y: 0, scale: 1 }}
            animate={{ opacity: 0, y: -50, scale: 1.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="absolute top-0 left-1/2 transform -translate-x-1/2 z-20 text-5xl font-bold text-red-600"
            style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.3)' }}
          >
            -{damage}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`bg-white rounded-3xl p-6 shadow-lg border-2 ${isMe ? 'border-blue-200' : 'border-red-200'}`}>
        {/* 用户名 */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-bold text-gray-800">{username}</div>
            <div className="text-sm text-gray-500">Lv.{pet.level} {pet.name}</div>
          </div>
          {pet.ultimate_charges > 0 && (
            <div className="flex items-center gap-1 text-purple-500">
              {Array.from({ length: pet.ultimate_charges }).map((_, i) => (
                <Zap key={i} className="w-5 h-5 fill-current" />
              ))}
            </div>
          )}
        </div>

        {/* 宠物图片 */}
        <div className="flex justify-center mb-4">
          <motion.img
            src={petImage}
            alt={pet.name}
            className="w-32 h-32 object-contain"
            animate={{
              y: [0, -10, 0],
            }}
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: 'easeInOut',
            }}
          />
        </div>

        {/* HP条 */}
        <div className="mb-2">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">HP</span>
            <span className="font-bold text-gray-700">
              {pet.hp}/{pet.max_hp}
            </span>
          </div>
          <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              className={`h-full ${
                hpPercent > 50
                  ? 'bg-green-500'
                  : hpPercent > 20
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
              }`}
              initial={{ width: '100%' }}
              animate={{ width: `${hpPercent}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>

        {/* 连击数 */}
        {pet.combo > 0 && (
          <div className="flex items-center gap-2 justify-center text-orange-500 font-bold">
            🔥 {pet.combo} 连击!
          </div>
        )}
      </div>
    </div>
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
      }
    : {
        answer: result.player2_answer,
        correct: result.player2_correct,
        damage: result.player2_damage,
        ultimate: result.player2_used_ultimate,
      };

  const opponentResult = isPlayer1
    ? {
        answer: result.player2_answer,
        correct: result.player2_correct,
        damage: result.player2_damage,
        ultimate: result.player2_used_ultimate,
      }
    : {
        answer: result.player1_answer,
        correct: result.player1_correct,
        damage: result.player1_damage,
        ultimate: result.player1_used_ultimate,
      };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-3xl p-6 shadow-xl"
    >
      <div className="text-center mb-6">
        <div className="text-3xl font-bold text-gray-800 mb-2">回合结果</div>
        <div className="text-gray-600">
          正确答案: <span className="font-bold text-green-600">{result.question.options.find(opt => opt[0] === result.question.correct_answer)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 我的结果 */}
        <div className={`p-4 rounded-xl ${myResult.correct ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          <div className="text-center">
            <div className="text-4xl mb-2">{myResult.correct ? '✅' : '❌'}</div>
            <div className="font-bold text-gray-700">你的答案: {myResult.answer}</div>
            {myResult.ultimate && <div className="text-purple-600 font-bold">⚡ 使用了必杀技!</div>}
            {myResult.damage > 0 && (
              <div className="text-2xl font-bold text-red-600 mt-2">
                造成 {myResult.damage} 伤害!
              </div>
            )}
            {myResult.damage < 0 && (
              <div className="text-xl font-bold text-gray-600 mt-2">
                受到 {Math.abs(myResult.damage)} 伤害
              </div>
            )}
          </div>
        </div>

        {/* 对手结果 */}
        <div className={`p-4 rounded-xl ${opponentResult.correct ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          <div className="text-center">
            <div className="text-4xl mb-2">{opponentResult.correct ? '✅' : '❌'}</div>
            <div className="font-bold text-gray-700">对手答案: {opponentResult.answer}</div>
            {opponentResult.ultimate && <div className="text-purple-600 font-bold">⚡ 使用了必杀技!</div>}
            {opponentResult.damage > 0 && (
              <div className="text-2xl font-bold text-red-600 mt-2">
                造成 {opponentResult.damage} 伤害!
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-center mt-6 text-gray-500 text-sm">
        下一回合即将开始...
      </div>
    </motion.div>
  );
}

// 结束结果面板
function EndResultPanel({
  result,
  isPlayer1,
  battle,
  onBack,
}: {
  result: any;
  isPlayer1: boolean;
  battle: Battle;
  onBack: () => void;
}) {
  const isWinner = result.winner_id === (isPlayer1 ? battle.player1_id : battle.player2_id);
  const isDraw = !result.winner_id;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-2xl mx-auto"
    >
      <div className="bg-gradient-to-b from-white to-gray-50 rounded-3xl p-8 shadow-2xl text-center">
        {/* 胜负标题 */}
        <div className="mb-6">
          {isWinner && (
            <>
              <div className="text-8xl mb-4">🏆</div>
              <div className="text-4xl font-bold text-yellow-600 mb-2">胜利!</div>
            </>
          )}
          {!isWinner && !isDraw && (
            <>
              <div className="text-8xl mb-4">💔</div>
              <div className="text-4xl font-bold text-gray-600 mb-2">失败</div>
            </>
          )}
          {isDraw && (
            <>
              <div className="text-8xl mb-4">🤝</div>
              <div className="text-4xl font-bold text-blue-600 mb-2">平局</div>
            </>
          )}
          {result.winner_name && (
            <div className="text-xl text-gray-600">
              胜者: <span className="font-bold">{result.winner_name}</span>
            </div>
          )}
        </div>

        {/* 奖励 */}
        <div className="bg-orange-50 rounded-2xl p-6 mb-6">
          <div className="text-lg font-bold text-gray-800 mb-4">对战奖励</div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-3xl mb-1">🦴</div>
              <div className="text-2xl font-bold text-orange-500">+{result.food_earned}</div>
              <div className="text-sm text-gray-600">粮食</div>
            </div>
            <div>
              <div className="text-3xl mb-1">⭐</div>
              <div className="text-2xl font-bold text-blue-500">+{result.xp_earned}</div>
              <div className="text-sm text-gray-600">经验值</div>
            </div>
          </div>
        </div>

        {/* 对战数据 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="font-bold text-gray-700 mb-2">你的数据</div>
            <div className="text-sm text-gray-600 space-y-1">
              <div>正确: {result.player1_final_stats?.correct || 0}</div>
              <div>伤害: {result.player1_final_stats?.damage || 0}</div>
              <div>剩余HP: {result.player1_final_stats?.hp || 0}</div>
            </div>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <div className="font-bold text-gray-700 mb-2">对手数据</div>
            <div className="text-sm text-gray-600 space-y-1">
              <div>正确: {result.player2_final_stats?.correct || 0}</div>
              <div>伤害: {result.player2_final_stats?.damage || 0}</div>
              <div>剩余HP: {result.player2_final_stats?.hp || 0}</div>
            </div>
          </div>
        </div>

        {/* 返回按钮 */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onBack}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-400 to-yellow-400 text-white font-bold text-lg shadow-md"
        >
          返回宠物页面
        </motion.button>
      </div>
    </motion.div>
  );
}
