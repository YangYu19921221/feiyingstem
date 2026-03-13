"""
AI服务 - 集成大模型能力
支持: OpenAI, Claude, 通义千问等
"""
from typing import List, Dict, Optional
from app.core.config import settings
import json
import hashlib
from datetime import datetime, timedelta

class AIService:
    """AI服务基类"""

    def __init__(self):
        self.cache = {}  # 简单的内存缓存,生产环境应使用Redis

    def _generate_cache_key(self, prefix: str, **kwargs) -> str:
        """生成缓存key"""
        content = json.dumps(kwargs, sort_keys=True)
        hash_key = hashlib.md5(content.encode()).hexdigest()
        return f"{prefix}:{hash_key}"

    def _get_cache(self, key: str) -> Optional[str]:
        """获取缓存"""
        if key in self.cache:
            value, expires_at = self.cache[key]
            if datetime.now() < expires_at:
                return value
            else:
                del self.cache[key]
        return None

    def _set_cache(self, key: str, value: str, ttl_days: int = 30):
        """设置缓存"""
        expires_at = datetime.now() + timedelta(days=ttl_days)
        self.cache[key] = (value, expires_at)

    async def generate_example_sentence(
        self,
        word: str,
        meaning: str,
        difficulty: str = "middle-school",
        context: str = "daily life"
    ) -> Dict[str, str]:
        """
        生成适合中小学生的例句
        返回: {"sentence": "...", "translation": "..."}
        """
        cache_key = self._generate_cache_key(
            "example",
            word=word,
            meaning=meaning,
            difficulty=difficulty
        )

        cached = self._get_cache(cache_key)
        if cached:
            return json.loads(cached)

        prompt = f"""请为单词 "{word}" (意思: {meaning}) 生成一个适合{difficulty}学生的英文例句。

要求:
1. 创作地道、自然的英语表达,符合母语者的语言习惯
2. 句子贴近{context}场景,让学生容易产生共鸣
3. 长度控制在8-15个单词之间
4. 使用学生熟悉的常见词汇,避免复杂语法结构
5. 单词的用法要典型,能体现其常见含义
6. 避免生硬的翻译腔,句子要流畅自然
7. 同时提供准确、地道的中文翻译

示例:
- 好的例句: "I helped my dad wash the car yesterday."
- 不好的例句: "I wash car." (语法不完整)
- 不好的例句: "Washing the car is something I do." (过于书面化)

请以JSON格式返回:
{{"sentence": "英文例句", "translation": "中文翻译"}}
"""

        result = await self._call_llm(prompt)

        # 解析JSON
        try:
            data = json.loads(result)
            self._set_cache(cache_key, result)
            return data
        except json.JSONDecodeError:
            # 如果解析失败,返回默认值
            return {
                "sentence": f"I like to use {word}.",
                "translation": f"我喜欢使用{word}。"
            }

    async def generate_distractors(
        self,
        word: str,
        correct_meaning: str,
        count: int = 3
    ) -> List[str]:
        """
        生成选择题的干扰项
        返回: ["错误选项1", "错误选项2", "错误选项3"]
        """
        cache_key = self._generate_cache_key(
            "distractors",
            word=word,
            correct_meaning=correct_meaning,
            count=count
        )

        cached = self._get_cache(cache_key)
        if cached:
            return json.loads(cached)

        prompt = f"""请为单词 "{word}" (正确释义: {correct_meaning}) 生成{count}个相似但错误的中文释义,用于选择题的干扰选项。

要求:
1. 干扰项要有一定迷惑性,但明显不同于正确答案
2. 适合中小学生水平
3. 避免使用过于生僻的词汇

请以JSON数组格式返回:
["干扰项1", "干扰项2", "干扰项3"]
"""

        result = await self._call_llm(prompt)

        try:
            data = json.loads(result)
            self._set_cache(cache_key, result)
            return data
        except json.JSONDecodeError:
            # 返回默认干扰项
            return ["选项A", "选项B", "选项C"][:count]

    async def explain_mistake(
        self,
        word: str,
        user_input: str,
        error_type: str = "spelling"
    ) -> str:
        """
        解释学生的错误
        返回: 错误解释和学习建议
        """
        prompt = f"""学生在拼写单词 "{word}" 时写成了 "{user_input}"。

请用简单易懂的语言解释:
1. 错在哪里
2. 正确拼写的记忆技巧
3. 鼓励的话语

要求:语气友好,适合中小学生,200字以内。
"""

        result = await self._call_llm(prompt)
        return result

    async def recommend_words(
        self,
        user_level: str,
        weak_points: List[str],
        learned_words: List[str],
        count: int = 10
    ) -> List[str]:
        """
        根据薄弱点推荐单词
        返回: 推荐的单词列表
        """
        prompt = f"""请根据以下信息推荐{count}个适合学生学习的英语单词:

学生水平: {user_level}
薄弱点: {', '.join(weak_points)}
已学单词: {', '.join(learned_words[-20:])}

要求:
1. 单词难度适中,循序渐进
2. 针对薄弱点进行强化
3. 避免重复已学单词
4. 选择常用高频词

请以JSON数组格式返回单词列表:
["word1", "word2", "word3", ...]
"""

        result = await self._call_llm(prompt)

        try:
            return json.loads(result)
        except json.JSONDecodeError:
            return []

    async def generate_exam_questions(
        self,
        words: List[Dict],
        question_types: List[str],
        total_count: int = 20
    ) -> List[Dict]:
        """
        根据单词列表和薄弱点生成试卷题目

        Args:
            words: 单词列表 [{"word": "...", "meaning": "...", "difficulty": ...}, ...]
            question_types: 题型列表 ["choice", "fill_blank", "spelling"]
            total_count: 总题目数

        Returns:
            题目列表 [{"type": "choice", "question": "...", "options": [...], "answer": "..."}, ...]
        """
        prompt = f"""请基于以下单词生成{total_count}道英语测试题:

单词列表:
{json.dumps(words, ensure_ascii=False, indent=2)}

题型要求: {', '.join(question_types)}

生成规则:
1. 题型分布均匀
2. 难度梯度合理(由易到难)
3. 选择题要有4个选项,其中1个正确答案
4. 填空题要给出完整句子,用___表示空白处
5. 拼写题要给出中文释义和音标

请以JSON数组格式返回,示例:
[
  {{
    "type": "choice",
    "question": "单词 'happy' 的意思是?",
    "options": ["A. 快乐的", "B. 悲伤的", "C. 愤怒的", "D. 紧张的"],
    "answer": "A",
    "word_id": "happy",
    "score": 5
  }},
  {{
    "type": "fill_blank",
    "question": "I am very ___ to see you. (我很高兴见到你)",
    "answer": "happy",
    "word_id": "happy",
    "score": 5
  }},
  {{
    "type": "spelling",
    "question": "请拼写: 快乐的 /ˈhæpi/",
    "answer": "happy",
    "word_id": "happy",
    "score": 5
  }}
]
"""

        result = await self._call_llm(prompt, max_tokens=4000)

        try:
            questions = json.loads(result)
            return questions[:total_count]
        except json.JSONDecodeError:
            return []

    async def generate_phonetic(
        self,
        word: str
    ) -> str:
        """
        生成单词的国际音标

        Args:
            word: 英文单词

        Returns:
            国际音标,格式如: /ˈæpl/
        """
        cache_key = self._generate_cache_key("phonetic", word=word)

        cached = self._get_cache(cache_key)
        if cached:
            return cached

        prompt = f"""请为英文单词 "{word}" 提供准确的国际音标(IPA)。

要求:
1. 只返回音标本身,用斜杠包围,如: /ˈæpl/
2. 如果有多个发音,返回最常用的美式发音
3. 确保使用标准的IPA符号
4. 不要包含任何解释或额外文字

单词: {word}
音标:"""

        result = await self._call_llm(prompt, max_tokens=50)

        # 提取音标 (去除可能的额外文字)
        phonetic = result.strip()
        if not phonetic.startswith('/'):
            # 尝试查找斜杠包围的内容
            import re
            match = re.search(r'/[^/]+/', phonetic)
            if match:
                phonetic = match.group(0)
            else:
                # 如果没有斜杠,自动添加
                phonetic = f"/{phonetic.strip()}/"

        self._set_cache(cache_key, phonetic)
        return phonetic

    async def generate_meaning(
        self,
        word: str,
        part_of_speech: str = ""
    ) -> str:
        """
        生成单词的中文释义

        Args:
            word: 英文单词
            part_of_speech: 词性 (可选,如 n., v., adj. 等)

        Returns:
            中文释义
        """
        cache_key = self._generate_cache_key("meaning", word=word, pos=part_of_speech)

        cached = self._get_cache(cache_key)
        if cached:
            return cached

        pos_hint = f" ({part_of_speech})" if part_of_speech else ""

        prompt = f"""请为英文单词 "{word}"{pos_hint} 提供准确的中文释义。

要求:
1. 只返回最常用的中文释义,不超过10个字
2. 如果单词有多个意思,返回最常见的一个
3. 释义要简洁明了,适合中小学生理解
4. 不要包含词性、音标或其他额外信息
5. 只返回中文释义本身

单词: {word}{pos_hint}
释义:"""

        result = await self._call_llm(prompt, max_tokens=50)

        # 清理结果
        meaning = result.strip()
        # 移除可能的引号
        meaning = meaning.strip('"\'""''')

        self._set_cache(cache_key, meaning)
        return meaning

    async def generate_complete_word_info(
        self,
        word: str,
        part_of_speech: str = "n.",
        existing_meanings: List[str] = None
    ) -> Dict[str, str]:
        """
        一键生成单词的完整信息(音标、释义、例句)

        Args:
            word: 英文单词
            part_of_speech: 词性
            existing_meanings: 已有的释义列表,用于避免重复

        Returns:
            包含音标、释义、例句、例句翻译的字典
        """
        # 使用时间戳确保每次生成不同内容
        import time
        cache_key = self._generate_cache_key("complete", word=word, pos=part_of_speech, ts=str(int(time.time())))

        # 构建避免重复的提示
        avoid_hint = ""
        if existing_meanings and len(existing_meanings) > 0:
            avoid_hint = f"\n\n重要: 这个单词已有以下释义,请生成一个【不同的】释义和例句:\n已有释义: {', '.join(existing_meanings)}\n请提供该单词作为{part_of_speech}时的【另一个不同含义】。"

        # 词性对应的释义方向提示
        pos_hints = {
            "n.": "作为名词时的含义",
            "v.": "作为动词时的含义(注意动作或行为)",
            "adj.": "作为形容词时的含义(描述特征或状态)",
            "adv.": "作为副词时的含义(修饰动词或形容词)",
            "prep.": "作为介词时的含义",
            "conj.": "作为连词时的含义",
            "pron.": "作为代词时的含义",
            "interj.": "作为感叹词时的含义",
        }
        pos_hint = pos_hints.get(part_of_speech, "")

        prompt = f"""请为英文单词 "{word}" ({part_of_speech}) 生成完整的学习信息。

词性说明: {pos_hint}
{avoid_hint}

要求:
1. 音标: 使用标准IPA格式,用斜杠包围,如 /ˈæpl/
2. 释义:
   - 必须是该单词作为【{part_of_speech}】词性时的中文释义
   - 简洁准确,不超过10个字
   - 如果该词性有多个含义,选择最常用的一个
3. 例句: 请按以下标准创作高质量例句
   - 例句必须体现单词作为【{part_of_speech}】的用法
   - 必须是地道的英语表达,符合母语者的语言习惯
   - 句子结构简单清晰,适合中小学生理解
   - 长度控制在8-15个单词之间
   - 选择贴近学生日常生活的场景(学校、家庭、运动、爱好等)
   - 单词在句中的用法要典型、常见
   - 避免生硬的翻译腔,要自然流畅
4. 例句翻译: 准确、通顺的中文翻译,符合中文表达习惯

示例参考(单词有多个词性时):
- run (v.): "I run to school every morning." → 跑步
- run (n.): "Let's go for a run in the park." → 跑步(名词)

请以JSON格式返回:
{{
  "phonetic": "/音标/",
  "meaning": "中文释义",
  "example_sentence": "英文例句",
  "example_translation": "例句翻译"
}}

单词: {word} ({part_of_speech})
"""

        result = await self._call_llm(prompt, max_tokens=300)

        try:
            # 解析JSON
            data = json.loads(result)

            # 确保音标格式正确
            if "phonetic" in data and not data["phonetic"].startswith('/'):
                import re
                match = re.search(r'/[^/]+/', data["phonetic"])
                if match:
                    data["phonetic"] = match.group(0)
                else:
                    data["phonetic"] = f"/{data['phonetic'].strip()}/"

            # 清理释义中的引号
            if "meaning" in data:
                data["meaning"] = data["meaning"].strip('"\'""''')

            # 缓存结果
            self._set_cache(cache_key, json.dumps(data, ensure_ascii=False))
            return data

        except json.JSONDecodeError:
            # 如果解析失败,返回空数据
            return {
                "phonetic": "",
                "meaning": "",
                "example_sentence": "",
                "example_translation": ""
            }

    async def analyze_weak_points(
        self,
        learning_history: List[Dict]
    ) -> Dict:
        """
        分析学生的薄弱点

        Args:
            learning_history: 学习记录 [{"word": "...", "is_correct": bool, "time_spent": int, ...}, ...]

        Returns:
            分析结果 {"weak_areas": [...], "suggestions": [...], "focus_words": [...]}
        """
        # 简单的规则分析
        total = len(learning_history)
        if total == 0:
            return {
                "weak_areas": [],
                "suggestions": ["开始学习吧!"],
                "focus_words": []
            }

        wrong_records = [r for r in learning_history if not r.get("is_correct", True)]
        accuracy = (total - len(wrong_records)) / total * 100

        # 找出错误最多的单词
        word_errors = {}
        for record in wrong_records:
            word = record.get("word", "")
            word_errors[word] = word_errors.get(word, 0) + 1

        focus_words = sorted(word_errors.items(), key=lambda x: x[1], reverse=True)[:10]

        weak_areas = []
        if accuracy < 60:
            weak_areas.append("整体掌握度较低,需要加强基础练习")
        if len(focus_words) > 5:
            weak_areas.append("部分单词反复出错,需要重点记忆")

        suggestions = [
            f"当前正确率: {accuracy:.1f}%",
            f"需要重点复习{len(focus_words)}个单词",
            "建议每天坚持学习15-30分钟"
        ]

        return {
            "weak_areas": weak_areas,
            "suggestions": suggestions,
            "focus_words": [w[0] for w in focus_words],
            "accuracy": accuracy
        }

    async def analyze_student_mistakes(
        self,
        student_id: int,
        word_mastery_records: List[Dict]
    ) -> Dict:
        """
        深度分析学生的错题情况,为生成个性化试卷提供依据

        Args:
            student_id: 学生ID
            word_mastery_records: 单词掌握度记录 [{"word": "...", "meaning": "...", "wrong_count": int, ...}, ...]

        Returns:
            分析结果,包含错题分布、薄弱题型、推荐单词等
        """
        if not word_mastery_records:
            return {
                "total_words": 0,
                "weak_words": [],
                "weak_question_types": [],
                "recommended_distribution": {
                    "choice": 0,
                    "fill_blank": 0,
                    "spelling": 0,
                    "reading": 0
                },
                "difficulty_level": "easy"
            }

        # 按错误次数排序,找出最需要强化的单词
        weak_words = sorted(
            word_mastery_records,
            key=lambda x: x.get("wrong_count", 0),
            reverse=True
        )[:20]  # 取错误最多的20个单词

        # 分析薄弱题型
        weak_types = []
        for record in word_mastery_records:
            if record.get("quiz_wrong", 0) > record.get("quiz_correct", 0):
                weak_types.append("choice")
            if record.get("spelling_wrong", 0) > record.get("spelling_correct", 0):
                weak_types.append("spelling")
            if record.get("fillblank_wrong", 0) > record.get("fillblank_correct", 0):
                weak_types.append("fill_blank")

        # 统计薄弱题型
        from collections import Counter
        type_counter = Counter(weak_types)

        # 根据薄弱情况推荐题型分布(参考标准试卷格式)
        # 参照正规小学/初中英语试卷标准,总分100分
        total_questions = 60
        distribution = {
            "choice": 20,        # 选择题(20题 x 1分 = 20分) - 单项选择,考查词汇、语法
            "cloze_test": 10,    # 完形填空(1-2篇,共10空 x 1分 = 10分) - 考查综合理解
            "fill_blank": 10,    # 填空题(10题 x 2分 = 20分) - 词汇运用、语法填空
            "spelling": 5,       # 拼写题(5题 x 2分 = 10分) - 单词拼写
            "reading": 15        # 阅读理解(3-4篇文章,共15题 x 2.67分 ≈ 40分) - 阅读能力
        }

        # 如果某个题型特别薄弱,增加该题型比重
        if type_counter:
            weakest_type = type_counter.most_common(1)[0][0]
            if weakest_type in distribution:
                distribution[weakest_type] += 2
                # 从其他题型减少
                for qtype in distribution:
                    if qtype != weakest_type and distribution[qtype] > 2:
                        distribution[qtype] -= 1
                        break

        # 根据整体正确率确定难度
        total_correct = sum(r.get("correct_count", 0) for r in word_mastery_records)
        total_wrong = sum(r.get("wrong_count", 0) for r in word_mastery_records)
        accuracy = total_correct / (total_correct + total_wrong) * 100 if (total_correct + total_wrong) > 0 else 0

        if accuracy >= 80:
            difficulty = "hard"
        elif accuracy >= 60:
            difficulty = "medium"
        else:
            difficulty = "easy"

        return {
            "total_words": len(word_mastery_records),
            "weak_words": weak_words[:15],  # 返回最薄弱的15个单词
            "weak_question_types": list(set(weak_types)),
            "recommended_distribution": distribution,
            "difficulty_level": difficulty,
            "accuracy_rate": accuracy
        }

    async def generate_personalized_exam(
        self,
        student_name: str,
        weak_words: List[Dict],
        question_distribution: Dict[str, int],
        difficulty: str = "medium"
    ) -> Dict:
        """
        根据学生错题情况,AI生成个性化试卷

        Args:
            student_name: 学生姓名
            weak_words: 薄弱单词列表 [{"word": "...", "meaning": "...", "wrong_count": ...}, ...]
            question_distribution: 题型分布 {"choice": 15, "cloze_test": 10, "fill_blank": 8, "spelling": 5, "reading": 12}
            difficulty: 整体难度

        Returns:
            完整的试卷数据,包含各种题型
        """
        # 构建AI提示词
        words_summary = "\n".join([
            f"- {w['word']} ({w['meaning']}) - 错误{w.get('wrong_count', 0)}次"
            for w in weak_words[:20]
        ])

        prompt = f"""
请为学生"{student_name}"生成一份标准格式的英语测试卷。

# 学生薄弱点分析
该学生在以下单词上表现较弱:
{words_summary}

# 试卷要求
1. 总题数: {sum(question_distribution.values())}题,满分100分
2. 题型分布(必须严格按照以下数量生成):
   - 选择题: {question_distribution.get('choice', 0)}题 (每题2分)
   - 完形填空: {question_distribution.get('cloze_test', 0)}个空 (基于1-2篇100-150词的短文,共{question_distribution.get('cloze_test', 0)}个空,每空1分)
   - 填空题: {question_distribution.get('fill_blank', 0)}题 (每题2分)
   - 拼写题: {question_distribution.get('spelling', 0)}题 (每题2分)
   - 阅读理解: {question_distribution.get('reading', 0)}题 (生成{(question_distribution.get('reading', 0) + 3) // 4}篇文章,每篇100-200词,共{question_distribution.get('reading', 0)}题,每题3分)
3. 整体难度: {difficulty}
4. 优先使用上述薄弱单词出题,**可以重复使用同一个单词**出不同类型的题目
5. ⚠️ 重要:必须严格按照第2点的题目数量生成,不能多也不能少!如果单词不够,请重复使用单词!

# 重要出题规则

## 选择题
- 4个选项(A/B/C/D),干扰项要有一定迷惑性
- 考查词义、用法、语法等

## 完形填空 ⭐ 重点
- 提供一篇100-150词的完整短文
- 短文中挖空10个位置,编号为 ___1___, ___2___ 等
- 每个空给出4个选项
- 选项要符合上下文语境
- 短文要有完整的情节或主题

## 填空题
- 给出完整句子和中文提示
- 用___标记空白

## 拼写题
- 给出中文释义,要求拼写单词

## 阅读理解 ⭐ 重点
- 生成3篇独立的短文,每篇100-200词
- 每篇短文要有完整的主题和情节
- 每篇短文配4个问题
- 问题类型包括:细节理解、推理判断、主旨大意、词义猜测

请以JSON格式返回完整试卷:
{{
  "title": "针对{student_name}的个性化测试卷",
  "description": "根据薄弱点生成,重点考查易错单词",
  "total_score": 100,
  "questions": [
    {{
      "question_number": 1,
      "question_type": "choice",
      "content": "The word 'happy' means ___.",
      "options": [
        {{"key": "A", "text": "快乐的"}},
        {{"key": "B", "text": "悲伤的"}},
        {{"key": "C", "text": "生气的"}},
        {{"key": "D", "text": "害怕的"}}
      ],
      "correct_answer": "A",
      "explanation": "happy表示快乐的",
      "score": 1,
      "word": "happy"
    }},
    {{
      "question_number": 16,
      "question_type": "cloze_test",
      "passage": "Tom is a ___1___ boy. He ___2___ to school every day. He has many ___3___ at school. They often ___4___ together. Tom is very ___5___ because he loves learning. His teacher ___6___ him very much. After school, Tom ___7___ his homework first. Then he ___8___ with his dog. In the evening, he ___9___ books. Tom ___10___ to be a teacher when he grows up.",
      "passage_id": "cloze_1",
      "blanks": [
        {{
          "blank_number": 1,
          "content": "Tom is a ___1___ boy.",
          "options": [
            {{"key": "A", "text": "happy"}},
            {{"key": "B", "text": "sad"}},
            {{"key": "C", "text": "angry"}},
            {{"key": "D", "text": "lazy"}}
          ],
          "correct_answer": "A",
          "explanation": "根据后文可知Tom喜欢学习,所以是happy",
          "score": 1,
          "word": "happy"
        }},
        {{
          "blank_number": 2,
          "content": "He ___2___ to school every day.",
          "options": [
            {{"key": "A", "text": "walks"}},
            {{"key": "B", "text": "runs"}},
            {{"key": "C", "text": "drives"}},
            {{"key": "D", "text": "flies"}}
          ],
          "correct_answer": "A",
          "explanation": "学生通常走路上学",
          "score": 1,
          "word": "walk"
        }}
      ]
    }},
    {{
      "question_number": 26,
      "question_type": "fill_blank",
      "content": "I am very ___ today. (我今天很高兴)",
      "correct_answer": "happy",
      "explanation": "根据中文提示,应填happy",
      "score": 2,
      "word": "happy"
    }},
    {{
      "question_number": 34,
      "question_type": "spelling",
      "content": "请拼写:快乐的",
      "correct_answer": "happy",
      "explanation": "happy的拼写",
      "score": 2,
      "word": "happy"
    }},
    {{
      "question_number": 39,
      "question_type": "reading",
      "passage_id": "reading_1",
      "passage_title": "My Best Friend",
      "passage": "Tom is my best friend. We met in primary school five years ago. Tom is a very kind and helpful person. He always helps his classmates with their homework. Tom loves playing basketball. Every weekend, we go to the park and play basketball together. Tom also likes reading books. His favorite book is Harry Potter. He has read all seven books in the series. Tom wants to be a teacher when he grows up because he enjoys helping others learn new things. I am very lucky to have such a good friend like Tom.",
      "content": "When did the writer meet Tom?",
      "options": [
        {{"key": "A", "text": "Five years ago"}},
        {{"key": "B", "text": "Last year"}},
        {{"key": "C", "text": "Ten years ago"}},
        {{"key": "D", "text": "This year"}}
      ],
      "correct_answer": "A",
      "explanation": "文中说'We met in primary school five years ago'",
      "score": 3,
      "word": "friend"
    }}
  ]
}}

重要提示:
1. 完形填空的passage字段应包含完整短文,其中用___1___, ___2___等标记空白位置
2. 完形填空的blanks数组包含所有空的详细信息
3. 阅读理解每篇文章要有passage_id, passage_title, passage字段
4. 同一篇阅读文章的多个问题共享相同的passage_id
5. 题目编号要连续

只返回JSON,不要其他内容。
"""

        result = await self._call_llm(prompt, max_tokens=16000)  # 增加到16000以支持60题

        try:
            # 处理可能的markdown代码块
            result_text = result.strip()
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0].strip()

            exam_data = json.loads(result_text)

            # 打印生成的题目数量
            actual_count = len(exam_data.get("questions", []))
            expected_count = sum(question_distribution.values())
            print(f"✅ AI生成了 {actual_count} 道题 (要求: {expected_count} 题)")
            if actual_count < expected_count:
                print(f"⚠️  题目数量不足! 预期{expected_count}题,实际只有{actual_count}题")

            # 确保题目编号连续
            for i, q in enumerate(exam_data.get("questions", []), 1):
                q["question_number"] = i

            return exam_data

        except json.JSONDecodeError as e:
            print(f"AI生成试卷JSON解析失败: {e}, response: {result[:500]}")
            # 返回一个基础试卷模板
            return self._generate_fallback_exam(student_name, weak_words, question_distribution)

    def _generate_fallback_exam(
        self,
        student_name: str,
        weak_words: List[Dict],
        distribution: Dict[str, int]
    ) -> Dict:
        """生成备用试卷(当AI调用失败时)"""
        questions = []
        question_num = 1
        word_idx = 0

        # 选择题
        for i in range(distribution.get("choice", 0)):
            if word_idx < len(weak_words):
                word_info = weak_words[word_idx]
                questions.append({
                    "question_number": question_num,
                    "question_type": "choice",
                    "content": f"The word '{word_info['word']}' means ___.",
                    "options": [
                        {"key": "A", "text": word_info["meaning"]},
                        {"key": "B", "text": "其他选项1"},
                        {"key": "C", "text": "其他选项2"},
                        {"key": "D", "text": "其他选项3"}
                    ],
                    "correct_answer": "A",
                    "explanation": f"{word_info['word']}的意思是{word_info['meaning']}",
                    "score": 1,
                    "word": word_info["word"]
                })
                question_num += 1
                word_idx += 1

        # 完形填空(简化版:10个空)
        cloze_count = distribution.get("cloze_test", 0)
        if cloze_count > 0:
            # 生成一个简单的完形填空短文
            blanks = []
            passage_words = []
            for i in range(min(10, cloze_count)):
                if word_idx < len(weak_words):
                    word_info = weak_words[word_idx]
                    passage_words.append(word_info['word'])
                    blanks.append({
                        "blank_number": i + 1,
                        "content": f"Fill in blank {i+1}",
                        "options": [
                            {"key": "A", "text": word_info["word"]},
                            {"key": "B", "text": "option1"},
                            {"key": "C", "text": "option2"},
                            {"key": "D", "text": "option3"}
                        ],
                        "correct_answer": "A",
                        "explanation": f"应填{word_info['word']}",
                        "score": 1,
                        "word": word_info["word"]
                    })
                    word_idx += 1

            # 生成完形填空题(作为一个整体)
            passage_text = "Tom is a ___1___ student. " + " ".join([f"He ___{ i+2}___ every day." for i in range(len(blanks)-1)])
            questions.append({
                "question_number": question_num,
                "question_type": "cloze_test",
                "content": "Read the passage and choose the best option for each blank.",
                "passage": passage_text,
                "passage_id": "cloze_1",
                "blanks": blanks
            })
            question_num += 1

        # 填空题
        for i in range(distribution.get("fill_blank", 0)):
            if word_idx < len(weak_words):
                word_info = weak_words[word_idx]
                questions.append({
                    "question_number": question_num,
                    "question_type": "fill_blank",
                    "content": f"I am very ___ . (我很{word_info['meaning']})",
                    "correct_answer": word_info["word"],
                    "explanation": f"根据提示,应填{word_info['word']}",
                    "score": 2,
                    "word": word_info["word"]
                })
                question_num += 1
                word_idx += 1

        # 拼写题
        for i in range(distribution.get("spelling", 0)):
            if word_idx < len(weak_words):
                word_info = weak_words[word_idx]
                questions.append({
                    "question_number": question_num,
                    "question_type": "spelling",
                    "content": f"请拼写: {word_info['meaning']}",
                    "correct_answer": word_info["word"],
                    "explanation": f"正确拼写是{word_info['word']}",
                    "score": 2,
                    "word": word_info["word"]
                })
                question_num += 1
                word_idx += 1

        # 阅读理解(3篇文章,每篇4题)
        reading_count = distribution.get("reading", 0)
        passages_count = (reading_count + 3) // 4  # 每篇4题
        for p in range(passages_count):
            passage_id = f"reading_{p+1}"
            passage_text = f"This is passage {p+1}. " + " ".join([
                f"Sentence {i+1} with important content."
                for i in range(5)
            ])

            # 每篇4个问题
            for q in range(min(4, reading_count - p*4)):
                if word_idx < len(weak_words):
                    word_info = weak_words[word_idx]
                    questions.append({
                        "question_number": question_num,
                        "question_type": "reading",
                        "passage_id": passage_id,
                        "passage_title": f"Passage {p+1}",
                        "passage": passage_text,
                        "content": f"Question {q+1}: What does '{word_info['word']}' mean?",
                        "options": [
                            {"key": "A", "text": word_info["meaning"]},
                            {"key": "B", "text": "选项B"},
                            {"key": "C", "text": "选项C"},
                            {"key": "D", "text": "选项D"}
                        ],
                        "correct_answer": "A",
                        "explanation": f"{word_info['word']}的意思是{word_info['meaning']}",
                        "score": 3,
                        "word": word_info["word"]
                    })
                    question_num += 1
                    word_idx += 1

        # 计算总分
        total_score = sum([
            distribution.get("choice", 0) * 1,
            distribution.get("cloze_test", 0) * 1,
            distribution.get("fill_blank", 0) * 2,
            distribution.get("spelling", 0) * 2,
            distribution.get("reading", 0) * 3
        ])

        return {
            "title": f"针对{student_name}的个性化测试卷",
            "description": "根据薄弱点生成,重点考查易错单词",
            "total_score": total_score,
            "questions": questions
        }

    async def _get_ai_config(self):
        """从数据库获取默认AI配置"""
        try:
            from sqlalchemy import select
            from app.core.database import get_db
            from app.models.system_config import AIProvider

            async for db in get_db():
                # SQLite中布尔值存储为1/0,需要用==1而不是==True
                result = await db.execute(
                    select(AIProvider).where(
                        AIProvider.is_default == 1,
                        AIProvider.enabled == 1
                    )
                )
                provider = result.scalar_one_or_none()

                print(f"🔍 [DEBUG] 数据库查询结果: {provider}")
                if provider:
                    print(f"🔍 [DEBUG] provider_name={provider.provider_name}, type={type(provider.provider_name)}")

                    # 尝试解密API Key,如果失败或返回DECRYPTION_FAILED则直接使用明文
                    api_key = provider.api_key
                    print(f"🔍 [DEBUG] 原始API Key: {api_key[:20] if api_key else 'None'}..., 长度: {len(api_key) if api_key else 0}")

                    try:
                        from app.api.v1.admin.ai_config import decrypt_api_key
                        decrypted_key = decrypt_api_key(provider.api_key)
                        print(f"🔍 [DEBUG] 解密后API Key: {decrypted_key[:20] if decrypted_key else 'None'}..., 长度: {len(decrypted_key) if decrypted_key else 0}")
                        # 如果解密返回DECRYPTION_FAILED,说明是明文key,使用原始key
                        if decrypted_key == "DECRYPTION_FAILED":
                            print(f"⚠️  解密返回DECRYPTION_FAILED,使用明文API Key")
                            api_key = provider.api_key
                        else:
                            api_key = decrypted_key
                    except Exception as decrypt_error:
                        # 解密失败,使用明文API Key
                        print(f"⚠️  API Key解密异常,使用明文: {decrypt_error}")
                        api_key = provider.api_key

                    print(f"🔍 [DEBUG] 最终API Key: {api_key[:20] if api_key else 'None'}..., 长度: {len(api_key) if api_key else 0}")

                    print(f"✓ 从数据库加载AI配置: provider={provider.provider_name}, model={provider.model_name}")
                    config = {
                        "provider_name": provider.provider_name,
                        "api_key": api_key,
                        "base_url": provider.base_url,
                        "model_name": provider.model_name,
                        "extra_config": provider.extra_config or {}
                    }
                    print(f"🔍 [DEBUG] 返回配置: provider_name={config['provider_name']}")
                    return config
                break
        except Exception as e:
            print(f"从数据库获取AI配置失败: {e}")
            import traceback
            traceback.print_exc()

        # 降级到环境变量
        if settings.OPENAI_API_KEY:
            return {
                "provider_name": "openai",
                "api_key": settings.OPENAI_API_KEY,
                "base_url": "https://api.openai.com/v1",
                "model_name": settings.OPENAI_MODEL,
                "extra_config": {}
            }
        elif settings.ANTHROPIC_API_KEY:
            return {
                "provider_name": "claude",
                "api_key": settings.ANTHROPIC_API_KEY,
                "base_url": None,
                "model_name": settings.ANTHROPIC_MODEL,
                "extra_config": {}
            }

        return None

    async def _call_llm(self, prompt: str, max_tokens: int = 1000) -> str:
        """
        调用大模型API
        优先从数据库读取配置,降级到环境变量
        """
        config = await self._get_ai_config()

        if not config:
            raise ValueError("未配置任何AI模型")

        # 根据provider_name选择调用方法
        if config["provider_name"] in ["openai", "qwen"]:
            # OpenAI兼容API (包括通义千问)
            return await self._call_openai_compatible(
                prompt,
                max_tokens,
                api_key=config["api_key"],
                base_url=config["base_url"],
                model=config["model_name"],
                extra_config=config["extra_config"]
            )
        elif config["provider_name"] == "claude":
            return await self._call_claude(
                prompt,
                max_tokens,
                api_key=config["api_key"],
                model=config["model_name"]
            )
        else:
            raise ValueError(f"不支持的AI提供商: {config['provider_name']}")

    async def _call_openai_compatible(
        self,
        prompt: str,
        max_tokens: int,
        api_key: str,
        base_url: str,
        model: str,
        extra_config: dict
    ) -> str:
        """调用OpenAI兼容API (包括通义千问等)"""
        try:
            from openai import AsyncOpenAI

            # 详细日志:API调用参数
            print(f"🔧 [DEBUG] API调用参数:")
            print(f"  - base_url: {base_url}")
            print(f"  - model: {model}")
            print(f"  - api_key前缀: {api_key[:20] if api_key else 'None'}...")
            print(f"  - api_key长度: {len(api_key) if api_key else 0}")

            client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url
            )

            # 合并额外配置
            temperature = extra_config.get("temperature", 0.7)

            print(f"🚀 开始调用AI API...")
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的英语教学助手,擅长为中小学生设计学习内容。"
                    },
                    {"role": "user", "content": prompt}
                ],
                max_tokens=max_tokens,
                temperature=temperature
            )

            print(f"✅ AI API调用成功!")
            return response.choices[0].message.content.strip()

        except Exception as e:
            print(f"❌ AI API调用失败: {e}")
            import traceback
            traceback.print_exc()
            return ""

    async def _call_openai(self, prompt: str, max_tokens: int) -> str:
        """调用OpenAI API (向后兼容)"""
        return await self._call_openai_compatible(
            prompt,
            max_tokens,
            api_key=settings.OPENAI_API_KEY,
            base_url="https://api.openai.com/v1",
            model=settings.OPENAI_MODEL,
            extra_config={}
        )

    async def _call_claude(
        self,
        prompt: str,
        max_tokens: int,
        api_key: str = None,
        model: str = None
    ) -> str:
        """调用Claude API"""
        try:
            from anthropic import AsyncAnthropic

            # 如果没有提供参数,使用环境变量 (向后兼容)
            api_key = api_key or settings.ANTHROPIC_API_KEY
            model = model or settings.ANTHROPIC_MODEL

            client = AsyncAnthropic(api_key=api_key)

            message = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system="你是一个专业的英语教学助手,擅长为中小学生设计学习内容。",
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )

            return message.content[0].text.strip()

        except Exception as e:
            print(f"Claude API调用失败: {e}")
            return ""

    async def _get_tts_config(self):
        """从数据库获取TTS配置"""
        try:
            from sqlalchemy import select
            from app.core.database import get_db
            from app.models.system_config import AIProvider

            async for db in get_db():
                result = await db.execute(
                    select(AIProvider).where(
                        AIProvider.is_default == True,
                        AIProvider.enabled == True,
                        AIProvider.tts_enabled == True
                    )
                )
                provider = result.scalar_one_or_none()

                if provider:
                    from app.api.v1.admin.ai_config import decrypt_api_key
                    return {
                        "api_key": decrypt_api_key(provider.api_key),
                        "base_url": provider.base_url,
                        "tts_model": provider.tts_model or "cosyvoice-v1",
                        "tts_voice": provider.tts_voice or "longxiaochun"
                    }
                break
        except Exception as e:
            print(f"获取TTS配置失败: {e}")
        return None

    async def generate_speech(self, text: str) -> bytes:
        """
        生成语音 - 使用阿里云CosyVoice TTS

        Args:
            text: 要转换的文本

        Returns:
            音频数据 (MP3格式)
        """
        config = await self._get_tts_config()

        if not config:
            raise ValueError("TTS功能未启用或未配置")

        try:
            # 直接使用HTTP API,避免WebSocket连接问题
            return await self._generate_speech_httpx(text, config)
        except Exception as e:
            print(f"TTS生成失败: {e}")
            import traceback
            traceback.print_exc()
            raise ValueError(f"语音合成失败: {str(e)}")

    async def _generate_speech_httpx(self, text: str, config: dict) -> bytes:
        """使用DashScope SDK调用TTS API"""
        try:
            from dashscope.audio.tts_v2 import SpeechSynthesizer
            import dashscope

            # 设置API Key
            dashscope.api_key = config['api_key']

            # 使用同步SDK (dashscope暂不支持异步)
            synthesizer = SpeechSynthesizer(
                model=config["tts_model"],
                voice=config["tts_voice"]
            )

            # 调用SDK生成语音
            audio = synthesizer.call(text)

            # 检查返回的是否为bytes类型的音频数据
            if audio and isinstance(audio, bytes):
                return audio

            # 如果没有音频数据,抛出错误
            raise ValueError(f"TTS生成失败: 未获取到音频数据, 返回类型: {type(audio)}")

        except Exception as e:
            print(f"DashScope TTS错误: {e}")
            import traceback
            traceback.print_exc()
            raise ValueError(f"TTS API错误: {str(e)}")

    async def _poll_tts_task(self, api_key: str, task_id: str, max_retries: int = 30) -> bytes:
        """轮询TTS异步任务结果"""
        import httpx
        import asyncio

        status_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
        headers = {"Authorization": f"Bearer {api_key}"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            for _ in range(max_retries):
                response = await client.get(status_url, headers=headers)
                if response.status_code == 200:
                    result = response.json()
                    status = result.get("output", {}).get("task_status")

                    if status == "SUCCEEDED":
                        # 获取音频URL并下载
                        audio_url = result.get("output", {}).get("audio_url")
                        if audio_url:
                            audio_response = await client.get(audio_url)
                            return audio_response.content
                        # 或者直接返回base64音频
                        audio_data = result.get("output", {}).get("audio")
                        if audio_data:
                            import base64
                            return base64.b64decode(audio_data)

                    elif status == "FAILED":
                        raise ValueError(f"TTS任务失败: {result}")

                await asyncio.sleep(0.5)

        raise ValueError("TTS任务超时")

    async def generate_competition_question(
        self,
        word: str,
        meaning: str,
        question_type: str,
        difficulty: str = "medium",
        custom_prompt: str = None
    ) -> Dict:
        """
        AI生成竞赛题目

        Args:
            word: 单词
            meaning: 释义
            question_type: 题型 (choice/fill_blank/spelling/reading)
            difficulty: 难度 (easy/medium/hard)
            custom_prompt: 自定义提示词,用于指导AI生成

        Returns:
            题目数据字典
        """
        if question_type == "choice":
            return await self._generate_choice_question(word, meaning, difficulty, custom_prompt)
        elif question_type == "fill_blank":
            return await self._generate_fill_blank_question(word, meaning, difficulty, custom_prompt)
        elif question_type == "spelling":
            return await self._generate_spelling_question(word, meaning, difficulty, custom_prompt)
        elif question_type == "reading":
            return await self._generate_reading_question(word, meaning, difficulty, custom_prompt)
        else:
            raise ValueError(f"不支持的题型: {question_type}")

    async def _generate_choice_question(
        self,
        word: str,
        meaning: str,
        difficulty: str,
        custom_prompt: str = None
    ) -> Dict:
        """生成选择题"""
        # 构建自定义提示词部分
        custom_instruction = ""
        if custom_prompt:
            custom_instruction = f"\n\n【教师自定义要求】:\n{custom_prompt}\n"

        prompt = f"""
作为英语教学助手,请为以下单词生成一道选择题:

单词: {word}
释义: {meaning}
难度: {difficulty}
{custom_instruction}
要求:
1. 题干简洁明了,适合中小学生
2. 4个选项(A/B/C/D),只有1个正确答案
3. 干扰项要有一定迷惑性,但不要太难
4. 符合{difficulty}难度
5. 必须以JSON格式返回

返回格式:
{{
  "content": "题干(例如: The word 'happy' means ___)",
  "options": [
    {{"key": "A", "text": "选项A内容", "is_correct": true}},
    {{"key": "B", "text": "选项B内容", "is_correct": false}},
    {{"key": "C", "text": "选项C内容", "is_correct": false}},
    {{"key": "D", "text": "选项D内容", "is_correct": false}}
  ],
  "correct_answer": "A",
  "answer_explanation": "答案解析"
}}

只返回JSON,不要其他文字。
"""

        response = await self._call_llm(prompt, max_tokens=500)

        try:
            # 提取JSON (处理可能的markdown代码块)
            response_text = response.strip()
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()

            data = json.loads(response_text)

            # 随机打乱选项顺序,避免正确答案总是在同一位置
            import random
            options = data["options"]
            # 找到正确答案的文本
            correct_option = next((opt for opt in options if opt.get("is_correct")), options[0])
            # 打乱选项
            random.shuffle(options)
            # 重新分配ABCD键和display_order
            keys = ["A", "B", "C", "D"]
            shuffled_options = []
            correct_key = None
            for i, opt in enumerate(options):
                new_key = keys[i]
                if opt.get("is_correct") or opt["text"] == correct_option["text"]:
                    correct_key = new_key
                shuffled_options.append({
                    "key": new_key,
                    "text": opt["text"],
                    "is_correct": (new_key == correct_key) if correct_key else opt.get("is_correct", False),
                    "display_order": i + 1
                })

            return {
                "question_type": "choice",
                "content": data["content"],
                "correct_answer": json.dumps({"answer": correct_key or data["correct_answer"]}),
                "answer_explanation": data.get("answer_explanation", ""),
                "difficulty": difficulty,
                "options": shuffled_options
            }
        except Exception as e:
            print(f"AI生成选择题失败: {e}, response: {response}")
            # 返回一个默认题目,同样随机化选项位置
            import random
            options_pool = [
                {"text": meaning, "is_correct": True},
                {"text": "其他选项1", "is_correct": False},
                {"text": "其他选项2", "is_correct": False},
                {"text": "其他选项3", "is_correct": False}
            ]
            random.shuffle(options_pool)
            keys = ["A", "B", "C", "D"]
            options = []
            correct_key = None
            for i, opt in enumerate(options_pool):
                key = keys[i]
                if opt["is_correct"]:
                    correct_key = key
                options.append({
                    "key": key,
                    "text": opt["text"],
                    "is_correct": opt["is_correct"],
                    "display_order": i + 1
                })

            return {
                "question_type": "choice",
                "content": f"The word '{word}' means ___",
                "correct_answer": json.dumps({"answer": correct_key}),
                "answer_explanation": f"'{word}' 的释义是 {meaning}",
                "difficulty": difficulty,
                "options": options
            }

    async def _generate_fill_blank_question(
        self,
        word: str,
        meaning: str,
        difficulty: str,
        custom_prompt: str = None
    ) -> Dict:
        """生成填空题"""
        # 构建自定义提示词部分
        custom_instruction = ""
        if custom_prompt:
            custom_instruction = f"\n\n【教师自定义要求】:\n{custom_prompt}\n"

        prompt = f"""
作为英语教学助手,请为单词"{word}"({meaning})生成一道填空题:
{custom_instruction}
要求:
1. 创建一个包含该单词的英文句子,用下划线代替该单词
2. 提供中文翻译帮助理解
3. 适合中小学生,难度为{difficulty}
4. 必须以JSON格式返回

返回格式:
{{
  "content": "句子,用___代替单词 (中文翻译)",
  "correct_answer": ["{word}"],
  "answer_explanation": "根据语境,这里应填入..."
}}

只返回JSON,不要其他文字。
"""

        response = await self._call_llm(prompt, max_tokens=300)

        try:
            response_text = response.strip()
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()

            data = json.loads(response_text)

            return {
                "question_type": "fill_blank",
                "content": data["content"],
                "correct_answer": json.dumps(data["correct_answer"]),
                "answer_explanation": data.get("answer_explanation", ""),
                "difficulty": difficulty,
                "options": None
            }
        except Exception as e:
            print(f"AI生成填空题失败: {e}")
            return {
                "question_type": "fill_blank",
                "content": f"I am very ___ today. (我今天很{meaning})",
                "correct_answer": json.dumps([word]),
                "answer_explanation": f"根据语境,这里应填入 {word}",
                "difficulty": difficulty,
                "options": None
            }

    async def _generate_spelling_question(
        self,
        word: str,
        meaning: str,
        difficulty: str,
        custom_prompt: str = None
    ) -> Dict:
        """生成拼写题"""
        # 如果有自定义提示词,可以生成更丰富的题目描述
        content = f"请拼写: {meaning}"
        if custom_prompt:
            content = f"{custom_prompt} - {meaning}"

        return {
            "question_type": "spelling",
            "content": content,
            "correct_answer": json.dumps({"answer": word}),
            "answer_explanation": f"正确拼写是: {word}",
            "difficulty": difficulty,
            "options": None
        }

    async def _generate_reading_question(
        self,
        word: str,
        meaning: str,
        difficulty: str,
        custom_prompt: str = None
    ) -> Dict:
        """生成阅读理解题"""
        # 构建自定义提示词部分
        custom_instruction = ""
        if custom_prompt:
            custom_instruction = f"\n\n【教师自定义要求】:\n{custom_prompt}\n"

        prompt = f"""
作为英语教学助手,请创建一道基于单词"{word}"({meaning})的阅读理解题:
{custom_instruction}
要求:
1. 写一段3-5句话的短文,其中包含该单词
2. 设计一个与短文内容相关的问题
3. 提供4个选项(A/B/C/D)
4. 适合中小学生,难度为{difficulty}
5. 必须以JSON格式返回

返回格式:
{{
  "title": "短文标题",
  "passage": "短文内容(3-5句话)",
  "content": "问题",
  "options": [
    {{"key": "A", "text": "选项A", "is_correct": true}},
    {{"key": "B", "text": "选项B", "is_correct": false}},
    {{"key": "C", "text": "选项C", "is_correct": false}},
    {{"key": "D", "text": "选项D", "is_correct": false}}
  ],
  "correct_answer": "A",
  "answer_explanation": "答案解析"
}}

只返回JSON,不要其他文字。
"""

        response = await self._call_llm(prompt, max_tokens=600)

        try:
            response_text = response.strip()
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()

            data = json.loads(response_text)

            return {
                "question_type": "reading",
                "title": data.get("title", ""),
                "passage": data.get("passage", ""),
                "content": data["content"],
                "correct_answer": json.dumps({"answer": data["correct_answer"]}),
                "answer_explanation": data.get("answer_explanation", ""),
                "difficulty": difficulty,
                "options": data["options"]
            }
        except Exception as e:
            print(f"AI生成阅读理解题失败: {e}")
            # 返回默认题目
            return {
                "question_type": "reading",
                "title": "Short Story",
                "passage": f"The story uses the word {word}.",
                "content": f"What does '{word}' mean?",
                "correct_answer": json.dumps({"answer": "A"}),
                "answer_explanation": f"'{word}' means {meaning}",
                "difficulty": difficulty,
                "options": [
                    {"key": "A", "text": meaning, "is_correct": True, "display_order": 1},
                    {"key": "B", "text": "Other meaning 1", "is_correct": False, "display_order": 2},
                    {"key": "C", "text": "Other meaning 2", "is_correct": False, "display_order": 3},
                    {"key": "D", "text": "Other meaning 3", "is_correct": False, "display_order": 4}
                ]
            }


# 单例模式
ai_service = AIService()
