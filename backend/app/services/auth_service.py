"""
认证服务 - 处理密码加密、JWT生成等
"""
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.models.user import User
from app.core.config import settings

# 密码加密上下文
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """生成密码哈希"""
    return pwd_context.hash(password)

def generate_random_password(length: int = 12) -> str:
    """生成随机密码。排除易混淆字符(0/O、1/l/I):初始密码靠人工抄传,混淆字符是登录失败重灾区"""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """创建JWT token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=7)  # 默认7天

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")
    return encoded_jwt


async def issue_session_token(db: AsyncSession, user: User) -> str:
    """
    登录发 token 的统一入口(顶号机制)。

    范围: 学生一律顶号;体验机构(plan=trial)老师/机构管理员也顶号——
    体验账号发出去就是明文流传,一号多人同时在线是白嫖主通道。
    正式机构老师/管理员/平台admin/家长不顶(手机电脑双开是正常用法),
    token 不带 sv,认证侧自然跳过校验。

    机制: 范围内每次登录 session_ver+1 写库,并把新值放进 JWT 的 sv;
    认证时 sv != 库值 → 401 SESSION_KICKED(后登录踢先登录)。
    调用方无需再 commit(这里连同 last_login 等未提交改动一起落库)。
    """
    in_scope = user.role == "student"
    if not in_scope and user.role in ("teacher", "org_admin"):
        from sqlalchemy import text
        plan = (await db.execute(
            text("SELECT plan FROM organizations WHERE id = :i"), {"i": user.org_id}
        )).scalar()
        in_scope = plan == "trial"

    if in_scope:
        user.session_ver = (user.session_ver or 0) + 1
        await db.commit()
        return create_access_token(
            {"sub": str(user.id), "username": user.username, "sv": user.session_ver}
        )
    await db.commit()
    return create_access_token({"sub": str(user.id), "username": user.username})

class AuthFailure(Exception):
    """登录失败的细分原因（前端按 code 显示对应文案与跳转链接）"""
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail


async def authenticate_user(db: AsyncSession, username: str, password: str) -> Optional[User]:
    """
    验证用户 — 兼容旧调用方，三种失败统一返 None。
    要细分原因，请用 authenticate_user_strict（会 raise AuthFailure）。
    """
    try:
        return await authenticate_user_strict(db, username, password)
    except AuthFailure:
        return None


def _password_ok(plain: str, hashed: Optional[str]) -> bool:
    try:
        return bool(hashed) and verify_password(plain, hashed)
    except ValueError:  # 认不出的哈希(脏数据)当作不匹配,别让一行坏数据挡住同号的其它账号
        return False


async def authenticate_user_strict(db: AsyncSession, username: str, password: str) -> User:
    """
    严格版：区分 user_not_found / wrong_password / inactive 三种失败。

    同一个手机号可能有两个账号: 孩子的学生号(注册时填的是家长手机)和家长号。
    原来 scalar_one_or_none() 碰到两行直接 500;现在逐个试密码 ——
    用户名精确匹配优先,学生/老师优先于家长(这个登录页本来是给学生老师的)。
    """
    stmt = select(User).where(
        or_(
            User.username == username,
            User.email == username,
            User.phone == username
        )
    ).limit(5)
    result = await db.execute(stmt)
    users = list(result.scalars().all())

    if not users:
        raise AuthFailure("user_not_found", "该账号不存在，请检查输入或先去注册")
    users.sort(key=lambda u: (u.username != username, u.role == "parent"))
    user = next((u for u in users if _password_ok(password, u.hashed_password)), None)
    if user is None:
        raise AuthFailure("wrong_password", "密码不正确，请重试或找回密码")
    if not user.is_active:
        raise AuthFailure("inactive", "账号已被禁用，请联系老师或管理员")
    return user

async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    """通过ID获取用户"""
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()

async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
    """通过用户名获取用户(username 全局唯一,查重/登录需跨机构,跳过租户过滤)"""
    stmt = select(User).where(User.username == username).execution_options(skip_tenant_filter=True)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()

async def get_user_by_phone(db: AsyncSession, phone: str) -> Optional[User]:
    """通过手机号找学生/老师账号(查重需跨机构,跳过租户过滤)。

    **不含家长号**: 家长号和孩子的学生号常是同一个手机号,两者并存是正常的。
    这里服务的是学生注册查重、短信登录、找回密码;家长号走 api/v1/parent.py。
    """
    stmt = (select(User).where(User.phone == phone, User.role != "parent")
            .execution_options(skip_tenant_filter=True).limit(1))
    result = await db.execute(stmt)
    return result.scalars().first()

async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """通过邮箱获取用户(email 全局唯一,查重需跨机构,跳过租户过滤)"""
    stmt = select(User).where(User.email == email).execution_options(skip_tenant_filter=True)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()

async def create_user(
    db: AsyncSession,
    username: str,
    email: str,
    password: str,
    full_name: Optional[str] = None,
    role: str = "student",
    phone: Optional[str] = None,
    org_id: Optional[int] = None,
) -> User:
    """创建新用户。org_id 不传时走表默认(1=直营)"""
    hashed_password = get_password_hash(password)

    user = User(
        username=username,
        email=email,
        hashed_password=hashed_password,
        full_name=full_name,
        role=role,
        phone=phone,
        is_active=True,
        **({"org_id": org_id} if org_id is not None else {}),
    )

    db.add(user)
    await db.commit()
    await db.refresh(user)

    return user


async def get_users_by_role(db: AsyncSession, role: str) -> list[User]:
    """根据角色获取用户列表"""
    stmt = select(User).where(User.role == role, User.is_active == True)
    result = await db.execute(stmt)
    return result.scalars().all()
