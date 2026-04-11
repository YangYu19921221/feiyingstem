import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import FlashCard from '../components/FlashCard';
import { getWords, type Word } from '../api/words';
import { toast } from '../components/Toast';

const Learn = () => {
  const navigate = useNavigate();
  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    known: 0,
    unknown: 0,
    skipped: 0,
  });
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // 获取用户信息
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
  }, []);

  useEffect(() => {
    loadWords();
  }, []);

  const loadWords = async () => {
    try {
      setLoading(true);
      setError(null);

      // 先获取单词列表
      const wordList = await getWords({ limit: 20 });

      if (wordList.length === 0) {
        setError('暂无单词数据。请先在后端添加一些单词!');
        return;
      }

      // 逐个获取单词详情(包含definitions和tags)
      const { getWord } = await import('../api/words');
      const detailedWords = await Promise.all(
        wordList.map(item => getWord(item.id))
      );

      setWords(detailedWords);
    } catch (err) {
      console.error('加载单词失败:', err);
      setError('加载单词失败,请检查后端服务是否正常运行');
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    setStats({ ...stats, skipped: stats.skipped + 1 });
    moveToNext();
  };

  const handleKnow = () => {
    setStats({ ...stats, known: stats.known + 1 });
    moveToNext();
  };

  const handleDontKnow = () => {
    setStats({ ...stats, unknown: stats.unknown + 1 });
    moveToNext();
  };

  const moveToNext = () => {
    if (currentIndex < words.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // 完成所有单词
      toast.success(`学习完成! 📚 认识: ${stats.known + 1} 个 ✅ 不认识: ${stats.unknown} 个 ❌ 跳过: ${stats.skipped} 个 ⏭️ 总计: ${words.length} 个单词`);

      // 重新开始
      setCurrentIndex(0);
      setStats({ known: 0, unknown: 0, skipped: 0 });
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mx-auto mb-4"></div>
          <p className="text-xl text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md text-center">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">出错了</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={loadWords}
            className="px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50">
        <div className="text-center">
          <p className="text-xl text-gray-600">暂无单词数据</p>
        </div>
      </div>
    );
  }

  const currentWord = words[currentIndex];
  const progress = ((currentIndex + 1) / words.length) * 100;

  return (
    <div className="relative">
      {/* 顶部进度条 */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <div className="h-2 bg-gray-200">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-300"
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        {/* 统计信息 */}
        <div className="bg-white/90 backdrop-blur-sm shadow-sm py-2 px-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center text-sm">
            <div className="flex items-center gap-4">
              <span className="text-gray-600">
                进度: {currentIndex + 1} / {words.length}
              </span>
              {user && (
                <span className="text-gray-500 text-xs">
                  👤 {user.full_name} ({user.role})
                </span>
              )}
            </div>
            <div className="flex gap-4 items-center">
              <span className="text-success">✅ {stats.known}</span>
              <span className="text-error">❌ {stats.unknown}</span>
              <span className="text-gray-500">⏭️ {stats.skipped}</span>
              <button
                onClick={handleLogout}
                className="ml-4 px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FlashCard */}
      <div className="pt-16">
        <FlashCard
          key={currentWord.id}
          word={currentWord}
          onNext={handleNext}
          onKnow={handleKnow}
          onDontKnow={handleDontKnow}
        />
      </div>
    </div>
  );
};

export default Learn;
