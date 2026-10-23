from collections.abc import AsyncIterator
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.security import hash_master_access_key
from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture
def client() -> AsyncIterator[TestClient]:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    async def create_tables() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def drop_tables() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    import asyncio

    asyncio.run(create_tables())
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    asyncio.run(drop_tables())


def test_signup_login_me_and_logout(client: TestClient) -> None:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "person@example.com",
            "display_name": "Brown User",
            "password": "very-safe-password",
            "password_confirm": "very-safe-password",
        },
    )

    assert signup.status_code == 201
    assert signup.json()["user"]["email"] == "person@example.com"
    assert "brown_chat_session" in signup.cookies
    assert client.get("/api/v1/auth/me").status_code == 200

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "person@example.com", "password": "very-safe-password"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["display_name"] == "Brown User"


def test_duplicate_email_is_rejected(client: TestClient) -> None:
    payload = {
        "email": "duplicate@example.com",
        "display_name": "First User",
        "password": "very-safe-password",
        "password_confirm": "very-safe-password",
    }
    assert client.post("/api/v1/auth/signup", json=payload).status_code == 201
    assert client.post("/api/v1/auth/signup", json=payload).status_code == 409


def test_master_key_creates_isolated_persistent_guest(client: TestClient, monkeypatch) -> None:
    access_key = "test-master-key-123456"
    monkeypatch.setattr(settings, "master_access_key_hash", hash_master_access_key(access_key))

    rejected = client.post("/api/v1/auth/master-login", json={"access_key": "wrong-key-123"})
    assert rejected.status_code == 401

    first_login = client.post("/api/v1/auth/master-login", json={"access_key": access_key})
    assert first_login.status_code == 200
    first_user = first_login.json()["user"]
    assert first_user["auth_provider"] == "master_guest"
    assert settings.master_guest_cookie_name in first_login.cookies

    assert client.post("/api/v1/auth/logout").status_code == 204
    second_login = client.post("/api/v1/auth/master-login", json={"access_key": access_key})
    assert second_login.status_code == 200
    assert second_login.json()["user"]["id"] == first_user["id"]


def test_kakao_oauth_forces_reauthentication(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "kakao_client_id", "test-client-id")
    monkeypatch.setattr(settings, "kakao_client_secret", "test-client-secret")

    response = client.get(
        "/api/v1/auth/oauth/kakao",
        params={"next": "/chat?prompt=landing-question"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["prompt"] == ["login"]
    assert response.cookies["brown_chat_kakao_oauth_next"].strip('"') == (
        "/chat?prompt=landing-question"
    )


def test_chat_session_is_created_before_generation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.post(
        "/api/v1/auth/signup",
        json={
            "email": "chat@example.com",
            "display_name": "Chat User",
            "password": "very-safe-password",
            "password_confirm": "very-safe-password",
        },
    )
    monkeypatch.setattr(settings, "chat_api_base_url", "")
    monkeypatch.setattr(settings, "chat_api_model", "")

    created = client.post("/api/v1/chat/sessions", json={"input": "첫 질문입니다."})

    assert created.status_code == 201
    session = created.json()
    assert session["title"] == "첫 질문입니다."
    assert session["messages"][0]["role"] == "user"
    assert session["messages"][0]["content"] == "첫 질문입니다."
    assert client.get(f"/api/v1/chat/sessions/{session['id']}").status_code == 200
    assert len(client.get("/api/v1/chat/sessions").json()) == 1

    generation = client.post(f"/api/v1/chat/sessions/{session['id']}/generate")
    assert generation.status_code == 503
    assert "CHAT_API_BASE_URL" in generation.json()["detail"]


def test_interrupted_output_is_saved_as_assistant_context(client: TestClient) -> None:
    client.post(
        "/api/v1/auth/signup",
        json={
            "email": "interrupted@example.com",
            "display_name": "Interrupted User",
            "password": "very-safe-password",
            "password_confirm": "very-safe-password",
        },
    )
    created = client.post("/api/v1/chat/sessions", json={"input": "100까지 세어줘"})
    session_id = created.json()["id"]

    interrupted = client.post(
        f"/api/v1/chat/sessions/{session_id}/messages/interrupted",
        json={"output": "1, 2, 3, 4, 5"},
    )

    assert interrupted.status_code == 201
    assert interrupted.json()["role"] == "assistant"
    assert interrupted.json()["content"] == "1, 2, 3, 4, 5"
    assert interrupted.json()["is_interrupted"] is True
