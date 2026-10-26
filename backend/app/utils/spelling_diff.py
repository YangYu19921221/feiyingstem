"""拼写错误的「第一处差异块」(believe 写成 beleive → ('ie', 'ei'))。

错题诊断(api/v1/student/learning_records.get_spelling_diagnosis)和学习助手的学情档案(services/tutor_profile)共用这一份,
两边各写一份就会出现「诊断页说你总把 ie 写反,小鹰老师却不知道」。
"""


def first_diff_chunk(expect: str, got: str) -> tuple | None:
    """找出第一处差异的字符块(前后各扩1个字符做上下文),如 believe/beleive → ('ie','ei')。
    简单双指针,不做完整编辑距离——诊断要的是'哪一小块写错',不是精确对齐。"""
    # 掐头
    i = 0
    while i < len(expect) and i < len(got) and expect[i] == got[i]:
        i += 1
    # 去尾
    j_e, j_g = len(expect), len(got)
    while j_e > i and j_g > i and expect[j_e - 1] == got[j_g - 1]:
        j_e -= 1
        j_g -= 1
    exp_chunk, got_chunk = expect[i:j_e], got[i:j_g]
    if not exp_chunk and not got_chunk:
        return None
    # 差异块太长说明整词写错(不是局部混淆),不计入模式
    if len(exp_chunk) > 4 or len(got_chunk) > 4:
        return None
    return (exp_chunk or "(漏写)", got_chunk or "(多写)")
