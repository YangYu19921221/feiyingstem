import React from 'react';

interface ProgressDotsProps {
  total: number;
  results: (boolean | null)[];
  currentIndex: number;
}

const ProgressDots: React.FC<ProgressDotsProps> = ({ total, results, currentIndex }) => {
  return (
    <div className="flex justify-center gap-1.5 flex-wrap mb-4">
      {Array.from({ length: total }, (_, i) => {
        const result = results[i];
        let bg = 'bg-gray-200';
        if (result === true) bg = 'bg-green-400';
        else if (result === false) bg = 'bg-red-400';
        else if (i === currentIndex) bg = 'bg-orange-400 scale-125';

        return (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${bg}`}
          />
        );
      })}
    </div>
  );
};

export default ProgressDots;
