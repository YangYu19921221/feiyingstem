import React from 'react';
import { useNavigate } from 'react-router-dom';

interface PracticeHeaderProps {
  unitName?: string;
  totalWords?: number;
  accuracy: number;
  timeSpent: number;
  formatTime: (s: number) => string;
}

const PracticeHeader: React.FC<PracticeHeaderProps> = ({
  unitName,
  totalWords,
  accuracy,
  timeSpent,
  formatTime,
}) => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between mb-4">
      <button
        onClick={() => navigate(-1)}
        className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1"
      >
        ← 返回
      </button>

      {unitName && (
        <div className="text-sm text-gray-600 bg-white/80 px-3 py-1 rounded-full shadow-sm">
          📖 {unitName}{totalWords ? ` · ${totalWords}个单词` : ''}
        </div>
      )}

      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span className="opacity-60">{formatTime(timeSpent)}</span>
        <span className="text-orange-500 font-medium">{accuracy}%</span>
      </div>
    </div>
  );
};

export default PracticeHeader;
