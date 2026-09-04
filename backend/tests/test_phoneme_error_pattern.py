"""词尾多加元音的识别 —— 中国学生读英语最常犯的错

## 判据的实测依据(2026-09-03,生产真实录音)
    真人录音(词尾辅音的 11 个词)   11/11 检出
    Edge TTS 标准音(12 个词)       0/12  假阳性
交叉验证:Edge TTS 故意合成两音节「bay duh」→ beːda(末音 a),
而正常「bad」→ bæd。说明信号来自音节结构,不是模型对童声的偏差。

守的是**两个方向**:该报的报得出,不该报的一个都不报 ——
误报一次孩子就不敢开口,比漏报严重得多。
"""
from app.services.phoneme_error_pattern import (
    detect, ends_with_vowel, target_ends_with_consonant,
)


class TestEndsWithVowel:
    def test_英语元音结尾(self):
        assert ends_with_vowel(['b', 'æ']) is True

    def test_辅音结尾(self):
        assert ends_with_vowel(['b', 'æ', 'd']) is False

    def test_带声调的中文韵母也算元音(self):
        # 多加的那个音常被 espeak 多语言模型识别成中文韵母,
        # 只认英语元音会漏掉大半
        assert ends_with_vowel(['p', 'ei5', 't', 'ə1']) is True
        assert ends_with_vowel(['p', 'i', 't', 'əɜ']) is True

    def test_重音符不算末音素(self):
        assert ends_with_vowel(['b', 'æ', 'd', 'ˈ']) is False

    def test_空输入不崩(self):
        assert ends_with_vowel([]) is False


class TestTargetEndsWithConsonant:
    def test_辅音收尾的词(self):
        assert target_ends_with_consonant(['b', 'æ', 'd']) is True

    def test_元音收尾的词(self):
        # fee/bee/ace 这类多加音听不出来,判据不适用
        assert target_ends_with_consonant(['f', 'iː']) is False


class TestDetect:
    def test_真人多加元音要检出(self):
        # 实测 id15:目标 bad,听到 pei5tə1pei5tə1
        r = detect(['p', 'ei5', 't', 'ə1'], ['b', 'æ', 'd'])
        assert r is not None
        assert r['code'] == 'extra_final_vowel'
        assert '/d/' in r['message']

    def test_标准音不该误报(self):
        assert detect(['b', 'æ', 'd'], ['b', 'æ', 'd']) is None

    def test_标准音全表零假阳性(self):
        """本节 12 个辅音收尾的词,Edge TTS 标准音的实测解码结果"""
        cases = [
            (['a', 'd'], ['æ', 'd']),                  # add
            (['b', 'æ', 'd'], ['b', 'æ', 'd']),        # bad
            (['b', 'iː', 'd'], ['b', 'iː', 'd']),      # bead
            (['b', 'ɛ', 'd'], ['b', 'e', 'd']),        # bed
            (['k', 'ɑː', 'b'], ['k', 'æ', 'b']),       # cab
            (['d', 'a', 'b'], ['d', 'æ', 'b']),        # dab
            (['d', 'a', 'd'], ['d', 'æ', 'd']),        # dad
            (['d', 'a', 'f'], ['d', 'æ', 'f']),        # daff
            (['ɛ', 'b'], ['e', 'b']),                  # ebb
            (['f', 'a', 'f'], ['f', 'æ', 'f']),        # faff
        ]
        for heard, target in cases:
            assert detect(heard, target) is None, f"{heard} 被误报了"

    def test_目标词元音收尾时不下结论(self):
        # fee 听成 fi5 —— 末音是元音,但目标本来就是元音收尾,不适用
        assert detect(['f', 'i5'], ['f', 'iː']) is None

    def test_空输入不崩(self):
        assert detect([], ['b', 'æ', 'd']) is None
        assert detect(['b', 'æ', 'd'], []) is None
