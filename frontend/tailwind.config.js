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
      },
      perspective: {
        '1000': '1000px',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s infinite',
      },
    },
  },
  plugins: [],
}
