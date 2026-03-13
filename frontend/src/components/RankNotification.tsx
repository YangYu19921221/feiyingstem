/**
 * 排名变化通知组件 - 超越/被超越提示
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { competitionWS } from '../services/websocket';

interface Notification {
  id: string;
  type: 'overtake' | 'overtaken';
  message: string;
  data: {
    overtaker_name?: string;
    overtaken_name?: string;
    new_rank: number;
  };
}

const RankNotification: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    // 监听超越通知
    const handleOvertake = (message: any) => {
      const notification: Notification = {
        id: `overtake-${Date.now()}`,
        type: 'overtake',
        message: message.data.message,
        data: message.data
      };

      setNotifications(prev => [...prev, notification]);

      // 3秒后自动移除
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== notification.id));
      }, 3000);
    };

    // 监听被超越通知
    const handleOvertaken = (message: any) => {
      const notification: Notification = {
        id: `overtaken-${Date.now()}`,
        type: 'overtaken',
        message: message.data.message,
        data: message.data
      };

      setNotifications(prev => [...prev, notification]);

      // 3秒后自动移除
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== notification.id));
      }, 3000);
    };

    // 监听连击里程碑
    const handleComboMilestone = (message: any) => {
      const notification: Notification = {
        id: `combo-${Date.now()}`,
        type: 'overtake', // 使用相同样式
        message: message.data.message,
        data: { new_rank: 0 }
      };

      setNotifications(prev => [...prev, notification]);

      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== notification.id));
      }, 3000);
    };

    competitionWS.on('overtake', handleOvertake);
    competitionWS.on('overtaken', handleOvertaken);
    competitionWS.on('combo_milestone', handleComboMilestone);

    return () => {
      competitionWS.off('overtake', handleOvertake);
      competitionWS.off('overtaken', handleOvertaken);
      competitionWS.off('combo_milestone', handleComboMilestone);
    };
  }, []);

  return (
    <div className="fixed top-20 right-4 z-50 space-y-2 pointer-events-none">
      <AnimatePresence>
        {notifications.map((notification) => (
          <motion.div
            key={notification.id}
            initial={{ opacity: 0, x: 100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className={`rounded-lg shadow-xl p-4 max-w-sm pointer-events-auto ${
              notification.type === 'overtake'
                ? 'bg-gradient-to-r from-green-500 to-emerald-600'
                : 'bg-gradient-to-r from-orange-500 to-red-600'
            }`}
          >
            <div className="flex items-center gap-3">
              {/* 图标 */}
              <div className="text-3xl">
                {notification.type === 'overtake' ? '🎉' : '⚠️'}
              </div>

              {/* 内容 */}
              <div className="flex-1 text-white">
                <div className="font-bold text-sm mb-1">
                  {notification.type === 'overtake' ? '超越成功!' : '被超越了!'}
                </div>
                <div className="text-xs opacity-90">
                  {notification.message}
                </div>
              </div>

              {/* 排名徽章 */}
              {notification.data.new_rank > 0 && (
                <div className="bg-white bg-opacity-20 rounded-full px-3 py-1">
                  <div className="text-white font-bold text-sm">
                    #{notification.data.new_rank}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default RankNotification;
