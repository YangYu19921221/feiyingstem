import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getSubscriptionStatus, redeemCode } from '../api/subscription';

const RedeemSubscription = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subStatus, setSubStatus] = useState<{
    has_subscription: boolean;
    subscription_expires_at?: string;
    is_expired: boolean;
    days_remaining: number;
  } | null>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res: any = await getSubscriptionStatus();
      setSubStatus(res);
    } catch {
      // 忽略错误
    }
  };

  // 自动格式化兑换码输入
  const handleCodeChange = (value: string) => {
    // 只保留有效字符
    const clean = value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '');
    // 每4个字符加一个横杠
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
        // 更新本地存储的用户信息
        const userStr = localStorage.getItem('user');
        if (userStr) {
          const user = JSON.parse(userStr);
          user.subscription_expires_at = res.subscription_expires_at;
          localStorage.setItem('user', JSON.stringify(user));
        }
        await fetchStatus();
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

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF8F0] to-[#FFE8D6] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md"
      >
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold text-gray-800">订阅兑换</h1>
          <p className="text-gray-500 mt-1">输入兑换码激活订阅</p>
        </div>

        {/* 订阅状态 */}
        {subStatus && (
          <div className={`rounded-xl p-4 mb-6 ${
            subStatus.is_expired || !subStatus.has_subscription
              ? 'bg-red-50 border border-red-200'
              : 'bg-green-50 border border-green-200'
          }`}>
            {subStatus.is_expired || !subStatus.has_subscription ? (
              <div className="flex items-center gap-2 text-red-600">
                <span>⚠️</span>
                <span className="font-medium">
                  {subStatus.has_subscription ? '订阅已过期' : '暂无订阅'}
                </span>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-green-600">
                  <span>✅</span>
                  <span className="font-medium">订阅有效</span>
                </div>
                <p className="text-sm text-green-500 mt-1">
                  到期时间：{new Date(subStatus.subscription_expires_at!).toLocaleDateString('zh-CN')}
                  （剩余 {subStatus.days_remaining} 天）
                </p>
              </div>
            )}
          </div>
        )}

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
        <div className="mt-6 flex justify-between items-center text-sm">
          {subStatus && !subStatus.is_expired && subStatus.has_subscription && (
            <button
              onClick={() => navigate('/dashboard')}
              className="text-[#FF6B35] hover:underline"
            >
              返回首页
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-gray-600 ml-auto"
          >
            退出登录
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default RedeemSubscription;
