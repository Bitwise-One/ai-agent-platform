"""安全：API Key 哈希、签名令牌、上下文字段校验。

原则（PRD §4.13.2 / §5.3）：API Key 只存哈希，明文只在创建时返回一次。
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from dataclasses import dataclass

from app.core.config import get_settings


def hash_api_key(raw_key: str) -> str:
    """API Key 单向哈希（SHA-256），入库只存此值。"""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """生成 API Key。返回 (明文, 哈希, 展示前缀)。"""
    settings = get_settings()
    raw = f"{settings.api_key_prefix}_{secrets.token_urlsafe(32)}"
    return raw, hash_api_key(raw), raw[:12]


# --------------------------------------------------------------------------
# 轻量签名令牌：HMAC-SHA256，避免为 M1 引入额外 JWT 依赖。
# 生产可替换为正式 JWT/OIDC 实现，接口不变。
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class TokenClaims:
    subject: str
    tenant_id: str
    app_id: str | None
    exp: int


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload: bytes, secret: str) -> str:
    return _b64e(hmac.new(secret.encode(), payload, hashlib.sha256).digest())


def issue_token(
    subject: str,
    tenant_id: str,
    app_id: str | None = None,
    ttl_seconds: int = 3600,
) -> str:
    """签发令牌（C 端/管理台用户身份）。"""
    settings = get_settings()
    claims = {
        "sub": subject,
        "tid": tenant_id,
        "aid": app_id,
        "exp": int(time.time()) + ttl_seconds,
        "jti": uuid.uuid4().hex,
    }
    body = _b64e(json.dumps(claims, separators=(",", ":")).encode())
    return f"{body}.{_sign(body.encode(), settings.secret_key)}"


class TokenError(Exception):
    pass


def verify_token(token: str) -> TokenClaims:
    settings = get_settings()
    try:
        body, signature = token.split(".", 1)
    except ValueError as exc:
        raise TokenError("malformed token") from exc

    expected = _sign(body.encode(), settings.secret_key)
    if not hmac.compare_digest(signature, expected):
        raise TokenError("bad signature")

    try:
        claims = json.loads(_b64d(body))
    except (ValueError, json.JSONDecodeError) as exc:
        raise TokenError("bad payload") from exc

    if int(claims.get("exp", 0)) < int(time.time()):
        raise TokenError("expired")

    return TokenClaims(
        subject=claims["sub"],
        tenant_id=claims["tid"],
        app_id=claims.get("aid"),
        exp=int(claims["exp"]),
    )
