"""统一错误类型与异常处理器（对应 design/api.md 错误码规范）。"""

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.deps import get_request_id


class AppError(Exception):
    def __init__(self, code: int, message: str, http_status: int = 400, retriable: bool = False):
        self.code = code
        self.message = message
        self.http_status = http_status
        self.retriable = retriable
        super().__init__(message)


class NotFound(AppError):
    def __init__(self, message: str = "资源不存在"):
        super().__init__(10004, message, http_status=404)


class Forbidden(AppError):
    def __init__(self, message: str = "无权限访问"):
        super().__init__(10003, message, http_status=403)


class Conflict(AppError):
    def __init__(self, message: str = "资源冲突"):
        super().__init__(10009, message, http_status=409)


def _envelope(code: int, message: str, request_id: str | None, **extra) -> dict:
    return {
        "code": code,
        "message": message,
        "data": extra or None,
        "request_id": request_id,
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.http_status,
            content=_envelope(
                exc.code, exc.message, get_request_id(request), retriable=exc.retriable
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=jsonable_encoder(
                _envelope(
                    10001,
                    "参数校验失败",
                    get_request_id(request),
                    errors=exc.errors(),
                )
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_handler(request: Request, exc: StarletteHTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            code = detail.get("code", exc.status_code)
            message = detail.get("message", "error")
            extra = {k: v for k, v in detail.items() if k not in {"code", "message"}}
        else:
            code = exc.status_code
            message = str(detail)
            extra = {}
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(code, message, get_request_id(request), **extra),
        )
