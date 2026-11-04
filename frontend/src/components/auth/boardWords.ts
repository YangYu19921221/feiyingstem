/**
 * 登录页黑板上的「今日单词」。音标、释义取自词库(2026-11-04 生产只读导出,多义词只留一个最常用的意思)。
 * 按本地日期轮换:同一天每次打开是同一个词,第二天换下一个。
 *
 * ⚠️ 黑板上的中文用的是字体子集 public/fonts/chalk/kuaile-board.woff2,
 * 往这里加词 / 改释义 / 改 AuthShell 里黑板上的中文,要跑 backend/scripts/subset_board_font.py 重出子集,
 * 否则新字会退回系统字体(不会是方块,但和别的字不是一种笔迹)
 */
export interface BoardWord {
  word: string;
  ipa: string;
  pos: string;
  meaning: string;
}

export const BOARD_WORDS: BoardWord[] = [
  { word: 'eagle', ipa: 'ˈiːɡəl', pos: 'n.', meaning: '鹰' },
  { word: 'apple', ipa: 'ˈæpəl', pos: 'n.', meaning: '苹果' },
  { word: 'sun', ipa: 'sʌn', pos: 'n.', meaning: '太阳' },
  { word: 'friend', ipa: 'frend', pos: 'n.', meaning: '朋友' },
  { word: 'rainbow', ipa: 'ˈreɪnbəʊ', pos: 'n.', meaning: '彩虹' },
  { word: 'happy', ipa: 'ˈhæpi', pos: 'adj.', meaning: '开心的' },
  { word: 'book', ipa: 'bʊk', pos: 'n.', meaning: '书' },
  { word: 'tiger', ipa: 'ˈtaɪɡə', pos: 'n.', meaning: '老虎' },
  { word: 'cloud', ipa: 'klaʊd', pos: 'n.', meaning: '云' },
  { word: 'school', ipa: 'skuːl', pos: 'n.', meaning: '学校' },
  { word: 'panda', ipa: 'ˈpændə', pos: 'n.', meaning: '熊猫' },
  { word: 'star', ipa: 'stɑː', pos: 'n.', meaning: '星星' },
  { word: 'brave', ipa: 'breɪv', pos: 'adj.', meaning: '勇敢的' },
  { word: 'music', ipa: 'ˈmjuːzɪk', pos: 'n.', meaning: '音乐' },
  { word: 'river', ipa: 'ˈrɪvə', pos: 'n.', meaning: '河' },
  { word: 'kite', ipa: 'kaɪt', pos: 'n.', meaning: '风筝' },
  { word: 'flower', ipa: 'ˈflaʊə', pos: 'n.', meaning: '花' },
  { word: 'moon', ipa: 'muːn', pos: 'n.', meaning: '月亮' },
  { word: 'dream', ipa: 'driːm', pos: 'n.', meaning: '梦想' },
  { word: 'garden', ipa: 'ˈɡɑːdn', pos: 'n.', meaning: '花园' },
  { word: 'butterfly', ipa: 'ˈbʌtəflaɪ', pos: 'n.', meaning: '蝴蝶' },
  { word: 'ocean', ipa: 'ˈəʊʃn', pos: 'n.', meaning: '海洋' },
  { word: 'smile', ipa: 'smaɪl', pos: 'n.', meaning: '微笑' },
  { word: 'island', ipa: 'ˈaɪlənd', pos: 'n.', meaning: '岛' },
  { word: 'rocket', ipa: 'ˈrɒkɪt', pos: 'n.', meaning: '火箭' },
  { word: 'teacher', ipa: 'ˈtiːtʃə', pos: 'n.', meaning: '老师' },
  { word: 'planet', ipa: 'ˈplænɪt', pos: 'n.', meaning: '行星' },
  { word: 'dolphin', ipa: 'ˈdɒlfɪn', pos: 'n.', meaning: '海豚' },
  { word: 'bridge', ipa: 'brɪdʒ', pos: 'n.', meaning: '桥' },
  { word: 'family', ipa: 'ˈfæməli', pos: 'n.', meaning: '家庭' },
  { word: 'forest', ipa: 'ˈfɒrɪst', pos: 'n.', meaning: '森林' },
  { word: 'window', ipa: 'ˈwɪndəʊ', pos: 'n.', meaning: '窗户' },
  { word: 'snow', ipa: 'snəʊ', pos: 'n.', meaning: '雪' },
  { word: 'library', ipa: 'ˈlaɪbrəri', pos: 'n.', meaning: '图书馆' },
  { word: 'summer', ipa: 'ˈsʌmə', pos: 'n.', meaning: '夏天' },
  { word: 'winter', ipa: 'ˈwɪntə', pos: 'n.', meaning: '冬天' },
  { word: 'orange', ipa: 'ˈɒrɪndʒ', pos: 'n.', meaning: '橙子' },
  { word: 'bread', ipa: 'bred', pos: 'n.', meaning: '面包' },
];

/** 本地日期 → 第几天(2026-01-01 起算),同一天恒为同一个数 */
function dayNumber(now: Date): number {
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((local - Date.UTC(2026, 0, 1)) / 86_400_000);
}

export function wordOfDay(now: Date): BoardWord {
  const n = BOARD_WORDS.length;
  return BOARD_WORDS[((dayNumber(now) % n) + n) % n];
}

export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening';

export function dayPart(now: Date): DayPart {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 13) return 'noon';
  if (h >= 13 && h < 18) return 'afternoon';
  return 'evening';
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];

export function boardDate(now: Date) {
  return {
    weekdayEn: WEEKDAYS_EN[now.getDay()],
    zh: `${now.getMonth() + 1}月${now.getDate()}日 · 星期${WEEKDAYS_ZH[now.getDay()]}`,
    iso: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  };
}
