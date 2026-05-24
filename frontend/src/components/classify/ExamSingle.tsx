import { useEffect, useRef, useState } from 'react';

interface ExamOption {
  text: string;
}

interface ExamSingleProps {
  question: {
    word_id: number;
    prompt: string;
    options: ExamOption[];
    correct_index: number;
  };
  onAnswer: (selectedIndex: number, timeSpentMs: number) => void;
  disabled?: boolean;
}

export default function ExamSingle({ question, onAnswer, disabled = false }: ExamSingleProps) {
  const startRef = useRef<number>(Date.now());
  const [chosen, setChosen] = useState<number | null>(null);

  useEffect(() => {
    startRef.current = Date.now();
    setChosen(null);
  }, [question.word_id]);

  const pick = (idx: number) => {
    if (disabled || chosen !== null) return;
    setChosen(idx);
    onAnswer(idx, Date.now() - startRef.current);
  };

  return (
    <div className="flex flex-col p-6 bg-white rounded-2xl shadow-md">
      <p className="text-sm text-gray-500 mb-2">过关检测</p>
      <p className="text-xl font-semibold mb-4">{question.prompt}</p>
      <div className="flex flex-col gap-2">
        {question.options.map((opt, i) => (
          <button
            key={i}
            disabled={disabled || chosen !== null}
            onClick={() => pick(i)}
            className={`px-4 py-3 text-left border rounded-lg transition ${
              chosen === i ? 'bg-blue-100 border-blue-400' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
            } disabled:opacity-60`}
          >
            <span className="font-medium mr-2">{String.fromCharCode(65 + i)}.</span>
            {opt.text}
          </button>
        ))}
      </div>
    </div>
  );
}
