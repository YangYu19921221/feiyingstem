"""视频上限三处串联的一致性守卫(2026-09-24)。

起因是生产的真实故障:nginx `client_max_body_size` 卡在 220m,一位老师把同一个
**242MB** 的视频连传了 4 次(19:12–19:14 的 error log),每次都只看到
「上传失败」四个字。根因是 nginx 的 413 **没有响应体** —— 后端那句
「视频超过 N MB 上限,请压缩后再传」压根没机会被发出来,因为请求到不了应用。

所以上限有三道,**串联,最小的那个说话**:

    前端预检(MAX_VIDEO_MB) <= 应用层(MAX_VIDEO_SIZE) <= nginx(client_max_body_size)

这个文件守前两道(第三道在 nginx 配置里,不在仓库,靠 config.py 的注释交接)。
两道之间的顺序不能反: 前端比后端**松**就等于没预检(仍会白传一场再失败);
前端比后端严一点是可以的,但没理由,所以直接要求相等。

照 test_pet_sprites / test_phonetic_lecturer 的做法**正则解析 .ts,不维护 Python
副本** —— 副本一漂移,测试还会照旧全绿。
"""
import re
from pathlib import Path

import pytest

from app.core.config import settings

TS = (Path(__file__).resolve().parents[2]
      / "frontend" / "src" / "api" / "phonetics.ts")

MB = 1024 * 1024


def _frontend_max_mb() -> int:
    src = TS.read_text(encoding="utf-8")
    m = re.search(r"export const MAX_VIDEO_MB = (\d+);", src)
    assert m, (
        "前端 api/phonetics.ts 里找不到 MAX_VIDEO_MB —— "
        "改名了就同步这个测试,别把守卫留在原地空转"
    )
    return int(m.group(1))


def test_frontend_precheck_matches_backend_limit():
    """前端预检值必须与 MAX_VIDEO_SIZE 同值。

    不一致的两种后果不对称:
    - 前端**松**(比如前端 500 / 后端 200): 预检放过去 → 老师等着传完 300MB
      才被应用层拒,预检等于没写
    - 前端**紧**: 后端永远拿不到大文件,上限调整会静默失效
    """
    assert settings.MAX_VIDEO_SIZE % MB == 0, (
        f"MAX_VIDEO_SIZE={settings.MAX_VIDEO_SIZE} 不是整数 MB,"
        "改成 N * 1024 * 1024 的写法,否则和前端按 MB 的预检对不齐"
    )
    backend_mb = settings.MAX_VIDEO_SIZE // MB
    assert _frontend_max_mb() == backend_mb, (
        f"前端预检 {_frontend_max_mb()}MB vs 后端 {backend_mb}MB —— "
        "前端松了预检就等于没写(老师白传一场),紧了上限调整会静默失效"
    )


def test_backend_limit_leaves_room_under_nginx():
    """应用层上限必须**小于** nginx 那道,给 multipart 开销留余量。

    nginx 现为 520m(见 config.py 注释与 vhost 的 `location ^~ /api/`)。
    这里只能守住"别把应用层调到 >= nginx",真值的对账靠部署时看 vhost。
    留余量的理由: multipart 请求体 = 文件字节 + 边界串 + 各表单字段
    (title/description/lecturer 等),比文件本身大一点。
    """
    NGINX_LIMIT_MB = 520  # 与 vhost 的 client_max_body_size 同值
    backend_mb = settings.MAX_VIDEO_SIZE // MB
    assert backend_mb < NGINX_LIMIT_MB, (
        f"应用层 {backend_mb}MB >= nginx {NGINX_LIMIT_MB}MB —— "
        "超出的部分会被 nginx 以无响应体的 413 拒掉,"
        "后端那句人话提示永远发不出去"
    )


def test_error_message_states_the_actual_limit():
    """应用层拒绝时那句话里的数字必须是**当前**上限,不能写死。

    端点用的是 f-string 按 settings 算(`limit // (1024 * 1024)`),
    这里锁住"上限改了提示语跟着改" —— 写死 200 的话老师会按错的数字去压缩。
    """
    src = (Path(__file__).resolve().parents[1]
           / "app" / "api" / "v1" / "teacher" / "phonetics.py"
           ).read_text(encoding="utf-8")
    assert "f\"视频超过 {limit // (1024 * 1024)}MB 上限" in src, (
        "视频超限提示语不再按 settings 动态算 —— "
        "写死的数字会在上限调整后骗老师按错的值压缩"
    )


@pytest.mark.parametrize("size_mb,allowed", [
    (113, True),   # 生产现有最大的视频
    (242, True),   # 曾被 nginx 220m 拒掉 4 次的那个
    (499, True),
    (501, False),
    (616, False),  # 另一位老师那个,现在会拿到**人话提示**而不是静默 413
])
def test_real_world_sizes_land_on_the_intended_side(size_mb, allowed):
    """拿生产 error log 里的真实字节数当样本,锁住边界的方向。"""
    assert (size_mb * MB <= settings.MAX_VIDEO_SIZE) is allowed
