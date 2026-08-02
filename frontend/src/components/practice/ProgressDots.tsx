import React from 'react';

interface ProgressDotsProps {
  total: number;
  results: (boolean | null)[];
  currentIndex: number;
}

const ProgressDots: React.FC<ProgressDotsProps> = ({ total, results, currentIndex }) => {
  return (
    <ol
      className="mb-4 flex flex-wrap justify-center gap-1.5"
      aria-label={`答题进度：第 ${Math.min(currentIndex + 1, total)} 题，共 ${total} 题`}
    >
      {Array.from({ length: total }, (_, i) => {
        const result = results[i];
        let bg = 'bg-gray-200';
        if (result === true) bg = 'bg-green-400';
        else if (result === false) bg = 'bg-red-400';
        else if (i === currentIndex) bg = 'bg-orange-400 scale-125';

        const label = result === true
          ? `第 ${i + 1} 题，回答正确`
          : result === false
            ? `第 ${i + 1} 题，回答错误`
            : i === currentIndex
              ? `第 ${i + 1} 题，当前题`
              : `第 ${i + 1} 题，未作答`;

        return (
          <li
            key={i}
            aria-label={label}
            aria-current={i === currentIndex ? 'step' : undefined}
            title={label}
          >
            <span className={`block h-2.5 w-2.5 rounded-full transition-all duration-200 ${bg}`} aria-hidden="true" />
          </li>
        );
      })}
    </ol>
  );
};

export default ProgressDots;
