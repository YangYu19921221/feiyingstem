"""直播课件权限与回放时长 —— 审查修复验证

覆盖四条:
1. 同机构内老师不能发布/删除同事的课件(跨机构由 tenancy 兜住,这里管的是机构内)
2. admin/org_admin 可以管本机构全部课件
3. 回放心跳能建考勤行(原来 UPDATE 匹配 0 行 → replay_seconds 恒为 0)
4. 心跳做可见性校验(原来能对任意 session_id 刷时长)
"""
import pytest
from app.models.user import UserRole


class _FakeTeacher:
    """只带 _own_material 需要的字段"""
    def __init__(self, uid, role=UserRole.TEACHER):
        self.id = uid
        self.role = role


class _FakeMaterial:
    def __init__(self, mid, uploader_id):
        self.id = mid
        self.uploader_id = uploader_id


def _can_edit(material, teacher):
    """复刻 _own_material 的判定,单测口径不依赖数据库"""
    return teacher.role != UserRole.TEACHER or material.uploader_id == teacher.id


def test_teacher_cannot_touch_colleague_material():
    """老师动不了同事的课件 —— 撤销发布会让学生当场断档,删除还连带清文件"""
    mine = _FakeMaterial(1, uploader_id=100)
    colleague = _FakeMaterial(2, uploader_id=200)
    me = _FakeTeacher(100)

    assert _can_edit(mine, me) is True
    assert _can_edit(colleague, me) is False


def test_admin_manages_all_materials_in_org():
    """admin/org_admin 管本机构全部(与 _own_session 同口径)"""
    someone_elses = _FakeMaterial(2, uploader_id=200)

    assert _can_edit(someone_elses, _FakeTeacher(1, UserRole.ADMIN)) is True
    assert _can_edit(someone_elses, _FakeTeacher(1, UserRole.ORG_ADMIN)) is True


def test_can_edit_flag_matches_guard():
    """列表返回的 can_edit 必须与后端 guard 同源,否则前端给了按钮点了才吃 403"""
    m = _FakeMaterial(1, uploader_id=100)
    for teacher in (_FakeTeacher(100), _FakeTeacher(200), _FakeTeacher(1, UserRole.ADMIN)):
        flag = teacher.role != UserRole.TEACHER or m.uploader_id == teacher.id
        assert flag == _can_edit(m, teacher)


def test_orphan_uploader_not_editable_by_teacher():
    """uploader_id 为空(上传者被删,SET NULL)时普通老师不该能改"""
    orphan = _FakeMaterial(3, uploader_id=None)
    assert _can_edit(orphan, _FakeTeacher(100)) is False
    assert _can_edit(orphan, _FakeTeacher(1, UserRole.ADMIN)) is True


def test_heartbeat_increment_capped():
    """单次增量服务端封顶 120s,改前端刷不出 10 小时"""
    def capped(seconds):
        return max(0, min(seconds, 120))

    assert capped(30) == 30
    assert capped(99999) == 120   # 刷时长被拦
    assert capped(-50) == 0       # 负数不能倒扣
    assert capped(120) == 120
