import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface Statistics {
  total_users: number;
  total_words: number;
  total_books: number;
  total_units: number;
  active_users_today: number;
  active_users_week: number;
  learning_records_today: number;
  learning_records_week: number;
}

const AdminStatistics: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStatistics();
  }, []);

  const loadStatistics = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('加载统计数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-teal-50 to-cyan-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">📊 数据统计</h1>
            <p className="text-gray-600">系统使用情况与数据分析</p>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="px-6 py-2 bg-white rounded-xl shadow-md hover:shadow-lg transition-all"
          >
            ← 返回管理中心
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">⏳</div>
            <p className="text-gray-600">加载中...</p>
          </div>
        ) : !stats ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">❌</div>
            <p className="text-gray-600">加载统计数据失败</p>
          </div>
        ) : (
          <>
            {/* 核心指标 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-white rounded-2xl shadow-md p-6 border-l-4 border-blue-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-3xl">👥</div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-gray-800">{stats?.total_users}</div>
                    <div className="text-sm text-gray-500">总用户数</div>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  今日活跃: {stats?.active_users_today} 人
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-md p-6 border-l-4 border-purple-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-3xl">📚</div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-gray-800">{stats?.total_words}</div>
                    <div className="text-sm text-gray-500">总单词数</div>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  单词本: {stats?.total_books} 个
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-md p-6 border-l-4 border-orange-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-3xl">🔥</div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-gray-800">{stats?.active_users_today}</div>
                    <div className="text-sm text-gray-500">今日活跃</div>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  本周活跃: {stats?.active_users_week} 人
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-md p-6 border-l-4 border-green-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-3xl">📈</div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-gray-800">{stats?.learning_records_week}</div>
                    <div className="text-sm text-gray-500">本周学习次数</div>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  今日: {stats?.learning_records_today} 次
                </div>
              </div>
            </div>

            {/* 详细统计 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* 用户统计 */}
              <div className="bg-white rounded-2xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span>👥</span> 用户统计
                </h2>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                    <span className="text-gray-700">总用户数</span>
                    <span className="text-xl font-bold text-blue-600">{stats?.total_users}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                    <span className="text-gray-700">今日活跃用户</span>
                    <span className="text-xl font-bold text-green-600">{stats?.active_users_today}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-teal-50 rounded-lg">
                    <span className="text-gray-700">本周活跃用户</span>
                    <span className="text-xl font-bold text-teal-600">{stats?.active_users_week}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
                    <span className="text-gray-700">活跃率</span>
                    <span className="text-xl font-bold text-purple-600">
                      {((stats?.active_users_today! / stats?.total_users!) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* 内容统计 */}
              <div className="bg-white rounded-2xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span>📚</span> 内容统计
                </h2>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
                    <span className="text-gray-700">总单词数</span>
                    <span className="text-xl font-bold text-purple-600">{stats?.total_words}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-pink-50 rounded-lg">
                    <span className="text-gray-700">单词本数量</span>
                    <span className="text-xl font-bold text-pink-600">{stats?.total_books}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                    <span className="text-gray-700">单元数量</span>
                    <span className="text-xl font-bold text-orange-600">{stats?.total_units}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                    <span className="text-gray-700">平均每本单词数</span>
                    <span className="text-xl font-bold text-yellow-600">
                      {Math.round(stats?.total_words! / stats?.total_books!)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 学习统计 */}
            <div className="bg-white rounded-2xl shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span>📈</span> 学习活动统计
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-xl">
                  <div className="text-sm text-gray-600 mb-1">今日学习次数</div>
                  <div className="text-2xl font-bold text-green-700">{stats?.learning_records_today}</div>
                </div>
                <div className="p-4 bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl">
                  <div className="text-sm text-gray-600 mb-1">本周学习次数</div>
                  <div className="text-2xl font-bold text-teal-700">{stats?.learning_records_week}</div>
                </div>
                <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl">
                  <div className="text-sm text-gray-600 mb-1">日均学习次数</div>
                  <div className="text-2xl font-bold text-blue-700">
                    {Math.round(stats?.learning_records_week! / 7)}
                  </div>
                </div>
                <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl">
                  <div className="text-sm text-gray-600 mb-1">人均学习次数</div>
                  <div className="text-2xl font-bold text-purple-700">
                    {(stats?.learning_records_week! / stats?.active_users_week!).toFixed(1)}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminStatistics;
