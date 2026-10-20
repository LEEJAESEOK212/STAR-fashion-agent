import secrets
from typing import Annotated, Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DatabaseSession
from app.core.config import settings
from app.core.security import (
    create_access_token,
    hash_master_access_key,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    MasterLoginRequest,
    SignUpRequest,
    UserResponse,
)

router = APIRouter()
KAKAO_OAUTH_STATE_COOKIE = "brown_chat_kakao_oauth_state"
KAKAO_OAUTH_NEXT_COOKIE = "brown_chat_kakao_oauth_next"


def safe_frontend_path(value: str | None) -> str:
    if value and value.startswith("/") and not value.startswith("//"):
        return value
    return "/chat"


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignUpRequest, response: Response, db: DatabaseSession) -> AuthResponse:
    email = payload.email.lower()
    existing_user = await db.scalar(select(User).where(User.email == email))
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 가입된 이메일입니다.",
        )

    user = User(
        email=email,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        auth_provider="local",
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="이미 가입된 이메일입니다."
        ) from error

    await db.refresh(user)
    set_auth_cookie(response, create_access_token(user.id))
    return AuthResponse(
        user=UserResponse.model_validate(user),
        message="회원가입이 완료되었습니다.",
    )


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, response: Response, db: DatabaseSession) -> AuthResponse:
    user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if (
        user is None
        or user.password_hash is None
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다.",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 계정입니다.")

    set_auth_cookie(response, create_access_token(user.id))
    return AuthResponse(user=UserResponse.model_validate(user), message="로그인되었습니다.")


@router.post("/master-login", response_model=AuthResponse)
async def master_login(
    payload: MasterLoginRequest,
    response: Response,
    db: DatabaseSession,
    guest_device: Annotated[
        str | None, Cookie(alias=settings.master_guest_cookie_name)
    ] = None,
) -> AuthResponse:
    if not settings.master_access_key_hash:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="마스터키 입장이 아직 설정되지 않았습니다.",
        )
    candidate_hash = hash_master_access_key(payload.access_key)
    if not secrets.compare_digest(candidate_hash, settings.master_access_key_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="마스터키가 올바르지 않습니다.",
        )

    device_token = guest_device if guest_device and len(guest_device) <= 128 else None
    if device_token is None:
        device_token = secrets.token_urlsafe(32)
    provider_user_id = hash_master_access_key(device_token)
    user = await db.scalar(
        select(User).where(
            User.auth_provider == "master_guest",
            User.provider_user_id == provider_user_id,
        )
    )
    if user is None:
        user = User(
            display_name=f"게스트 {provider_user_id[:6].upper()}",
            auth_provider="master_guest",
            provider_user_id=provider_user_id,
        )
        db.add(user)
        try:
            await db.commit()
            await db.refresh(user)
        except IntegrityError:
            await db.rollback()
            user = await db.scalar(
                select(User).where(
                    User.auth_provider == "master_guest",
                    User.provider_user_id == provider_user_id,
                )
            )
            if user is None:
                raise

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 계정입니다.")
    set_auth_cookie(response, create_access_token(user.id))
    response.set_cookie(
        key=settings.master_guest_cookie_name,
        value=device_token,
        max_age=settings.master_guest_cookie_max_age_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )
    return AuthResponse(
        user=UserResponse.model_validate(user),
        message="마스터키로 입장했습니다.",
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth_cookie_name,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def oauth_error_redirect(message: str) -> RedirectResponse:
    query = urlencode({"oauth_error": message})
    response = RedirectResponse(url=f"{settings.frontend_url}/signin?{query}", status_code=302)
    response.delete_cookie(KAKAO_OAUTH_STATE_COOKIE, path="/")
    response.delete_cookie(KAKAO_OAUTH_NEXT_COOKIE, path="/")
    return response


@router.get("/oauth/kakao")
async def kakao_oauth_start(
    next_path: Annotated[str | None, Query(alias="next")] = None,
) -> RedirectResponse:
    if not settings.kakao_client_id or not settings.kakao_client_secret:
        return oauth_error_redirect("카카오 로그인 설정이 완료되지 않았습니다.")

    state = secrets.token_urlsafe(32)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.kakao_client_id,
            "redirect_uri": settings.kakao_redirect_uri,
            "state": state,
            "prompt": "login",
        }
    )
    response = RedirectResponse(
        url=f"https://kauth.kakao.com/oauth/authorize?{query}",
        status_code=302,
    )
    response.set_cookie(
        key=KAKAO_OAUTH_STATE_COOKIE,
        value=state,
        max_age=600,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key=KAKAO_OAUTH_NEXT_COOKIE,
        value=safe_frontend_path(next_path),
        max_age=600,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/oauth/kakao/callback")
async def kakao_oauth_callback(
    db: DatabaseSession,
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
    saved_state: Annotated[str | None, Cookie(alias=KAKAO_OAUTH_STATE_COOKIE)] = None,
    saved_next_path: Annotated[str | None, Cookie(alias=KAKAO_OAUTH_NEXT_COOKIE)] = None,
) -> RedirectResponse:
    if error:
        return oauth_error_redirect("카카오 로그인이 취소되었습니다.")
    if not code or not state or not saved_state or not secrets.compare_digest(state, saved_state):
        return oauth_error_redirect(
            "카카오 로그인 요청이 만료되었습니다. 카카오 로그인 버튼을 다시 눌러주세요."
        )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_response = await client.post(
                "https://kauth.kakao.com/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.kakao_client_id,
                    "client_secret": settings.kakao_client_secret,
                    "redirect_uri": settings.kakao_redirect_uri,
                    "code": code,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]

            profile_response = await client.get(
                "https://kapi.kakao.com/v2/user/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            profile_response.raise_for_status()
            profile = profile_response.json()
    except (httpx.HTTPError, KeyError, ValueError):
        return oauth_error_redirect("카카오 사용자 정보를 가져오지 못했습니다.")

    if "id" not in profile:
        return oauth_error_redirect("카카오 사용자 식별자를 확인하지 못했습니다.")
    provider_user_id = str(profile["id"])
    account = profile.get("kakao_account") or {}
    kakao_profile = account.get("profile") or {}
    email = account.get("email")
    display_name = kakao_profile.get("nickname") or "카카오 사용자"

    user = await db.scalar(
        select(User).where(
            User.auth_provider == "kakao",
            User.provider_user_id == provider_user_id,
        )
    )
    if user is None and email and account.get("is_email_verified"):
        user = await db.scalar(select(User).where(User.email == email.lower()))

    if user is None:
        user = User(
            email=email.lower() if email else None,
            display_name=display_name,
            auth_provider="kakao",
            provider_user_id=provider_user_id,
        )
        db.add(user)
    else:
        user.display_name = display_name
        user.auth_provider = "kakao"
        user.provider_user_id = provider_user_id
        if email:
            user.email = email.lower()

    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        return oauth_error_redirect("이미 다른 계정에 연결된 카카오 계정입니다.")

    response = RedirectResponse(
        url=f"{settings.frontend_url}{safe_frontend_path(saved_next_path)}",
        status_code=302,
    )
    set_auth_cookie(response, create_access_token(user.id))
    response.delete_cookie(KAKAO_OAUTH_STATE_COOKIE, path="/")
    response.delete_cookie(KAKAO_OAUTH_NEXT_COOKIE, path="/")
    return response


@router.get("/oauth/{provider}")
async def oauth_login(provider: Literal["google", "naver"]) -> None:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"{provider} OAuth 클라이언트 설정이 필요합니다. devel-QA.md를 확인해 주세요.",
    )
