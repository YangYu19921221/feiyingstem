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
    """验证码存储(2026-10-25 起放 core/shared_store: 多进程时发码和校验可能落在不同进程上,
    各存各的就会「刚收到的码说已过期」)。没配 Redis 时退回进程内存 = 原来的行为。

    键: sms:code:{手机} = {"code","created_at"}(5 分钟过期)、sms:att:{手机} = 输错次数、
    sms:day:{北京日}:{手机} = 当天发了几条。"""

    CODE_TTL = 300          # 验证码 5 分钟有效
    RESEND_GAP = 60         # 同一手机号 60 秒内不重发
    DAILY_LIMIT = 10        # 每天最多 10 条
    MAX_ATTEMPTS = 5        # 输错 5 次作废

    @staticmethod
    def _day_key(phone: str) -> str:
        from app.core.timeutil import local_today
        return f"sms:day:{local_today().isoformat()}:{phone}"

    async def can_send(self, phone: str) -> tuple[bool, str]:
        """检查是否可以发送验证码"""
        from app.core.shared_store import store
        sent = await store.get(self._day_key(phone))
        if sent is not None and int(sent) >= self.DAILY_LIMIT:
            return False, "今日发送次数已达上限"
        rec = await store.get_json(f"sms:code:{phone}")
        if rec:
            elapsed = time.time() - float(rec.get("created_at") or 0)
            if elapsed < self.RESEND_GAP:
                return False, f"请{int(self.RESEND_GAP - elapsed)}秒后再试"
        return True, ""

    async def generate_and_store(self, phone: str) -> str:
        """生成并存储验证码(新码作废旧码,输错次数清零)"""
        from app.core.shared_store import store
        code = f"{random.SystemRandom().randint(100000, 999999)}"
        await store.set_json(f"sms:code:{phone}", {"code": code, "created_at": time.time()}, self.CODE_TTL)
        await store.delete(f"sms:att:{phone}")
        await store.incr(self._day_key(phone), 1, 2 * 86400)
        return code

    async def verify(self, phone: str, code: str) -> tuple[bool, str]:
        """校验验证码。成功即作废(删键看返回值: 两个请求同时拿对的码来,只有一个算数)"""
        from app.core.shared_store import store
        code_key, att_key = f"sms:code:{phone}", f"sms:att:{phone}"
        rec = await store.get_json(code_key)
        if not rec:
            return False, "验证码已过期或未发送"
        attempts = await store.get(att_key)
        if attempts is not None and int(attempts) >= self.MAX_ATTEMPTS:
            await store.delete(code_key)
            return False, "错误次数过多，请重新获取验证码"
        if rec.get("code") != code:
            await store.incr(att_key, 1, self.CODE_TTL)
            return False, "验证码错误"
        if not await store.delete(code_key):
            return False, "验证码已过期或未发送"
        await store.delete(att_key)
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
