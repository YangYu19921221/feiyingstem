import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { redeemCode } from '../api/subscription';

const RedeemSubscription = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 自动格式化兑换码输入
  const handleCodeChange = (value: string) => {
    const clean = value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '');
    const parts = [];
    for (let i = 0; i < clean.length && i < 16; i += 4) {
      parts.push(clean.slice(i, i + 4));
    }
    setCode(parts.join('-'));
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 19) {
      setError('请输入完整的兑换码（格式：XXXX-XXXX-XXXX-XXXX）');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res: any = await redeemCode(code);
      if (res.success) {
        setSuccess(res.message);
        setTimeout(() => navigate('/dashboard'), 2000);
      } else {
        setError(res.message);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '兑换失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF8F0] to-[#FFE8D6] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md"
      >
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">📖</div>
          <h1 className="text-2xl font-bold text-gray-800">兑换单词本</h1>
          <p className="text-gray-500 mt-1">输入兑换码解锁单词本</p>
        </div>

        {/* 兑换表单 */}
        <form onSubmit={handleRedeem} className="space-y-4">
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm"
            >
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-lg text-sm"
            >
              {success}
            </motion.div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              兑换码
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-center text-lg font-mono tracking-widest focus:ring-2 focus:ring-[#FF6B35] focus:border-[#FF6B35] outline-none"
              maxLength={19}
              disabled={loading}
            />
          </div>

          <motion.button
            type="submit"
            disabled={loading || code.length !== 19}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`w-full py-3 rounded-xl font-bold text-white transition-all ${
              loading || code.length !== 19
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-gradient-to-r from-[#FF6B35] to-[#FFD23F] hover:shadow-lg'
            }`}
          >
            {loading ? '兑换中...' : '立即兑换'}
          </motion.button>
        </form>

        {/* 底部操作 */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-[#FF6B35] hover:underline text-sm"
          >
            返回首页
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default RedeemSubscription;
