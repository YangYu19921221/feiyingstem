"""音标视频的「讲师」名字 —— 归一与消歧的唯一真源

讲师是**自由文本**(上传时老师自己敲),不是系统里的教师账号:实际讲课的常是
外聘老师、助教,他们没有账号,而有账号的老师也不一定是视频里讲课的那个人。
代价就是同一个人可能被敲成好几种写法,而学生端是**按这个字符串分组**的 ——
「王老师」「王老师 」「王 老师」「wang老师」会在学生眼里变成四位老师。

所以归一规则必须只有一份(照 phonetic_tokenize.py 的先例:在两处各写一份
归一规则 = 学生那边的死数据)。两道防线:

1. `normalize()` —— 洗掉看不见的差异(首尾空白、全角空格、重复空格)。
   这类差异老师自己在输入框里根本看不出来,靠提醒是没用的。
2. `resolve()` —— **向已有写法靠拢**:库里已经有「王老师」时,再敲
   「王 老师」「WANG老师」都归到已有那一个。比较键去掉全部空白 + 转小写,
   但**存的是已有的那个写法**,不是归一键 —— 显示要保留老师原本的排版
   (「Miss Lucy」不该被存成「misslucy」)。

⚠️ `resolve()` 只在**写入路径**调用(上传 / 改讲师 / 批量设讲师)。
读取路径按字符串原样分组,不做二次归一 —— 否则同一份数据在两处算出不同的组。
"""
import re
from typing import Iterable, Optional

# 讲师名长度上限,与 phonetic_videos.lecturer 列宽一致
MAX_LEN = 50

# 「未指定讲师 / 全校通用」在筛选参数里的哨兵值。
# 为什么不用空串:空串在筛选语义里已经是「不筛,全部都要」。
# 前导空格让它永不可能与真实讲师名相撞 —— normalize() 会削掉首尾空白,
# 所以任何入库的名字都不可能等于 ' none'。
# ⚠️ 前端 api/phonetics.ts 的 NO_LECTURER 必须同值(两端各写一份就会静默失配)
NO_LECTURER = " none"

# 空白:含全角空格 U+3000 与不换行空格 U+00A0(从 Word/PPT 里复制名字时常带)
_WS = re.compile(r"[\s　 ]+")


def normalize(raw: Optional[str]) -> Optional[str]:
    """洗掉看不见的差异。空 / 纯空白 → None(= 不归属任何讲师,「全校通用」)。

    只做两件事:首尾去空白、内部连续空白压成一个半角空格。
    **不删内部空格** —— 「Miss Lucy」「张 Amy」删了就成了另一个名字;
    要跨空格消歧是 `resolve()` 的事(它只用来比较,不改存储形态)。
    """
    if raw is None:
        return None
    s = _WS.sub(" ", str(raw)).strip()
    if not s:
        return None
    return s[:MAX_LEN]


def match_key(name: Optional[str]) -> str:
    """消歧用的比较键:去掉**全部**空白 + 转小写。

    只用于「这两个写法是不是同一个人」,永不入库、永不展示。
    大小写折叠用 casefold 而不是 lower(它对非英文字母更彻底)。
    """
    if not name:
        return ""
    return _WS.sub("", str(name)).casefold()


def resolve(raw: Optional[str], existing: Iterable[Optional[str]]) -> Optional[str]:
    """归一 + 向已有写法靠拢,返回**该入库的那个字符串**。

    existing 传该机构当前可见的讲师名(含平台预置的),顺序不敏感:
    命中已有写法就返回**已有的那一个**,让新旧视频落进同一组。
    命中不了才作为新讲师返回归一后的新名字。
    """
    name = normalize(raw)
    if name is None:
        return None
    key = match_key(name)
    for e in existing:
        if e and match_key(e) == key:
            return e
    return name
