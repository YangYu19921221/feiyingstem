/** 今日智能任务卡 — 把「到期复习 → 错题闯关 → 新词」编排成一条默认路径
 *  孩子自选时永远选新词跳过复习,这张卡替他排好顺序:一个按钮,做完为止。 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import client from '../api/client';

interface PlanStep {
  key: string;
  label: string;
  icon: string;
  desc: string;
  count: number;
  done: boolean;
  route: string;
}
interface DailyPlan {
  steps: PlanStep[];
  all_done: boolean;
  today_words: number;
  target: number;
}

export default function DailyPlanCard() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<DailyPlan | null>(null);

  useEffect(() => {
    client.get<DailyPlan>('/student/daily-plan').then(setPlan).catch(() => {});
  }, []);

  if (!plan) return null;

  const next = plan.steps.find(s => !s.done);
  const go = (step: PlanStep) => {
    // 新词步骤跳到页面下方"我的单词本"继续学习
    if (step.key === 'new') {
      document.getElementById('my-books')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(step.route);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 rounded-2xl p-5 shadow-md bg-gradient-to-r from-[#FF6B35] to-[#FFD23F] text-white"
    >
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-bold mb-3">📋 今日任务{plan.all_done && ' · 全部完成 🎉'}</h3>
          <div className="flex flex-wrap gap-2">
            {plan.steps.map(s => (
              <button
                key={s.key}
                onClick={() => go(s)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
                  s.done ? 'bg-white/25 line-through opacity-80' : 'bg-white text-gray-800 shadow hover:shadow-md'
                }`}
              >
                <span>{s.done ? '✅' : s.icon}</span>
                <span className="font-medium">{s.label}</span>
                <span className={s.done ? '' : 'text-gray-500'}>{s.desc}</span>
              </button>
            ))}
          </div>
        </div>
        {next && (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => go(next)}
            className="shrink-0 px-6 py-3 rounded-2xl bg-white text-[#FF6B35] font-bold shadow-lg"
          >
            开始今日任务 →
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
