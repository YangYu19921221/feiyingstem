import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

const StudentDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const quickActions = [
    { icon: '🃏', title: '卡片记忆', desc: '翻转学习', route: '/learn', badge: null },
    { icon: '✅', title: 'AI测试', desc: '智能选择题', route: '/quiz', badge: 'AI' },
    { icon: '✏️', title: 'AI拼写', desc: '听写练习', route: '/spelling', badge: 'AI' },
    { icon: '📝', title: 'AI填空', desc: '例句练习', route: '/fill-blank', badge: 'AI' },
    { icon: '📖', title: '阅读理解', desc: '阅读答题', route: '/reading', badge: null },
  ];

  // 模拟薄弱单词数据
  const weakWordsCount = 8;

  const wordBooks = [
    { id: 1, name: '小学三年级上册', count: 120, emoji: '📚' },
    { id: 2, name: '动物主题', count: 45, emoji: '🐾' },
    { id: 3, name: '食物与饮料', count: 38, emoji: '🍎' },
  ];

  const achievements = [
    { icon: '🌱', name: '初出茅庐', unlocked: true },
    { icon: '📚', name: '小有成就', unlocked: true },
    { icon: '🔥', name: '每日一练', unlocked: true },
    { icon: '💪', name: '坚持不懈', unlocked: true },
    { icon: '🔒', name: '单词大师', unlocked: false },
    { icon: '🔒', name: '精准射手', unlocked: false },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📚</span>
            <h1 className="text-xl font-bold text-gray-800">英语学习助手</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              👤 {user?.full_name || '学生'}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 欢迎横幅 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-primary to-secondary rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            👋 Hi, {user?.full_name}!  今天是第 7 天打卡 🔥🔥🔥
          </h2>
          <p className="opacity-90">继续保持,你已经超越了85%的学习者!</p>
        </motion.div>

        {/* 今日学习目标 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-6 mb-8 shadow-md"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>⭐</span> 今日学习目标
          </h3>
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>10/20 个单词</span>
              <span>50%</span>
            </div>
            <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '50%' }}
                transition={{ duration: 1, delay: 0.3 }}
                className="h-full bg-gradient-to-r from-primary to-secondary"
              ></motion.div>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            💪 再学10个单词就完成今天的目标啦!
          </p>
        </motion.div>

        {/* 薄弱单词提醒 */}
        {weakWordsCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-2xl p-5 mb-8"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-4xl">💡</div>
                <div>
                  <h4 className="font-bold text-gray-800 mb-1">薄弱单词提醒</h4>
                  <p className="text-sm text-gray-600">
                    您有 <span className="font-bold text-orange-600">{weakWordsCount}</span> 个单词需要重点复习
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('/quiz')}
                className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:shadow-lg transition font-medium"
              >
                🤖 AI智能练习
              </button>
            </div>
          </motion.div>
        )}

        {/* 快速开始 */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-gray-800 mb-4">快速开始</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {quickActions.map((action, index) => (
              <motion.button
                key={action.title}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 * index }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => navigate(action.route)}
                className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition text-center relative"
              >
                {action.badge && (
                  <div className="absolute top-2 right-2 px-2 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold rounded-full">
                    {action.badge}
                  </div>
                )}
                <div className="text-5xl mb-3">{action.icon}</div>
                <h4 className="font-bold text-gray-800 mb-1">{action.title}</h4>
                <p className="text-xs text-gray-500">{action.desc}</p>
              </motion.button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* 我的单词本 */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl p-6 shadow-md"
          >
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span>📖</span> 我的单词本
            </h3>
            <div className="space-y-3">
              {wordBooks.map((book) => (
                <div
                  key={book.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{book.emoji}</span>
                    <div>
                      <h4 className="font-medium text-gray-800">{book.name}</h4>
                      <p className="text-xs text-gray-500">{book.count} 词</p>
                    </div>
                  </div>
                  <span className="text-gray-400">→</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* 成就墙 */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-2xl p-6 shadow-md"
          >
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span>🏆</span> 成就墙
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {achievements.map((achievement, index) => (
                <motion.div
                  key={achievement.name}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
                  className={`text-center p-4 rounded-lg ${
                    achievement.unlocked
                      ? 'bg-gradient-to-br from-yellow-100 to-orange-100'
                      : 'bg-gray-100'
                  }`}
                >
                  <div className="text-3xl mb-2">{achievement.icon}</div>
                  <p className="text-xs font-medium text-gray-700">
                    {achievement.name}
                  </p>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-gradient-to-r from-red-100 to-orange-100 rounded-lg">
              <p className="text-sm font-medium text-center">
                🔥 连续打卡 7 天
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
