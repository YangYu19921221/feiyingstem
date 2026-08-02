/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#FF6B35',      // 活力橙
        secondary: '#FFD23F',    // 阳光黄
        accent: '#00D9FF',       // 天空蓝
        success: '#5FD35F',      // 草绿
        error: '#FF5757',        // 珊瑚红
        // 学生端设计 token(与 index.css 手写工具类同值)。注册进主题后
        // bg-ink-soft / bg-ink/95 / from-accent-warm 等全部变体才会真实生成——
        // 之前只有手写的 .text-ink-* 存在,bg-ink-soft 这类是空类(透明),
        // 已完成单元的进度条"显示100%但条是空的"即此因
        ink: { DEFAULT: '#293545', soft: '#5f6b7a', mute: '#687383' },
        'accent-warm': '#bd5227',
        paper: '#f5f8fc',
      },
      perspective: {
        '1000': '1000px',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s infinite',
        'slide-in': 'slide-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
