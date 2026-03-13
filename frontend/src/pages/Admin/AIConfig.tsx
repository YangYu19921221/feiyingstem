import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../../config/env';

interface AIProvider {
  id: number;
  provider_name: string;
  display_name: string;
  api_key: string;
  base_url: string;
  model_name: string;
  tts_enabled: boolean;
  tts_model: string | null;
  tts_voice: string | null;
  enabled: boolean;
  is_default: boolean;
  extra_config: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

const AI配置管理 = () => {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [cardTesting, setCardTesting] = useState<number | null>(null);
  const [cardTestResult, setCardTestResult] = useState<Record<number, string>>({});

  // 获取token的辅助函数
  const getToken = () => {
    return localStorage.getItem('access_token') || localStorage.getItem('token');
  };

  // 处理401错误
  const handle401 = () => {
    alert('登录已过期,请重新登录');
    localStorage.removeItem('access_token');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // 表单状态
  const [formData, setFormData] = useState({
    provider_name: '',
    display_name: '',
    api_key: '',
    base_url: '',
    model_name: '',
    tts_enabled: false,
    tts_model: '',
    tts_voice: '',
    enabled: true,
    is_default: false,
    iflytek_app_id: '',
    iflytek_api_secret: '',
  });

  // 加载AI提供商列表
  const loadProviders = async () => {
    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }
      const response = await axios.get(`${API_BASE_URL}/admin/ai/providers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProviders(response.data);
    } catch (error: any) {
      console.error('加载AI配置失败:', error);
      if (error.response?.status === 401) {
        handle401();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  // 测试已保存的配置（用数据库真实密钥）
  const handleCardTest = async (provider: AIProvider) => {
    setCardTesting(provider.id);
    setCardTestResult((prev) => ({ ...prev, [provider.id]: '🧪 测试中...' }));
    try {
      const token = getToken();
      if (!token) { handle401(); return; }
      const response = await axios.post(
        `${API_BASE_URL}/admin/ai/providers/${provider.id}/test`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.data.success) {
        setCardTestResult((prev) => ({
          ...prev,
          [provider.id]: `✅ 连接成功! 响应时间: ${response.data.response_time}秒\n回复: ${response.data.test_output}`,
        }));
      } else {
        setCardTestResult((prev) => ({
          ...prev,
          [provider.id]: `❌ ${response.data.message}`,
        }));
      }
    } catch (error: any) {
      if (error.response?.status === 401) { handle401(); }
      else {
        setCardTestResult((prev) => ({
          ...prev,
          [provider.id]: `❌ 测试失败: ${error.response?.data?.detail || error.message}`,
        }));
      }
    } finally {
      setCardTesting(null);
    }
  };

  // 测试连接（弹窗内，用表单填写的密钥）
  const handleTest = async (provider?: AIProvider) => {
    setTesting(true);
    setTestResult(null);

    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }
      const testData = provider || formData;

      const response = await axios.post(
        `${API_BASE_URL}/admin/ai/providers/test`,
        {
          provider_name: testData.provider_name,
          api_key: testData.api_key,
          base_url: testData.base_url,
          model_name: testData.model_name,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setTestResult(`✅ 连接成功! 响应时间: ${response.data.response_time}秒\n回复: ${response.data.test_output}`);
      } else {
        setTestResult(`❌ ${response.data.message}`);
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        handle401();
      } else {
        setTestResult(`❌ 测试失败: ${error.response?.data?.detail || error.message}`);
      }
    } finally {
      setTesting(false);
    }
  };

  // 保存配置
  const handleSave = async () => {
    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }

      let saveData: any = { ...formData };

      // 讯飞ISE特殊处理
      if (formData.provider_name === 'iflytek_ise') {
        saveData.display_name = saveData.display_name || '讯飞语音评测';
        saveData.base_url = 'wss://ise-api.xfyun.cn/v2/open-ise';
        saveData.tts_enabled = false;
        saveData.model_name = saveData.model_name || 'ise';
        saveData.extra_config = {
          app_id: formData.iflytek_app_id,
          api_secret: formData.iflytek_api_secret,
        };
      }

      // 移除前端专用字段
      delete saveData.iflytek_app_id;
      delete saveData.iflytek_api_secret;

      if (editingProvider) {
        // 更新
        await axios.put(
          `${API_BASE_URL}/admin/ai/providers/${editingProvider.id}`,
          saveData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } else {
        // 创建
        await axios.post(
          `${API_BASE_URL}/admin/ai/providers`,
          saveData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      setShowAddModal(false);
      setEditingProvider(null);
      loadProviders();
      alert('保存成功!');
    } catch (error: any) {
      if (error.response?.status === 401) {
        handle401();
      } else {
        alert(`保存失败: ${error.response?.data?.detail || error.message}`);
      }
    }
  };

  // 删除配置
  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此配置吗?')) return;

    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }
      await axios.delete(`${API_BASE_URL}/admin/ai/providers/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadProviders();
    } catch (error: any) {
      if (error.response?.status === 401) {
        handle401();
      } else {
        alert(`删除失败: ${error.response?.data?.detail || error.message}`);
      }
    }
  };

  // 打开编辑对话框
  const handleEdit = (provider: AIProvider) => {
    setEditingProvider(provider);
    setFormData({
      provider_name: provider.provider_name,
      display_name: provider.display_name,
      api_key: '', // 编辑时不显示原密钥
      base_url: provider.base_url,
      model_name: provider.model_name,
      tts_enabled: provider.tts_enabled,
      tts_model: provider.tts_model || '',
      tts_voice: provider.tts_voice || '',
      enabled: provider.enabled,
      is_default: provider.is_default,
      iflytek_app_id: provider.extra_config?.app_id || '',
      iflytek_api_secret: provider.extra_config?.api_secret || '',
    });
    setShowAddModal(true);
  };

  // 新增配置
  const handleAdd = () => {
    setEditingProvider(null);
    setFormData({
      provider_name: '',
      display_name: '',
      api_key: '',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model_name: 'qwen3-max',
      tts_enabled: true,
      tts_model: 'cosyvoice-v2',
      tts_voice: 'longwan_v2', // 默认英语女声
      enabled: true,
      is_default: false,
      iflytek_app_id: '',
      iflytek_api_secret: '',
    });
    setTestResult(null);
    setShowAddModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF8F0] to-[#FFE8D6] p-8">
      <div className="max-w-6xl mx-auto">
        {/* 标题和操作按钮 */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/admin')}
              className="px-4 py-2 bg-white/80 backdrop-blur-md text-gray-700 rounded-xl font-semibold shadow-md hover:shadow-lg transition-all border border-gray-200 flex items-center gap-2"
            >
              ← 返回管理后台
            </motion.button>
            <motion.h1
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-4xl font-bold bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent"
            >
              🤖 AI配置管理
            </motion.h1>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleAdd}
            className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all"
          >
            ➕ 添加AI服务
          </motion.button>
        </div>

        {/* 配置卡片列表 */}
        <div className="grid gap-6">
          {providers.map((provider, index) => (
            <motion.div
              key={provider.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white/90 backdrop-blur-md rounded-2xl p-6 shadow-xl border border-white/50"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-4 mb-4">
                    <h3 className="text-2xl font-bold text-gray-800">
                      {provider.display_name}
                    </h3>
                    {provider.is_default && (
                      <span className="px-3 py-1 bg-accent text-white rounded-full text-sm font-bold">
                        默认
                      </span>
                    )}
                    {provider.enabled ? (
                      <span className="px-3 py-1 bg-success text-white rounded-full text-sm">
                        ✓ 已启用
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-gray-400 text-white rounded-full text-sm">
                        ✗ 已禁用
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                    <div>
                      <span className="font-semibold">🔧 服务商:</span> {provider.provider_name}
                    </div>
                    <div>
                      <span className="font-semibold">🤖 模型:</span> {provider.model_name}
                    </div>
                    <div>
                      <span className="font-semibold">🔑 API Key:</span> {provider.api_key}
                    </div>
                    <div>
                      <span className="font-semibold">🌐 BaseURL:</span> {provider.base_url}
                    </div>
                    {provider.tts_enabled && (
                      <>
                        <div>
                          <span className="font-semibold">🎤 TTS模型:</span> {provider.tts_model}
                        </div>
                        <div>
                          <span className="font-semibold">🔊 音色:</span> {provider.tts_voice}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleCardTest(provider)}
                    disabled={cardTesting === provider.id}
                    className="px-4 py-2 bg-accent text-white rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50"
                  >
                    {cardTesting === provider.id ? '🧪 测试中...' : '🧪 测试'}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleEdit(provider)}
                    className="px-4 py-2 bg-secondary text-white rounded-lg font-semibold hover:shadow-lg transition-all"
                  >
                    ✏️ 编辑
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleDelete(provider.id)}
                    className="px-4 py-2 bg-error text-white rounded-lg font-semibold hover:shadow-lg transition-all"
                  >
                    🗑️
                  </motion.button>
                </div>
                {cardTestResult[provider.id] && (
                  <div className={`mt-3 p-3 rounded-lg text-sm whitespace-pre-wrap ${
                    cardTestResult[provider.id].startsWith('✅')
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : cardTestResult[provider.id].startsWith('🧪')
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {cardTestResult[provider.id]}
                  </div>
                )}
              </div>
            </motion.div>
          ))}

          {providers.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p className="text-xl">还没有配置AI服务</p>
              <p className="mt-2">点击"添加AI服务"开始配置</p>
            </div>
          )}
        </div>
      </div>

      {/* 添加/编辑对话框 */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <h2 className="text-3xl font-bold mb-6 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                {editingProvider ? '✏️ 编辑AI服务' : '➕ 添加AI服务'}
              </h2>

              <div className="space-y-4">
                {/* 服务商选择 */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    服务商 *
                  </label>
                  <select
                    value={formData.provider_name}
                    onChange={(e) => setFormData({ ...formData, provider_name: e.target.value })}
                    disabled={!!editingProvider}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">请选择</option>
                    <option value="qwen">通义千问 (Qwen)</option>
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude</option>
                    <option value="iflytek_ise">讯飞语音评测 (iFlytek ISE)</option>
                  </select>
                </div>

                {/* 显示名称 */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    显示名称 *
                  </label>
                  <input
                    type="text"
                    value={formData.display_name}
                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                    placeholder="如: 通义千问 Qwen-Max"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    {formData.provider_name === 'iflytek_ise' ? 'APIKey *' : 'API Key *'} {editingProvider && '(留空表示不修改)'}
                  </label>
                  <input
                    type="password"
                    value={formData.api_key}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder={formData.provider_name === 'iflytek_ise' ? '讯飞APIKey' : 'sk-...'}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary font-mono"
                  />
                </div>

                {/* 讯飞ISE专用字段 */}
                {formData.provider_name === 'iflytek_ise' && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        APPID *
                      </label>
                      <input
                        type="text"
                        value={formData.iflytek_app_id}
                        onChange={(e) => setFormData({ ...formData, iflytek_app_id: e.target.value })}
                        placeholder="如: 8ef38b6c"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        APISecret * {editingProvider && '(留空表示不修改)'}
                      </label>
                      <input
                        type="password"
                        value={formData.iflytek_api_secret}
                        onChange={(e) => setFormData({ ...formData, iflytek_api_secret: e.target.value })}
                        placeholder="讯飞APISecret"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary font-mono"
                      />
                    </div>
                  </>
                )}

                {/* Base URL - 讯飞ISE不显示 */}
                {formData.provider_name !== 'iflytek_ise' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={formData.base_url}
                    onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                    placeholder="https://..."
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>
                )}

                {/* 模型名称 - 讯飞ISE不显示 */}
                {formData.provider_name !== 'iflytek_ise' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    模型名称 *
                  </label>
                  <input
                    type="text"
                    value={formData.model_name}
                    onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
                    placeholder="qwen-max / gpt-4 / claude-3-sonnet"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>
                )}

                {/* TTS开关 - 讯飞ISE不显示 */}
                {formData.provider_name !== 'iflytek_ise' && (
                <>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="tts_enabled"
                    checked={formData.tts_enabled}
                    onChange={(e) => setFormData({ ...formData, tts_enabled: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <label htmlFor="tts_enabled" className="font-semibold text-gray-700">
                    启用语音合成 (TTS)
                  </label>
                </div>

                {/* TTS配置 */}
                {formData.tts_enabled && (
                  <div className="space-y-4 pl-8">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        TTS模型
                      </label>
                      <select
                        value={formData.tts_model}
                        onChange={(e) => setFormData({ ...formData, tts_model: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary"
                      >
                        <option value="cosyvoice-v1">CosyVoice V1 (基础版)</option>
                        <option value="cosyvoice-v2">CosyVoice V2 (增强版)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        音色选择
                      </label>
                      <select
                        value={formData.tts_voice}
                        onChange={(e) => setFormData({ ...formData, tts_voice: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-primary"
                      >
                        <optgroup label="🇬🇧 英语女声 (推荐)">
                          <option value="longwan_v2">Wan 婉 - 英语女声 (温柔)</option>
                          <option value="longyue_v2">Yue 悦 - 英语女声 (活泼)</option>
                          <option value="longxiaobai_v2">Bai 白 - 英语女声 (清晰)</option>
                        </optgroup>
                        <optgroup label="🇨🇳 中英双语女声">
                          <option value="longxiaochun_v2">龙小淳 - 双语女声 (甜美)</option>
                          <option value="longxiaoxia_v2">龙小夏 - 双语女声 (知性)</option>
                        </optgroup>
                        <optgroup label="🇨🇳 中文男声">
                          <option value="longlaotie_v2">龙老铁 - 中文男声 (东北味)</option>
                        </optgroup>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        💡 人教版英语建议选择英语女声 (Wan/Yue/Bai)，发音更标准
                      </p>
                    </div>
                  </div>
                )}
                </>
                )}

                {/* 功能开关 */}
                <div className="flex gap-6 items-center">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="enabled"
                      checked={formData.enabled}
                      onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                      className="w-5 h-5"
                    />
                    <label htmlFor="enabled" className="font-semibold text-gray-700">
                      启用此服务
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_default"
                      checked={formData.is_default}
                      onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                      className="w-5 h-5"
                    />
                    <label htmlFor="is_default" className="font-semibold text-gray-700">
                      设为默认服务
                    </label>
                  </div>
                </div>

                {/* 测试结果 */}
                {testResult && (
                  <div className={`p-4 rounded-xl ${testResult.startsWith('✅') ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                    <pre className="whitespace-pre-wrap text-sm">{testResult}</pre>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-4 mt-6">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTest()}
                    disabled={testing || !formData.api_key || !formData.model_name}
                    className="flex-1 px-6 py-3 bg-accent text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? '🧪 测试中...' : '🧪 测试连接'}
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSave}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all"
                  >
                    💾 保存配置
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowAddModal(false)}
                    className="px-6 py-3 bg-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-400 transition-all"
                  >
                    取消
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AI配置管理;
