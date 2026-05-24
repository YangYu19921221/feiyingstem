import { useCallback, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePkSocket, type PkServerEvent } from '../hooks/usePkSocket';
import type { PkRoomSnapshot, PkPhase } from '../api/pk';
import ClassificationPhase from '../components/classify/ClassificationPhase';
import SpeechVerifyCard from '../components/classify/SpeechVerifyCard';
import DictationSingle from '../components/classify/DictationSingle';
import PkPlayerList from '../components/pk/PkPlayerList';
import PkLiveProgress from '../components/pk/PkLiveProgress';
import PkResultBoard from '../components/pk/PkResultBoard';

interface CurrentQuestion {
  word_idx: number;
  phase: PkPhase;
  word: { id: number; word: string; translation: string };
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
}

function getMeId(): number {
  // Project stores user info under 'user' key (see Login.tsx / Register.tsx).
  try {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const parsed = JSON.parse(userStr);
      if (parsed?.id) return Number(parsed.id);
    }
  } catch {
    // ignore parse errors
  }
  const direct = localStorage.getItem('user_id');
  if (direct) return Number(direct);
  const token = localStorage.getItem('access_token') || '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    return Number(payload.sub) || 0;
  } catch {
    return 0;
  }
}

const noOp = () => {};
const noOpAudio = (_w: string) => {};

export default function PkArena() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const meId = getMeId();
  const token = localStorage.getItem('access_token') || '';

  const [snapshot, setSnapshot] = useState<PkRoomSnapshot | null>(null);
  const [currentQ, setCurrentQ] = useState<CurrentQuestion | null>(null);
  const questionStartedAtRef = useRef<number>(0);
  const [waitingForOthers, setWaitingForOthers] = useState(false);
  const [ranking, setRanking] = useState<RankItem[] | null>(null);
  const [errorBanner, setErrorBanner] = useState('');

  const handleEvent = useCallback(
    (event: PkServerEvent) => {
      switch (event.type) {
        case 'room_state':
          setSnapshot(event.room as PkRoomSnapshot);
          break;
        case 'question_pushed':
          setCurrentQ({
            word_idx: event.word_idx,
            phase: event.phase as PkPhase,
            word: event.word,
          });
          questionStartedAtRef.current = Date.now();
          setWaitingForOthers(false);
          break;
        case 'player_answered':
          if (event.user_id === meId) setWaitingForOthers(true);
          break;
        case 'question_settled':
          setWaitingForOthers(false);
          break;
        case 'phase_advanced':
          setSnapshot((s) => (s ? { ...s, current_phase: event.new_phase } : s));
          break;
        case 'game_finished':
          setRanking(event.ranking as RankItem[]);
          break;
        case 'error':
          setErrorBanner(event.message || event.code || 'Error');
          break;
        default:
          // player_disconnected / reconnected / kicked / host_changed:
          // server follows up with room_state for visible UI changes
          break;
      }
    },
    [meId]
  );

  const { send, connected } = usePkSocket({
    roomId: Number(roomId),
    token,
    onEvent: handleEvent,
    onClose: () => setErrorBanner('连接已断开,正在重连…'),
  });

  const submit = useCallback(
    (payload: object, timeSpentMs: number) => {
      if (!currentQ) return;
      send({
        type: 'submit_answer',
        word_idx: currentQ.word_idx,
        phase: currentQ.phase,
        payload,
        time_spent_ms: timeSpentMs,
      });
    },
    [send, currentQ]
  );

  // Game finished → result board
  if (ranking) {
    return (
      <PkResultBoard
        ranking={ranking}
        meId={meId}
        onExit={() => navigate('/student/dashboard')}
      />
    );
  }

  // Connection / loading
  if (!snapshot) {
    return (
      <div className="p-6 text-center text-gray-500">
        {connected ? '加载中…' : '连接中…'}
      </div>
    );
  }

  // Waiting room (host hasn't started yet)
  if (snapshot.status === 'waiting') {
    const isHost = snapshot.host_id === meId;
    return (
      <div className="p-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold mb-3">等待开始</h2>
        <p className="text-sm text-gray-500 mb-4">
          邀请码: <span className="font-mono tracking-widest">{snapshot.invite_code}</span>
        </p>
        <PkPlayerList
          players={snapshot.players}
          totalQuestions={snapshot.total_words * 4}
          hostId={snapshot.host_id}
          meId={meId}
        />
        {isHost ? (
          <button
            onClick={() => send({ type: 'start_game' })}
            disabled={snapshot.players.length < 2}
            className="mt-4 w-full py-2 bg-green-500 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {snapshot.players.length < 2 ? '至少需要 2 人' : '开始 PK'}
          </button>
        ) : (
          <p className="mt-4 text-center text-sm text-gray-500">等待房主开始…</p>
        )}
        {errorBanner && (
          <p className="mt-3 text-sm text-red-500">{errorBanner}</p>
        )}
      </div>
    );
  }

  // Playing — render current phase
  const totalQ = snapshot.total_words * 4;
  const wordDataStub = currentQ
    ? {
        id: currentQ.word.id,
        word: currentQ.word.word,
        translation: currentQ.word.translation,
      }
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PkLiveProgress
        phase={snapshot.current_phase}
        currentIdx={snapshot.current_word_idx}
        totalQuestions={totalQ}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 flex-1">
        <div className="md:col-span-2">
          {errorBanner && (
            <div className="mb-2 text-red-500 text-sm">{errorBanner}</div>
          )}
          {currentQ && wordDataStub && currentQ.phase === 'classify' && (
            <ClassificationPhase
              key={`classify-${currentQ.word_idx}`}
              words={[]}
              onComplete={noOp}
              playAudio={noOpAudio}
              mode="pk"
              pkCurrentWord={wordDataStub}
              pkOnAnswer={(category, ms) => submit({ category }, ms)}
              pkDisabled={waitingForOthers}
            />
          )}
          {currentQ && wordDataStub && currentQ.phase === 'speech' && (
            <SpeechVerifyCard
              key={`speech-${currentQ.word_idx}`}
              word={wordDataStub as any}
              onNext={() => submit({ result: 'pass' }, Date.now() - questionStartedAtRef.current)}
              onSkip={() => submit({ result: 'skip' }, Date.now() - questionStartedAtRef.current)}
              playAudio={noOpAudio}
              disabled={waitingForOthers}
            />
          )}
          {currentQ && wordDataStub && currentQ.phase === 'dictation' && (
            <DictationSingle
              key={`dictation-${currentQ.word_idx}`}
              word={wordDataStub}
              onAnswer={(text, ms) => submit({ text }, ms)}
              disabled={waitingForOthers}
            />
          )}
          {currentQ && wordDataStub && currentQ.phase === 'exam' && (
            // First-cut exam UI: reuse dictation single (typing English).
            // Future task will extend to multiple-choice once backend pushes options.
            <DictationSingle
              key={`exam-${currentQ.word_idx}`}
              word={wordDataStub}
              onAnswer={(text, ms) =>
                submit({ selected: 0, correct: 0, text }, ms)
              }
              disabled={waitingForOthers}
            />
          )}
          {!currentQ && (
            <div className="p-6 text-center text-gray-400">
              等待第一题…
            </div>
          )}
        </div>
        <div>
          <h3 className="font-semibold mb-2">玩家</h3>
          <PkPlayerList
            players={snapshot.players}
            totalQuestions={totalQ}
            hostId={snapshot.host_id}
            meId={meId}
          />
        </div>
      </div>
    </div>
  );
}
