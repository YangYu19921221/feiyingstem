"""
认证API
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError, jwt

from app.core.database import get_db
from app.core.config import settings
from app.schemas.user import UserLogin, UserResponse, Token, UserCreate, TokenData, SendCodeRequest, UserRegister
from app.services import auth_service
from app.services.sms_service import code_store, send_sms_code
from app.models.user import User

router = APIRouter()

# OAuth2密码流
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

async def _authenticate_token(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """内部：验证token并返回用户，不检查订阅"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = await auth_service.get_user_by_id(db, user_id=int(user_id))
    if user is None:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(status_code=400, detail="用户已被禁用")

    return user


async def get_current_user_no_sub_check(
    user: User = Depends(_authenticate_token),
) -> User:
    """获取当前用户，不检查订阅状态（用于兑换和状态查询接口）"""
    return user


async def get_current_user(
    user: User = Depends(_authenticate_token),
) -> User:
    """获取当前登录用户（学生需检查订阅）"""
    if user.role == "student":
        now = datetime.utcnow()
        if not user.subscription_expires_at or user.subscription_expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="subscription_expired",
            )
    return user

async def get_current_teacher(
    current_user: User = Depends(get_current_user)
) -> User:
    """获取当前登录的教师用户"""
    if current_user.role not in ["teacher", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要教师权限"
        )
    return current_user

async def get_current_student(
    current_user: User = Depends(get_current_user)
) -> User:
    """获取当前登录的学生用户"""
    if current_user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要学生权限"
        )
    return current_user

async def get_current_admin(
    current_user: User = Depends(get_current_user)
) -> User:
    """获取当前登录的管理员用户"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


def require_role(*allowed_roles: str):
    """
    角色权限检查依赖工厂
    用法: Depends(require_role("teacher", "admin"))
    """
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要以下角色之一: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker

@router.post("/send-code")
async def send_verification_code(
    data: SendCodeRequest,
    db: AsyncSession = Depends(get_db)
):
    """发送短信验证码（公开接口）"""
    # 检查是否可以发送
    can, msg = code_store.can_send(data.phone)
    if not can:
        raise HTTPException(status_code=429, detail=msg)

    if data.purpose == "register":
        # 注册时检查手机号是否已被使用
        existing = await auth_service.get_user_by_phone(db, data.phone)
        if existing:
            raise HTTPException(status_code=400, detail="该手机号已注册")
    elif data.purpose == "login":
        # 登录时检查手机号是否存在
        existing = await auth_service.get_user_by_phone(db, data.phone)
        if not existing:
            raise HTTPException(status_code=400, detail="该手机号未注册")

    # 生成并发送验证码
    code = code_store.generate_and_store(data.phone)
    success = await send_sms_code(data.phone, code)

    if not success:
        raise HTTPException(status_code=500, detail="短信发送失败，请稍后重试")

    return {"message": "验证码已发送"}


@router.post("/register", response_model=Token)
async def register(
    data: UserRegister,
    db: AsyncSession = Depends(get_db)
):
    """手机号注册（公开接口）"""
    # 校验验证码
    ok, msg = code_store.verify(data.phone, data.code)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    # 检查用户名是否已存在
    existing = await auth_service.get_user_by_username(db, data.username)
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 检查手机号是否已注册
    existing_phone = await auth_service.get_user_by_phone(db, data.phone)
    if existing_phone:
        raise HTTPException(status_code=400, detail="该手机号已注册")

    # 创建用户（用手机号生成默认邮箱）
    user = await auth_service.create_user(
        db=db,
        username=data.username,
        email=f"{data.phone}@phone.local",
        password=data.password,
        phone=data.phone,
        role="student"
    )

    # 自动登录，生成 token
    access_token = auth_service.create_access_token(
        data={"sub": str(user.id), "username": user.username}
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """
    用户登录
    - 支持用户名或邮箱登录
    - 返回JWT token
    """
    user = await auth_service.authenticate_user(
        db,
        username=form_data.username,
        password=form_data.password
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 更新最后登录时间
    user.last_login = datetime.utcnow()
    await db.commit()

    # 生成token
    access_token = auth_service.create_access_token(
        data={"sub": str(user.id), "username": user.username}
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }

@router.post("/login/json", response_model=Token)
async def login_json(
    login_data: UserLogin,
    db: AsyncSession = Depends(get_db)
):
    """
    用户登录 (JSON格式)
    - 支持用户名、邮箱或手机号登录
    - 如果提供了 phone 和 code，则校验验证码
    - 返回JWT token
    """
    user = await auth_service.authenticate_user(
        db,
        username=login_data.username,
        password=login_data.password
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    # 如果提供了手机号和验证码，校验验证码
    if login_data.phone and login_data.code:
        ok, msg = code_store.verify(login_data.phone, login_data.code)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)

    # 更新最后登录时间
    user.last_login = datetime.utcnow()
    await db.commit()

    # 生成token
    access_token = auth_service.create_access_token(
        data={"sub": str(user.id), "username": user.username}
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    return current_user

@router.post("/users", response_model=UserResponse)
async def create_user_by_admin(
    user_data: UserCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    创建用户(管理员功能)
    """
    # 检查权限
    if current_user.role not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="权限不足")

    # 检查用户名是否已存在
    existing_user = await auth_service.get_user_by_username(db, user_data.username)
    if existing_user:
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 创建用户
    user = await auth_service.create_user(
        db=db,
        username=user_data.username,
        email=user_data.email,
        password=user_data.password,
        full_name=user_data.full_name,
        role=user_data.role
    )

    return user


@router.get("/students", response_model=list[UserResponse])
async def get_students(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取所有学生列表(教师/管理员功能)
    """
    # 检查权限
    if current_user.role not in ["admin", "teacher"]:
        raise HTTPException(status_code=403, detail="权限不足")

    # 获取所有学生
    students = await auth_service.get_users_by_role(db, role="student")
    return students
