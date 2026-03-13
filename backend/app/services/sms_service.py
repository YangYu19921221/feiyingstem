"""
短信验证码服务 - 腾讯云 SMS
"""
import random
import time
import logging
from typing import Optional, Dict
from app.core.config import settings

logger = logging.getLogger(__name__)


class VerificationCodeStore:
    """验证码内存缓存"""

    def __init__(self):
        # {phone: {"code": str, "created_at": float, "attempts": int}}
        self._codes: Dict[str, dict] = {}
        # {phone: [timestamp1, timestamp2, ...]} 每日发送记录
        self._daily_sends: Dict[str, list] = {}

    def _clean_expired(self, phone: str):
        """清理过期验证码"""
        if phone in self._codes:
            if time.time() - self._codes[phone]["created_at"] > 300:
                del self._codes[phone]

    def _get_daily_count(self, phone: str) -> int:
        """获取今日发送次数"""
        if phone not in self._daily_sends:
            return 0
        now = time.time()
        day_start = now - (now % 86400)
        self._daily_sends[phone] = [
            t for t in self._daily_sends[phone] if t >= day_start
        ]
        return len(self._daily_sends[phone])

    def can_send(self, phone: str) -> tuple[bool, str]:
        """检查是否可以发送验证码"""
        # 每日上限 10 条
        if self._get_daily_count(phone) >= 10:
            return False, "今日发送次数已达上限"

        # 60 秒发送间隔
        if phone in self._codes:
            elapsed = time.time() - self._codes[phone]["created_at"]
            if elapsed < 60:
                remaining = int(60 - elapsed)
                return False, f"请{remaining}秒后再试"

        return True, ""

    def generate_and_store(self, phone: str) -> str:
        """生成并存储验证码"""
        code = f"{random.randint(100000, 999999)}"
        self._codes[phone] = {
            "code": code,
            "created_at": time.time(),
            "attempts": 0,
        }
        # 记录发送
        if phone not in self._daily_sends:
            self._daily_sends[phone] = []
        self._daily_sends[phone].append(time.time())
        return code

    def verify(self, phone: str, code: str) -> tuple[bool, str]:
        """校验验证码"""
        self._clean_expired(phone)

        if phone not in self._codes:
            return False, "验证码已过期或未发送"

        record = self._codes[phone]

        # 5 次错误锁定
        if record["attempts"] >= 5:
            del self._codes[phone]
            return False, "错误次数过多，请重新获取验证码"

        if record["code"] != code:
            record["attempts"] += 1
            return False, "验证码错误"

        # 验证成功，删除记录
        del self._codes[phone]
        return True, ""


# 全局单例
code_store = VerificationCodeStore()


async def send_sms_code(phone: str, code: str) -> bool:
    """调用腾讯云 SMS SDK 发送验证码"""
    try:
        from tencentcloud.common import credential
        from tencentcloud.sms.v20210111 import sms_client, models

        cred = credential.Credential(
            settings.TENCENT_SMS_SECRET_ID,
            settings.TENCENT_SMS_SECRET_KEY,
        )
        client = sms_client.SmsClient(cred, "ap-guangzhou")

        req = models.SendSmsRequest()
        req.SmsSdkAppId = settings.TENCENT_SMS_APP_ID
        req.SignName = settings.TENCENT_SMS_SIGN_NAME
        req.TemplateId = settings.TENCENT_SMS_TEMPLATE_ID
        req.TemplateParamSet = [code, "5"]
        req.PhoneNumberSet = [f"+86{phone}"]

        resp = client.SendSms(req)
        status = resp.SendStatusSet[0]

        if status.Code == "Ok":
            logger.info(f"短信发送成功: {phone}")
            return True
        else:
            logger.error(f"短信发送失败: {status.Code} {status.Message}")
            return False

    except ImportError:
        # SDK 未安装时，开发模式下打印验证码
        logger.warning(f"[开发模式] 验证码: {phone} -> {code}")
        return True
    except Exception as e:
        logger.error(f"短信发送异常: {e}")
        return False
