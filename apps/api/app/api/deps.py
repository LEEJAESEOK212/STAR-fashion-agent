from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User

DatabaseSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DatabaseSession,
    session_token: Annotated[str | None, Cookie(alias=settings.auth_cookie_name)] = None,
) -> User:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")

    user_id = decode_access_token(session_token)
    user = await db.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 세션입니다.",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
