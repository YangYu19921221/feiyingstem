"""教师端音标教材上传 —— 校验先行、失败不落库

重点守两件事:
1. 切不出音素的行必须被拦(那是学生永远填不对的死题)
2. 有任何一行不合格就**整本不导**(不留残缺教材在库里)
"""
import pytest

from app.services.phonetic_tokenize import check_item, lesson_highlight, tokenize


class TestTokenize:
    def test_三套写法归一到同一结果(self):
        # 视频教 [ei]、教材印 [eɪ]、词库存 /eɪ/ —— 必须切成同一串
        for raw in ('[beɪb]', '/beib/', 'beɪb'):
            toks, unk = tokenize(raw)
            assert unk == [], f"{raw} 出现切不开的字符 {unk}"
            assert toks == ['b', 'eɪ', 'b'], f"{raw} → {toks}"

    def test_长音符两种写法等价(self):
        assert tokenize('[fiː]')[0] == tokenize('/fi:/')[0] == ['f', 'iː']

    def test_双字符音素不被切开(self):
        # 不按长度排序的话 tʃ 会被切成 t + ʃ
        assert tokenize('[tʃiːz]')[0] == ['tʃ', 'iː', 'z']

    def test_ə长音归到ɜː(self):
        assert tokenize('/bə:d/')[0] == ['b', 'ɜː', 'd']


class TestCheckItem:
    def test_正常行给出元音下标(self):
        ok, err = check_item('bad', '[bæd]')
        assert err is None
        assert ok['answer'] == ['b', 'æ', 'd']
        assert ok['core'] == [1]          # 第二遍只挖元音,元音在第 1 格

    def test_键盘上没有的符号必须拦(self):
        ok, err = check_item('x', '[bæd☃]')
        assert ok is None
        assert '键盘上没有' in err

    def test_切不出元音必须拦(self):
        # 没有元音 → 第二遍(只挖元音)无法出题
        ok, err = check_item('pst', '[pst]')
        assert ok is None
        assert '元音' in err

    def test_空音标必须拦(self):
        ok, err = check_item('word', '')
        assert ok is None


class TestHighlight:
    def test_出现三次以上的元音才算这节的重点(self):
        items = [
            {'answer': ['b', 'æ', 'd']},
            {'answer': ['d', 'æ', 'd']},
            {'answer': ['k', 'æ', 'b']},
            {'answer': ['f', 'iː']},      # iː 只出现一次,不该进高亮
        ]
        hl = lesson_highlight(items)
        assert 'æ' in hl
        assert 'iː' not in hl


@pytest.mark.asyncio
class TestImportEndpoint:
    """整本原子性:一行不合格 → 整本不导"""

    async def test_一行坏音标让整本被拒(self, client, teacher_token):
        payload = {
            "book_name": "测试音标教材_原子性",
            "lessons": [{
                "code": "1—1", "title": "1—1 测试",
                "rows": [
                    {"word": "bad", "phonetic": "[bæd]"},
                    {"word": "broken", "phonetic": "[bæd☃]"},   # 这行坏
                ],
            }],
        }
        r = await client.post("/api/v1/teacher/phonetic-books/books/import",
                              json=payload,
                              headers={"Authorization": f"Bearer {teacher_token}"})
        assert r.status_code == 400
        # 确认一本都没建
        lst = await client.get("/api/v1/teacher/phonetic-books/books",
                               headers={"Authorization": f"Bearer {teacher_token}"})
        names = [b["name"] for b in lst.json()]
        assert "测试音标教材_原子性" not in names

    async def test_校验先行返回错误清单而不写库(self, client, teacher_token):
        payload = {
            "book_name": "测试音标教材_校验",
            "lessons": [{
                "code": "1—1", "title": "1—1 测试",
                "rows": [{"word": "psst", "phonetic": "[pst]"}],
            }],
        }
        r = await client.post("/api/v1/teacher/phonetic-books/books/validate",
                              json=payload,
                              headers={"Authorization": f"Bearer {teacher_token}"})
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is False
        assert len(body["errors"]) == 1
        assert body["errors"][0]["word"] == "psst"

    async def test_同名不加replace要409(self, client, teacher_token):
        payload = {
            "book_name": "测试音标教材_同名",
            "lessons": [{
                "code": "1—1", "title": "1—1 测试",
                "rows": [{"word": "bad", "phonetic": "[bæd]"}],
            }],
        }
        h = {"Authorization": f"Bearer {teacher_token}"}
        r1 = await client.post("/api/v1/teacher/phonetic-books/books/import",
                               json=payload, headers=h)
        assert r1.status_code == 200
        r2 = await client.post("/api/v1/teacher/phonetic-books/books/import",
                               json=payload, headers=h)
        assert r2.status_code == 409
        # 加了 replace 就该成功
        payload["replace"] = True
        r3 = await client.post("/api/v1/teacher/phonetic-books/books/import",
                               json=payload, headers=h)
        assert r3.status_code == 200
        assert r3.json()["replaced"] is True

    async def test_两个sheet撞同一编号要在校验就拦住(self, client, teacher_token):
        """phonetic_lessons 有 UniqueConstraint(book_id, code)。

        前端 codeOf() 只取 sheet 名的数字前缀,「1—1 拼读」和「1—1 复习」
        会切出同一个 1—1。不在校验拦 → 写库时 IntegrityError → 老师只看到
        「Internal Server Error」,完全不知道是两个表撞了编号。
        """
        payload = {
            "book_name": "测试音标教材_撞码",
            "lessons": [
                {"code": "1—1", "title": "1—1 拼读",
                 "rows": [{"word": "bad", "phonetic": "[bæd]"}]},
                {"code": "1—1", "title": "1—1 复习",
                 "rows": [{"word": "cab", "phonetic": "[kæb]"}]},
            ],
        }
        h = {"Authorization": f"Bearer {teacher_token}"}
        r = await client.post("/api/v1/teacher/phonetic-books/books/validate",
                              json=payload, headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is False, "撞码必须校验不通过"
        assert any("编号" in e["reason"] for e in body["errors"])
        # 导入必须是 400(说明白哪里错),不能是 500
        r2 = await client.post("/api/v1/teacher/phonetic-books/books/import",
                               json=payload, headers=h)
        assert r2.status_code == 400, f"撞码应 400,实际 {r2.status_code}"
