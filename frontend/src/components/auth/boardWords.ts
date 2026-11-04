/**
 * 登录页「今日单词」+ 日期工具。音标、释义取自词库(2026-11-04 生产只读导出,多义词只留一个最常用的意思)。
 * 一周七个场景各有一组和场景有关的词(周三太空就是 star / planet …),同一个星期几每周轮到下一个词。
 *
 * ⚠️ 黑板上的中文用的是字体子集 public/fonts/chalk/kuaile-board.woff2,
 * 往这里加词 / 改释义 / 改 loginScenes.ts、AuthShell 里的中文,要跑 backend/scripts/subset_board_font.py 重出子集,
 * 否则新字会退回系统字体(不会是方块,但和别的字不是一种笔迹)。
 * 音标只用得到 public/fonts/chalk/board-ipa.woff2 里有的符号(U+0250-02FF + 拉丁字母),θ ð 没有,带这两个音的词别放进来
 */
import type { SceneId } from './loginScenes';

export interface BoardWord {
  word: string;
  ipa: string;
  pos: string;
  meaning: string;
}

const w = (word: string, ipa: string, pos: string, meaning: string): BoardWord => ({ word, ipa, pos, meaning });

export const WEEK_WORDS: Record<SceneId, BoardWord[]> = {
  mon: [
    w('school', 'skuːl', 'n.', '学校'), w('eagle', 'ˈiːɡəl', 'n.', '鹰'), w('teacher', 'ˈtiːtʃə', 'n.', '老师'),
    w('desk', 'desk', 'n.', '书桌'), w('class', 'klɑːs', 'n.', '班级'), w('student', 'ˈstjuːdənt', 'n.', '学生'),
    w('ruler', 'ˈruːlə', 'n.', '尺子'), w('blackboard', 'ˈblækbɔːd', 'n.', '黑板'), w('eraser', 'ɪˈreɪzə', 'n.', '橡皮'),
    w('friend', 'frend', 'n.', '朋友'),
  ],
  tue: [
    w('pencil', 'ˈpensəl', 'n.', '铅笔'), w('write', 'raɪt', 'v.', '写'), w('notebook', 'ˈnəʊtbʊk', 'n.', '笔记本'),
    w('paper', 'ˈpeɪpə', 'n.', '纸'), w('crayon', 'ˈkreɪɒn', 'n.', '蜡笔'), w('word', 'wɜːd', 'n.', '单词'),
    w('pen', 'pen', 'n.', '钢笔'), w('draw', 'drɔː', 'v.', '画画'), w('letter', 'ˈletə', 'n.', '字母；信'),
  ],
  wed: [
    w('star', 'stɑː', 'n.', '星星'), w('planet', 'ˈplænɪt', 'n.', '行星'), w('rocket', 'ˈrɒkɪt', 'n.', '火箭'),
    w('moon', 'muːn', 'n.', '月亮'), w('space', 'speɪs', 'n.', '太空'), w('astronaut', 'ˈæstrənɔːt', 'n.', '宇航员'),
    w('comet', 'ˈkɒmɪt', 'n.', '彗星'), w('sun', 'sʌn', 'n.', '太阳'), w('sky', 'skaɪ', 'n.', '天空'),
  ],
  thu: [
    w('ocean', 'ˈəʊʃn', 'n.', '海洋'), w('dolphin', 'ˈdɒlfɪn', 'n.', '海豚'), w('fish', 'fɪʃ', 'n.', '鱼'),
    w('whale', 'weɪl', 'n.', '鲸'), w('shell', 'ʃel', 'n.', '贝壳'), w('sea', 'siː', 'n.', '大海'),
    w('crab', 'kræb', 'n.', '螃蟹'), w('turtle', 'ˈtɜːtl', 'n.', '海龟'), w('octopus', 'ˈɒktəpəs', 'n.', '章鱼'),
    w('wave', 'weɪv', 'n.', '波浪'),
  ],
  fri: [
    w('kite', 'kaɪt', 'n.', '风筝'), w('cloud', 'klaʊd', 'n.', '云'), w('rainbow', 'ˈreɪnbəʊ', 'n.', '彩虹'),
    w('fly', 'flaɪ', 'v.', '飞'), w('wind', 'wɪnd', 'n.', '风'), w('balloon', 'bəˈluːn', 'n.', '气球'),
    w('bird', 'bɜːd', 'n.', '鸟'), w('jump', 'dʒʌmp', 'v.', '跳'), w('happy', 'ˈhæpi', 'adj.', '开心的'),
  ],
  sat: [
    w('flower', 'ˈflaʊə', 'n.', '花'), w('garden', 'ˈɡɑːdn', 'n.', '花园'), w('butterfly', 'ˈbʌtəflaɪ', 'n.', '蝴蝶'),
    w('bee', 'biː', 'n.', '蜜蜂'), w('tree', 'triː', 'n.', '树'), w('grass', 'ɡrɑːs', 'n.', '草'),
    w('leaf', 'liːf', 'n.', '叶子'), w('rose', 'rəʊz', 'n.', '玫瑰'), w('sunny', 'ˈsʌni', 'adj.', '阳光充足的'),
    w('water', 'ˈwɔːtə', 'n.', '水'),
  ],
  sun: [
    w('book', 'bʊk', 'n.', '书'), w('story', 'ˈstɔːri', 'n.', '故事'), w('dream', 'driːm', 'n.', '梦想'),
    w('read', 'riːd', 'v.', '阅读'), w('night', 'naɪt', 'n.', '夜晚'), w('lamp', 'læmp', 'n.', '台灯'),
    w('library', 'ˈlaɪbrəri', 'n.', '图书馆'), w('sleep', 'sliːp', 'v.', '睡觉'), w('quiet', 'ˈkwaɪət', 'adj.', '安静的'),
  ],
};

/** 本地日期 → 第几天(2026-01-01 起算),同一天恒为同一个数 */
export function dayNumber(now: Date): number {
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((local - Date.UTC(2026, 0, 1)) / 86_400_000);
}

/** 这个场景今天(或这周)轮到的词: 同一个星期几,每过一周换下一个 */
export function wordForScene(id: SceneId, now: Date): BoardWord {
  const list = WEEK_WORDS[id];
  const week = Math.floor(dayNumber(now) / 7);
  return list[((week % list.length) + list.length) % list.length];
}

export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening';

export function dayPart(now: Date): DayPart {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 13) return 'noon';
  if (h >= 13 && h < 18) return 'afternoon';
  return 'evening';
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];

export function boardDate(now: Date) {
  return {
    zh: `${now.getMonth() + 1}月${now.getDate()}日 · 星期${WEEKDAYS_ZH[now.getDay()]}`,
    iso: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  };
}
