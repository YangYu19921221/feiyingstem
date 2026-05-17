import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AlertCircle, X } from 'lucide-react';

interface Props {
  message: string;
  /** 业务错误码，用来决定附加跳转链接 */
  code?: string | null;
  /** 当前页面是 'login' / 'register' / 'parent-login' / 'parent-register'，
   *  组件按场景给出建议链接（去注册 / 忘记密码 等） */
  context?: 'login' | 'register' | 'parent-login' | 'parent-register';
  onDismiss?: () => void;
}

/**
 * 登录 / 注册场景的错误提示条。
 * - 红色背景 + AlertCircle 图标，比纯红字更显眼
 * - 入场带 0.4s 抖动，触发"输错了"的下意识反馈
 * - 根据 code 给"去注册 / 忘记密码 / 已禁用"等建议链接
 */
export default function FormError({ message, code, context, onDismiss }: Props) {
  if (!message) return null;

  const action = pickAction(code, context);

  return (
    <AnimatePresence>
      <motion.div
        key={`${code ?? ''}-${message}`}
        initial={{ opacity: 0, y: -8, x: 0 }}
        animate={{
          opacity: 1,
          y: 0,
          x: [0, -8, 8, -6, 6, -3, 3, 0],
        }}
        exit={{ opacity: 0, y: -8 }}
        transition={{
          opacity: { duration: 0.2 },
          y: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
          x: { duration: 0.45, times: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] },
        }}
        role="alert"
        className="rounded-xl px-4 py-3 flex items-start gap-3 text-sm"
        style={{
          background: '#FEE2E2',
          border: '1px solid #FCA5A5',
          color: '#991B1B',
        }}
      >
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-relaxed break-words">{message}</p>
          {action && (
            <div className="mt-1.5">
              {action.to ? (
                <Link
                  to={action.to}
                  className="text-xs font-medium underline-offset-2 hover:underline"
                  style={{ color: 'oklch(0.55 0.18 25)' }}
                >
                  {action.label} →
                </Link>
              ) : (
                <span className="text-xs opacity-80">{action.label}</span>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-0.5 hover:opacity-60 transition"
            aria-label="关闭提示"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function pickAction(
  code: string | null | undefined,
  context: Props['context']
): { label: string; to?: string } | null {
  if (!code) return null;

  if (context === 'login') {
    if (code === 'user_not_found') return { label: '没有账号？去注册', to: '/register' };
    if (code === 'wrong_password') return { label: '忘记密码？', to: '/forgot-password' };
    if (code === 'inactive')      return { label: '账号已被管理员禁用，请联系老师' };
  }

  if (context === 'parent-login') {
    if (code === 'user_not_found') return { label: '没有账号？去注册', to: '/parent/register' };
    if (code === 'wrong_password') return { label: '忘记密码？请孩子重新生成绑定码后重置' };
    if (code === 'inactive')      return { label: '账号已被禁用' };
  }

  if (context === 'register' || context === 'parent-register') {
    if (code === 'username_taken' || code === 'phone_taken') {
      return {
        label: '已经有账号了？去登录',
        to: context === 'parent-register' ? '/parent/login' : '/login',
      };
    }
  }

  return null;
}
