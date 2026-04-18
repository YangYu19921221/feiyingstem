import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import FloatingElements from './FloatingElements';

interface BrandPanelProps {
  tagline: ReactNode;
  children: ReactNode;
}

/**
 * 飞鹰AI英语品牌展示面板
 * 用于登录/注册页左侧（桌面端）
 */
const BrandPanel = ({ tagline, children }: BrandPanelProps) => (
  <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-gradient-to-br from-[#1E3A5F] via-[#1E40AF] to-[#3B82F6] items-center justify-center p-12">
    {/* AI生成背景图 */}
    <img
      src="/login-hero.jpeg"
      alt=""
      className="absolute inset-0 w-full h-full object-cover opacity-40"
      style={{ mixBlendMode: 'luminosity' }}
    />
    <FloatingElements />

    <div className="absolute top-0 right-0 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
    <div className="absolute bottom-0 left-0 w-80 h-80 bg-cyan-400/15 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

    <div className="relative z-10 text-center max-w-md">
      <motion.div
        initial={{ scale: 0, y: -30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 10 }}
        className="mb-8"
      >
        <div className="w-32 h-32 mx-auto relative">
          <div className="absolute inset-0 bg-white/10 rounded-full blur-xl" />
          <div className="relative w-full h-full flex items-center justify-center">
            <span className="text-8xl" style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))' }}>🦅</span>
          </div>
        </div>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-4xl font-bold text-white mb-2 tracking-wider"
      >
        飞鹰AI英语
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="text-blue-200 text-lg tracking-widest mb-8"
      >
        FLYING EAGLE ENGLISH
      </motion.p>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="w-16 h-0.5 bg-gradient-to-r from-transparent via-blue-300 to-transparent mx-auto mb-8"
      />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-blue-100/80 text-lg leading-relaxed mb-10"
      >
        {tagline}
      </motion.p>

      {children}
    </div>
  </div>
);

/** 移动端品牌头部 */
export const MobileBrandHeader = () => (
  <div className="lg:hidden text-center mb-6">
    <div className="flex items-center justify-center gap-3 mb-2">
      <span className="text-4xl">🦅</span>
      <div className="text-left">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">飞鹰AI英语</h1>
        <p className="text-xs text-blue-400 tracking-widest">FLYING EAGLE ENGLISH</p>
      </div>
    </div>
  </div>
);

export default BrandPanel;
