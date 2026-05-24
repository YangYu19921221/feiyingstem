import { useEffect, useRef, useState } from 'react';

interface DictationSingleProps {
  word: { id: number; word: string; translation: string };
  onAnswer: (text: string, timeSpentMs: number) => void;
  disabled?: boolean;
  /** Server-side timeout in ms; UI countdown only — server is source of truth. */
  timeoutMs?: number;
}

export default function DictationSingle({
  word,
  onAnswer,
  disabled = false,
  timeoutMs = 60_000,
}: DictationSingleProps) {
  const [text, setText] = useState('');
  const [remaining, setRemaining] = useState(timeoutMs);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    setText('');
    startRef.current = Date.now();
    setRemaining(timeoutMs);
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, timeoutMs - (Date.now() - startRef.current)));
    }, 200);
    return () => window.clearInterval(timer);
  }, [word.id, timeoutMs]);

  const submit = () => {
    if (disabled || !text.trim()) return;
    onAnswer(text.trim(), Date.now() - startRef.current);
  };

  return (
    <div className="flex flex-col p-6 bg-white rounded-2xl shadow-md">
      <p className="text-sm text-gray-500">听写</p>
      <p className="text-2xl font-semibold mb-1">{word.translation}</p>
      <p className="text-xs text-gray-400 mb-4">剩余 {Math.ceil(remaining / 1000)} 秒</p>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        disabled={disabled}
        autoFocus
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
        placeholder="输入英文"
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg font-medium disabled:opacity-50"
      >
        提交
      </button>
    </div>
  );
}
