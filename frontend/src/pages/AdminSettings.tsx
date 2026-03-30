import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const AdminSettings: React.FC = () => {
  const navigate = useNavigate();

  // 系统设置状态
  const [settings, setSettings] = useState({
    siteName: '英语学习助手',
    allowRegistration: true,
    requireEmailVerification: false,
    enableAI: true,
    aiProvider: 'openai',
    maxUploadSize: 10,
    sessionTimeout: 30,
    enableNotifications: true,
    enableBackup: true,
    backupInterval: 24,
  });

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // TODO: 调用后端API保存设置
    console.log('保存设置:', settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleReset = () => {
    if (confirm('确定要重置为默认设置吗?')) {
      setSettings({
        siteName: '英语学习助手',
        allowRegistration: true,
        requireEmailVerification: false,
        enableAI: true,
        aiProvider: 'openai',
        maxUploadSize: 10,
        sessionTimeout: 30,
        enableNotifications: true,
        enableBackup: true,
        backupInterval: 24,
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">⚙️ 系统设置</h1>
            <p className="text-gray-600">配置系统参数和功能选项</p>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="px-6 py-2 bg-white rounded-xl shadow-md hover:shadow-lg transition-all"
          >
            ← 返回管理中心
          </button>
        </div>

        {saved && (
          <div className="mb-6 p-4 bg-green-100 border border-green-300 text-green-800 rounded-xl flex items-center gap-2">
            <span className="text-xl">✓</span>
            <span>设置已保存!</span>
          </div>
        )}

        {/* 基本设置 */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>🏠</span> 基本设置
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                网站名称
              </label>
              <input
                type="text"
                value={settings.siteName}
                onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">允许用户注册</div>
                <div className="text-sm text-gray-500">新用户可以自行注册账号</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.allowRegistration}
                  onChange={(e) => setSettings({ ...settings, allowRegistration: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FF6B35]"></div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">邮箱验证</div>
                <div className="text-sm text-gray-500">注册时需要验证邮箱</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.requireEmailVerification}
                  onChange={(e) => setSettings({ ...settings, requireEmailVerification: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FF6B35]"></div>
              </label>
            </div>
          </div>
        </div>

        {/* AI设置 */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>🤖</span> AI功能设置
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">启用AI功能</div>
                <div className="text-sm text-gray-500">使用AI生成例句、干扰项等</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableAI}
                  onChange={(e) => setSettings({ ...settings, enableAI: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FF6B35]"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI服务提供商
              </label>
              <select
                value={settings.aiProvider}
                onChange={(e) => setSettings({ ...settings, aiProvider: e.target.value })}
                disabled={!settings.enableAI}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="openai">OpenAI (GPT-4)</option>
                <option value="claude">Anthropic (Claude)</option>
              </select>
            </div>
          </div>
        </div>

        {/* 系统参数 */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>⚡</span> 系统参数
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                最大上传文件大小 (MB)
              </label>
              <input
                type="number"
                value={settings.maxUploadSize}
                onChange={(e) => setSettings({ ...settings, maxUploadSize: parseInt(e.target.value) })}
                min="1"
                max="100"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                会话超时时间 (分钟)
              </label>
              <input
                type="number"
                value={settings.sessionTimeout}
                onChange={(e) => setSettings({ ...settings, sessionTimeout: parseInt(e.target.value) })}
                min="5"
                max="1440"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
              />
            </div>
          </div>
        </div>

        {/* 通知和备份 */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>🔔</span> 通知和备份
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">启用系统通知</div>
                <div className="text-sm text-gray-500">向用户发送学习提醒等通知</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableNotifications}
                  onChange={(e) => setSettings({ ...settings, enableNotifications: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FF6B35]"></div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">自动备份</div>
                <div className="text-sm text-gray-500">定期自动备份数据库</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableBackup}
                  onChange={(e) => setSettings({ ...settings, enableBackup: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FF6B35]"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                备份间隔 (小时)
              </label>
              <input
                type="number"
                value={settings.backupInterval}
                onChange={(e) => setSettings({ ...settings, backupInterval: parseInt(e.target.value) })}
                disabled={!settings.enableBackup}
                min="1"
                max="168"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35] disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* 系统更新 */}
        <SystemUpdatePanel />

        {/* 操作按钮 */}
        <div className="flex gap-4">
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-[#FF6B35] to-[#FFD23F] text-white rounded-xl hover:shadow-lg transition-all font-medium"
          >
            💾 保存设置
          </button>
          <button
            onClick={handleReset}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-all"
          >
            🔄 重置为默认
          </button>
        </div>
      </div>
    </div>
  );
};

// 系统更新面板
const SystemUpdatePanel: React.FC = () => {
  const [version, setVersion] = useState<any>(null);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<any>(null);

  useEffect(() => {
    api.get('/admin/system/version').then(setVersion).catch(() => {});
    // 自动检查更新
    api.get('/admin/system/check-update').then(setUpdateInfo).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateInfo(null);
    try {
      const data = await api.get('/admin/system/check-update');
      setUpdateInfo(data);
    } catch (err: any) {
      alert(err?.response?.data?.detail || '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    if (!confirm('确定要更新系统吗？更新过程中服务会短暂中断。')) return;
    setUpdating(true);
    setUpdateResult(null);
    try {
      const data = await api.post('/admin/system/update');
      setUpdateResult(data);
      if (data.success) {
        setTimeout(() => window.location.reload(), 3000);
      }
    } catch (err: any) {
      setUpdateResult({ success: false, message: err?.response?.data?.detail || '更新失败' });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
        <span>🚀</span> 系统更新
      </h2>

      {/* 当前版本 */}
      <div className="p-4 bg-gray-50 rounded-lg mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">当前版本</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-blue-600 animate-pulse">v{version?.version || '...'}</span>
              <span className="text-xs text-gray-400 font-mono">{version?.commit?.slice(0, 7) || ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {updateInfo?.has_update && !checking && (
              <span className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-sm font-medium animate-pulse">
                有新版本 v{updateInfo.remote_version}
              </span>
            )}
            <button
              onClick={handleCheckUpdate}
              disabled={checking}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition disabled:opacity-50 font-medium"
            >
              {checking ? '检查中...' : '检查更新'}
            </button>
          </div>
        </div>
      </div>

      {/* 更新信息 */}
      {updateInfo && (
        <div className={`p-4 rounded-lg mb-4 ${updateInfo.has_update ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'}`}>
          {updateInfo.has_update ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-bold text-orange-700">发现新版本!</div>
                  <div className="text-sm text-orange-600">
                    v{updateInfo.local_version} → v{updateInfo.remote_version}
                  </div>
                </div>
                <button
                  onClick={handleUpdate}
                  disabled={updating}
                  className="px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg transition disabled:opacity-50 font-bold"
                >
                  {updating ? '更新中...' : '立即更新'}
                </button>
              </div>
              {updateInfo.changelog && (
                <div className="mt-2 p-3 bg-white rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">更新内容：</div>
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap">{updateInfo.changelog}</pre>
                </div>
              )}
            </>
          ) : (
            <div className="text-green-700 font-medium">已是最新版本</div>
          )}
        </div>
      )}

      {/* 更新进度 */}
      {updating && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
            <span className="text-blue-700 font-medium">正在更新系统，请勿关闭页面...</span>
          </div>
        </div>
      )}

      {/* 更新结果 */}
      {updateResult && (
        <div className={`p-4 rounded-lg mb-4 ${updateResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className={`font-bold mb-2 ${updateResult.success ? 'text-green-700' : 'text-red-700'}`}>
            {updateResult.success ? '更新成功!' : '更新失败'}
          </div>
          <p className="text-sm text-gray-600 mb-2">{updateResult.message}</p>
          {updateResult.steps && (
            <div className="space-y-1">
              {updateResult.steps.map((step: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span>{step.success ? '✅' : '❌'}</span>
                  <span className="text-gray-700">{step.step}</span>
                </div>
              ))}
            </div>
          )}
          {updateResult.success && (
            <p className="text-sm text-green-600 mt-2">页面将在 3 秒后自动刷新...</p>
          )}
        </div>
      )}

      {/* 更新历史 */}
      {version?.update_history?.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-medium text-gray-500 mb-2">更新历史</div>
          <div className="space-y-1">
            {version.update_history.slice(-5).reverse().map((log: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-sm p-2 bg-gray-50 rounded">
                <span>{log.success ? '✅' : '❌'}</span>
                <span className="font-mono text-gray-600">{log.commit}</span>
                <span className="text-gray-400">{log.duration}</span>
                <span className="text-gray-400 ml-auto">{new Date(log.time).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSettings;
