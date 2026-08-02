/**
 * 排名变化通知组件 - 超越/被超越提示
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowUp, Flame, RefreshCw } from 'lucide-react';
import { competitionWS } from '../services/websocket';

interface Notification {
  id: string;
  type: 'overtake' | 'overtaken' | 'combo';
  message: string;
  data: {
    overtaker_name?: string;
    overtaken_name?: string;
    new_rank: number;
  };
}

interface NotificationMessage {
  data: Notification['data'] & { message: string };
}

const RankNotification: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const timers: number[] = [];
    const addNotification = (notification: Notification) => {
      setNotifications((current) => [...current.slice(-2), notification]);
      timers.push(window.setTimeout(() => {
        setNotifications((current) => current.filter((item) => item.id !== notification.id));
      }, 3000));
    };

    // 监听超越通知
    const handleOvertake = (message: NotificationMessage) => {
      const notification: Notification = {
        id: `overtake-${Date.now()}`,
        type: 'overtake',
        message: message.data.message,
        data: message.data
      };

      addNotification(notification);
    };

    // 监听被超越通知
    const handleOvertaken = (message: NotificationMessage) => {
      const notification: Notification = {
        id: `overtaken-${Date.now()}`,
        type: 'overtaken',
        message: message.data.message,
        data: message.data
      };

      addNotification(notification);
    };

    // 监听连击里程碑
    const handleComboMilestone = (message: NotificationMessage) => {
      const notification: Notification = {
        id: `combo-${Date.now()}`,
        type: 'combo',
        message: message.data.message,
        data: { new_rank: 0 }
      };

      addNotification(notification);
    };

    competitionWS.on('overtake', handleOvertake);
    competitionWS.on('overtaken', handleOvertaken);
    competitionWS.on('combo_milestone', handleComboMilestone);

    return () => {
      competitionWS.off('overtake', handleOvertake);
      competitionWS.off('overtaken', handleOvertaken);
      competitionWS.off('combo_milestone', handleComboMilestone);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-3 top-20 z-50 space-y-2 sm:left-auto sm:right-4 sm:w-80" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {notifications.map((notification) => (
          <motion.div
            key={notification.id}
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto rounded-xl border border-orange-100 bg-white p-3 shadow-lg"
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                notification.type === 'overtake'
                  ? 'bg-emerald-50 text-emerald-600'
                  : notification.type === 'combo'
                    ? 'bg-orange-50 text-accent-warm'
                    : 'bg-slate-100 text-ink-soft'
              }`}>
                {notification.type === 'overtake'
                  ? <ArrowUp className="h-5 w-5" aria-hidden="true" />
                  : notification.type === 'combo'
                    ? <Flame className="h-5 w-5" aria-hidden="true" />
                    : <RefreshCw className="h-5 w-5" aria-hidden="true" />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-sm font-semibold text-ink">
                  {notification.type === 'overtake' ? '排名上升' : notification.type === 'combo' ? '连击达成' : '排名有变化'}
                </div>
                <div className="truncate text-xs text-ink-mute">
                  {notification.message}
                </div>
              </div>

              {/* 排名徽章 */}
              {notification.data.new_rank > 0 && (
                <div className="rounded-lg bg-orange-50 px-2.5 py-1">
                  <div className="font-numeric text-sm font-semibold text-accent-warm">
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
