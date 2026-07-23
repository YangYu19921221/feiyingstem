import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { teacherMonitor } from '../api/teacherMonitor';
import type { GroupScore, GroupWord } from '../api/teacherMonitor';

export default function TeacherStudentMonitor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const studentId = Number(id);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['student-groups', studentId],
    queryFn: () => teacherMonitor.studentGroups(studentId),
    enabled: !!studentId,
  });

  return (
    <div className="min-h-screen bg-[#f5f8fc] p-4 text-slate-800 md:p-6">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-gray-600 hover:text-orange-500 mb-4"
        >
          <ArrowLeft size={18} /> 返回
        </button>

        <h1 className="text-2xl font-bold text-gray-800 mb-6">学生学习监控</h1>

        {isLoading && (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        )}

        {!isLoading && groups.length === 0 && (
          <div className="text-center py-12 text-gray-400">暂无学习数据</div>
        )}

        <div className="space-y-2">
          {groups.map((g: GroupScore) => {
            const key = `${g.unit_id}-${g.group_index}`;
            const isOpen = openKey === key;
            return (
              <div key={key} className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <div
                  className="p-4 flex items-center gap-4 cursor-pointer hover:bg-orange-50 transition-colors"
                  onClick={() => setOpenKey(isOpen ? null : key)}
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">
                      {g.unit_name} · 第{g.group_index}组
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
                      <span>已学 {g.learned_count}/{g.word_count}</span>
                      <span>掌握 {g.mastered_count}</span>
                      <span>准确率 {(g.accuracy * 100).toFixed(0)}%</span>
                      {g.last_studied_at && (
                        <span>最近 {g.last_studied_at.slice(0, 10)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-orange-500">
                    {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </div>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <DrillDown
                        studentId={studentId}
                        unitId={g.unit_id}
                        groupIndex={g.group_index}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DrillDown({
  studentId,
  unitId,
  groupIndex,
}: {
  studentId: number;
  unitId: number;
  groupIndex: number;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['group-words', studentId, unitId, groupIndex],
    queryFn: () => teacherMonitor.groupWords(studentId, unitId, groupIndex),
  });

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-500">加载中...</div>;
  }

  return (
    <div className="border-t">
      <table className="w-full text-sm">
        <thead className="bg-amber-50">
          <tr>
            <th className="p-2 text-left font-medium text-gray-600">单词</th>
            <th className="p-2 text-center font-medium text-gray-600">掌握度</th>
            <th className="p-2 text-center font-medium text-gray-600">对/总</th>
            <th className="p-2 text-center font-medium text-gray-600">最近</th>
          </tr>
        </thead>
        <tbody>
          {(data as GroupWord[]).map((w) => (
            <tr key={w.word_id} className="border-t hover:bg-amber-50/50">
              <td className="p-2 text-gray-800">{w.word}</td>
              <td className="p-2 text-center">
                <MasteryBadge level={w.mastery_level} />
              </td>
              <td className="p-2 text-center text-gray-600">
                {w.correct_count}/{w.total_attempts}
              </td>
              <td className="p-2 text-center text-xs text-gray-500">
                {w.last_practiced_at?.slice(0, 10) ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MasteryBadge({ level }: { level: number }) {
  const colors: Record<number, string> = {
    0: 'bg-gray-200 text-gray-600',
    1: 'bg-red-100 text-red-600',
    2: 'bg-orange-100 text-orange-600',
    3: 'bg-yellow-100 text-yellow-700',
    4: 'bg-green-100 text-green-600',
    5: 'bg-emerald-200 text-emerald-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[level] ?? colors[0]}`}>
      {level}
    </span>
  );
}
