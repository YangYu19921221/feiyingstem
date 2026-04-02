from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    full_name: Optional[str] = None
    role: str = "student"

class UserLogin(BaseModel):
    """登录请求"""
    username: str = Field(..., description="用户名或邮箱")
    password: str = Field(..., min_length=6, description="密码")
    code: Optional[str] = Field(None, description="短信验证码")
    phone: Optional[str] = Field(None, description="手机号（用于验证码校验）")

class SendCodeRequest(BaseModel):
    """发送验证码请求"""
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    purpose: str = Field(..., description="用途: register、login 或 reset_password")

class UserRegister(BaseModel):
    """手机号注册请求"""
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    username: str = Field(..., min_length=3, max_length=50, description="用户名")
    password: str = Field(..., min_length=6, max_length=50, description="密码")
    code: str = Field(..., min_length=4, max_length=6, description="验证码")

class UserCreate(UserBase):
    """创建用户(管理员使用)"""
    password: str = Field(..., min_length=6, max_length=50)
    is_active: bool = True

class UserUpdate(BaseModel):
    """更新用户信息"""
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    password: Optional[str] = Field(None, min_length=6)
    role: Optional[str] = None
    is_active: Optional[bool] = None

class UserResponse(UserBase):
    """用户响应"""
    id: int
    is_active: bool
    avatar_url: Optional[str] = None
    phone: Optional[str] = None
    subscription_expires_at: Optional[datetime] = None
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True

class Token(BaseModel):
    """Token响应"""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

class TokenData(BaseModel):
    """Token数据"""
    username: Optional[str] = None
    user_id: Optional[int] = None

class ResetPasswordRequest(BaseModel):
    """忘记密码 - 通过手机验证码重置"""
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$", description="手机号")
    code: str = Field(..., min_length=4, max_length=6, description="验证码")
    new_password: str = Field(..., min_length=6, max_length=50, description="新密码")

class ChangePasswordRequest(BaseModel):
    """修改密码 - 已登录用户"""
    old_password: str = Field(..., description="旧密码")
    new_password: str = Field(..., min_length=6, max_length=50, description="新密码")
