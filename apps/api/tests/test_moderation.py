"""API tests for comment reporting and moderation (TDD)."""

import uuid
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit
from app.db.base import Base
from app.db.models.comment import Comment
from app.db.models.comment_report import CommentReport, ReportStatus
from app.db.models.user import User, UserRole
from app.db.session import get_db
from app.main import app
from tests.session_helpers import select_default

ME = "/api/v1/me"
ADMIN = "/api/v1/admin"


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "moderation.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with factory() as session:
            yield session

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ratelimit, "check_register_allowed", _noop)
    monkeypatch.setattr(ratelimit, "check_login_allowed", _noop)
    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield Env(client=ac, factory=factory)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def _register_login(env: Env, email: str, username: str) -> dict:
    r = await env.client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": "password123"},
    )
    assert r.status_code == 201, r.text
    r = await env.client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": "password123"},
    )
    assert r.status_code == 200, r.text
    token = await select_default(env.client, r.json()["access_token"])
    return {"Authorization": f"Bearer {token}"}


async def _promote(env: Env, username: str, role: UserRole) -> None:
    async with env.factory() as db:
        user = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one()
        user.role = role
        await db.commit()


async def _comment(
    env: Env, headers: dict, body: str = "hello", slug: str = "mao"
) -> str:
    r = await env.client.post(
        f"{ME}/comments",
        headers=headers,
        json={"movie_slug": slug, "body": body},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _report(env: Env, headers: dict, comment_id: str, reason="spam"):
    return await env.client.post(
        f"{ME}/reports",
        headers=headers,
        json={"comment_id": comment_id, "reason": reason},
    )


async def _report_rows(env: Env, comment_id: str) -> list[CommentReport]:
    async with env.factory() as db:
        stmt = select(CommentReport).where(
            CommentReport.comment_id == uuid.UUID(comment_id)
        )
        return list((await db.execute(stmt)).scalars().all())


async def test_create_report_then_duplicate(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    cid = await _comment(env, author)

    r = await _report(env, reporter, cid)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "open"
    assert uuid.UUID(body["id"])
    first_id = body["id"]

    r = await _report(env, reporter, cid)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == first_id

    rows = await _report_rows(env, cid)
    assert len(rows) == 1


async def test_re_report_already_hidden_returns_existing(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    other1 = await _register_login(env, "o1@gmov.dev", "other1")
    other2 = await _register_login(env, "o2@gmov.dev", "other2")
    cid = await _comment(env, author)

    r = await _report(env, reporter, cid)
    assert r.status_code == 201, r.text
    first_id = r.json()["id"]

    assert (await _report(env, other1, cid)).status_code == 201
    assert (await _report(env, other2, cid)).status_code == 201

    async with env.factory() as db:
        comment = await db.get(Comment, uuid.UUID(cid))
    assert comment is not None
    assert comment.is_hidden is True

    r = await _report(env, reporter, cid)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == first_id

    rows = await _report_rows(env, cid)
    assert len(rows) == 3


async def test_report_own_comment_rejected(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    cid = await _comment(env, author)

    r = await _report(env, author, cid)
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "CANNOT_REPORT_OWN"


async def test_report_hidden_comment_rejected(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    await _promote(env, "moderator", UserRole.MODERATOR)
    cid = await _comment(env, author)

    r = await env.client.post(f"{ADMIN}/comments/{cid}/hide", headers=moderator)
    assert r.status_code == 200, r.text

    r = await _report(env, reporter, cid)
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "COMMENT_HIDDEN"


async def test_report_unknown_comment_404(client_env):
    env = client_env
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    r = await _report(env, reporter, str(uuid.uuid4()))
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "COMMENT_NOT_FOUND"


async def test_auto_hide_threshold_distinct_reporters(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    r1 = await _register_login(env, "r1@gmov.dev", "reporter1")
    r2 = await _register_login(env, "r2@gmov.dev", "reporter2")
    r3 = await _register_login(env, "r3@gmov.dev", "reporter3")
    cid = await _comment(env, author)

    def list_item():
        return env.client.get("/api/v1/comments", params={"movie_slug": "mao"})

    assert (await _report(env, r1, cid)).status_code == 201
    item = (await list_item()).json()["items"][0]
    assert item["is_hidden"] is False
    assert item["body"] == "hello"

    # same user again does not count as another distinct reporter
    assert (await _report(env, r1, cid)).status_code == 200
    assert (await list_item()).json()["items"][0]["is_hidden"] is False

    assert (await _report(env, r2, cid)).status_code == 201
    assert (await list_item()).json()["items"][0]["is_hidden"] is False

    assert (await _report(env, r3, cid)).status_code == 201
    assert (await list_item()).json()["items"][0]["is_hidden"] is True

    async with env.factory() as db:
        comment = await db.get(Comment, uuid.UUID(cid))
    assert comment is not None
    assert comment.is_hidden is True


async def test_report_status_endpoint(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    other = await _register_login(env, "other@gmov.dev", "other")
    cid = await _comment(env, author)

    r = await env.client.get(f"{ME}/reports/{cid}/status", headers=reporter)
    assert r.status_code == 200, r.text
    assert r.json() == {"reported": False}

    await _report(env, reporter, cid)

    r = await env.client.get(f"{ME}/reports/{cid}/status", headers=reporter)
    assert r.json() == {"reported": True}
    r = await env.client.get(f"{ME}/reports/{cid}/status", headers=other)
    assert r.json() == {"reported": False}


async def test_comments_body_masking(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    user = await _register_login(env, "user@gmov.dev", "normal")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    admin = await _register_login(env, "admin@gmov.dev", "admin")
    await _promote(env, "moderator", UserRole.MODERATOR)
    await _promote(env, "admin", UserRole.ADMIN)

    cid = await _comment(env, author)
    r = await env.client.post(
        f"{ME}/comments",
        headers=author,
        json={"movie_slug": "mao", "body": "a reply", "parent_id": cid},
    )
    reply_id = r.json()["id"]

    await env.client.post(f"{ADMIN}/comments/{cid}/hide", headers=moderator)
    await env.client.post(f"{ADMIN}/comments/{reply_id}/hide", headers=moderator)

    def fetch(headers=None):
        return env.client.get(
            "/api/v1/comments", params={"movie_slug": "mao"}, headers=headers
        )

    anon = (await fetch()).json()["items"][0]
    assert anon["is_hidden"] is True
    assert anon["body"] is None
    assert anon["replies"][0]["is_hidden"] is True
    assert anon["replies"][0]["body"] is None

    normal = (await fetch(user)).json()["items"][0]
    assert normal["body"] is None

    mod = (await fetch(moderator)).json()["items"][0]
    assert mod["body"] == "hello"
    assert mod["replies"][0]["body"] == "a reply"

    adm = (await fetch(admin)).json()["items"][0]
    assert adm["body"] == "hello"


async def test_comments_invalid_token_is_anonymous(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    await _comment(env, author)
    r = await env.client.get(
        "/api/v1/comments",
        params={"movie_slug": "mao"},
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["total_items"] == 1


async def test_admin_reports_access_control(client_env):
    env = client_env
    user = await _register_login(env, "user@gmov.dev", "normal")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    admin = await _register_login(env, "admin@gmov.dev", "admin")
    await _promote(env, "moderator", UserRole.MODERATOR)
    await _promote(env, "admin", UserRole.ADMIN)

    r = await env.client.get(f"{ADMIN}/reports")
    assert r.status_code == 401, r.text

    r = await env.client.get(f"{ADMIN}/reports", headers=user)
    assert r.status_code == 403, r.text
    assert r.json()["code"] == "FORBIDDEN"

    r = await env.client.get(f"{ADMIN}/reports", headers=moderator)
    assert r.status_code == 200, r.text
    r = await env.client.get(f"{ADMIN}/reports", headers=admin)
    assert r.status_code == 200, r.text

    cid = await _comment(env, user)
    r = await env.client.post(f"{ADMIN}/comments/{cid}/hide", headers=user)
    assert r.status_code == 403
    r = await env.client.post(f"{ADMIN}/comments/{cid}/hide")
    assert r.status_code == 401


async def test_admin_reports_filter_and_shape(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    await _promote(env, "moderator", UserRole.MODERATOR)

    c1 = await _comment(env, author, body="first")
    c2 = await _comment(env, author, body="second", slug="other")
    report1_id = (await _report(env, reporter, c1, reason="spam")).json()["id"]
    report2_id = (
        await _report(env, reporter, c2, reason="harassment")
    ).json()["id"]

    r = await env.client.get(f"{ADMIN}/reports", headers=moderator)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_items"] == 2
    assert body["open_total"] == 2
    items = {item["id"]: item for item in body["items"]}

    first = items[report1_id]
    assert first["reason"] == "spam"
    assert first["note"] is None
    assert first["status"] == "open"
    assert first["reporter"]["username"] == "reporter"
    assert first["comment"]["movie_slug"] == "mao"
    assert first["comment"]["body"] == "first"
    assert first["comment"]["is_hidden"] is False

    second = items[report2_id]
    assert second["reason"] == "harassment"
    assert second["status"] == "open"
    assert second["comment"]["movie_slug"] == "other"
    assert second["comment"]["body"] == "second"

    await env.client.post(
        f"{ADMIN}/reports/{report2_id}/dismiss", headers=moderator
    )
    body = (await env.client.get(f"{ADMIN}/reports", headers=moderator)).json()
    assert body["total_items"] == 2
    assert body["open_total"] == 1

    body = (
        await env.client.get(
            f"{ADMIN}/reports?status=open", headers=moderator
        )
    ).json()
    assert body["total_items"] == 1
    assert body["open_total"] == 1
    assert body["items"][0]["id"] == report1_id
    assert body["items"][0]["status"] == "open"

    r = await env.client.get(
        f"{ADMIN}/reports?status=bogus", headers=moderator
    )
    assert r.status_code == 422, r.text


async def test_hide_resolves_open_reports_and_unhide_keeps_them(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    r1 = await _register_login(env, "r1@gmov.dev", "reporter1")
    r2 = await _register_login(env, "r2@gmov.dev", "reporter2")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    await _promote(env, "moderator", UserRole.MODERATOR)

    cid = await _comment(env, author)
    await _report(env, r1, cid)
    await _report(env, r2, cid)

    r = await env.client.post(f"{ADMIN}/comments/{cid}/hide", headers=moderator)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "is_hidden": True}

    rows = await _report_rows(env, cid)
    assert len(rows) == 2
    for row in rows:
        assert row.status == ReportStatus.RESOLVED
        assert row.resolved_by is not None
        assert row.resolved_at is not None

    async with env.factory() as db:
        mod = (
            await db.execute(
                select(User).where(User.username == "moderator")
            )
        ).scalar_one()
    for row in rows:
        assert row.resolved_by == mod.id

    r = await env.client.post(f"{ADMIN}/comments/{cid}/unhide", headers=moderator)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "is_hidden": False}

    rows = await _report_rows(env, cid)
    assert all(row.status == ReportStatus.RESOLVED for row in rows)

    r = await env.client.get(
        f"{ADMIN}/reports?status=open", headers=moderator
    )
    assert r.json()["open_total"] == 0


async def test_hide_unknown_comment_404(client_env):
    env = client_env
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    await _promote(env, "moderator", UserRole.MODERATOR)
    r = await env.client.post(
        f"{ADMIN}/comments/{uuid.uuid4()}/hide", headers=moderator
    )
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "COMMENT_NOT_FOUND"
    r = await env.client.post(
        f"{ADMIN}/comments/{uuid.uuid4()}/unhide", headers=moderator
    )
    assert r.status_code == 404, r.text


async def test_dismiss_idempotent_and_unknown(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    await _promote(env, "moderator", UserRole.MODERATOR)

    cid = await _comment(env, author)
    report_id = (await _report(env, reporter, cid)).json()["id"]

    r = await env.client.post(
        f"{ADMIN}/reports/{report_id}/dismiss", headers=moderator
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    async with env.factory() as db:
        row = await db.get(CommentReport, uuid.UUID(report_id))
        assert row.status == ReportStatus.DISMISSED
        assert row.resolved_by is not None
        assert row.resolved_at is not None
        first_resolved_at = row.resolved_at

    r = await env.client.post(
        f"{ADMIN}/reports/{report_id}/dismiss", headers=moderator
    )
    assert r.status_code == 200, r.text

    async with env.factory() as db:
        row = await db.get(CommentReport, uuid.UUID(report_id))
        assert row.status == ReportStatus.DISMISSED
        assert row.resolved_at == first_resolved_at

    r = await env.client.post(
        f"{ADMIN}/reports/{uuid.uuid4()}/dismiss", headers=moderator
    )
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "REPORT_NOT_FOUND"


async def test_reports_require_auth(client_env):
    env = client_env
    r = await env.client.post(
        f"{ME}/reports", json={"comment_id": str(uuid.uuid4()), "reason": "spam"}
    )
    assert r.status_code == 401
    r = await env.client.get(f"{ME}/reports/{uuid.uuid4()}/status")
    assert r.status_code == 401


async def test_report_invalid_reason_422(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    cid = await _comment(env, author)
    r = await _report(env, reporter, cid, reason="wizard")
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "VALIDATION_ERROR"


async def test_auto_hidden_comment_reports_stay_open(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    r1 = await _register_login(env, "r1@gmov.dev", "reporter1")
    r2 = await _register_login(env, "r2@gmov.dev", "reporter2")
    r3 = await _register_login(env, "r3@gmov.dev", "reporter3")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    await _promote(env, "moderator", UserRole.MODERATOR)
    cid = await _comment(env, author)
    await _report(env, r1, cid)
    await _report(env, r2, cid)
    await _report(env, r3, cid)

    async with env.factory() as db:
        comment = await db.get(Comment, uuid.UUID(cid))
    assert comment is not None
    assert comment.is_hidden is True

    rows = await _report_rows(env, cid)
    assert len(rows) == 3
    assert all(row.status == ReportStatus.OPEN for row in rows)

    body = (
        await env.client.get(f"{ADMIN}/reports?status=open", headers=moderator)
    ).json()
    assert body["total_items"] == 3
    assert body["open_total"] == 3


async def test_dismiss_resolved_report_is_noop(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    r1 = await _register_login(env, "r1@gmov.dev", "reporter1")
    moderator = await _register_login(env, "mod@gmov.dev", "moderator")
    await _promote(env, "moderator", UserRole.MODERATOR)
    cid = await _comment(env, author)
    report_id = (await _report(env, r1, cid)).json()["id"]

    r = await env.client.post(f"{ADMIN}/comments/{cid}/hide", headers=moderator)
    assert r.status_code == 200, r.text

    async with env.factory() as db:
        row = await db.get(CommentReport, uuid.UUID(report_id))
        assert row.status == ReportStatus.RESOLVED
        resolved_at = row.resolved_at
        resolved_by = row.resolved_by

    r = await env.client.post(
        f"{ADMIN}/reports/{report_id}/dismiss", headers=moderator
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    async with env.factory() as db:
        row = await db.get(CommentReport, uuid.UUID(report_id))
        assert row.status == ReportStatus.RESOLVED
        assert row.resolved_at == resolved_at
        assert row.resolved_by == resolved_by


async def test_comments_reported_flag_for_viewer(client_env):
    env = client_env
    author = await _register_login(env, "author@gmov.dev", "author")
    reporter = await _register_login(env, "rep@gmov.dev", "reporter")
    bystander = await _register_login(env, "by@gmov.dev", "bystander")

    c1 = await _comment(env, author, body="first")
    reply = (
        await env.client.post(
            f"{ME}/comments",
            headers=author,
            json={"movie_slug": "mao", "body": "a reply", "parent_id": c1},
        )
    ).json()["id"]
    await _comment(env, author, body="second", slug="other")

    await _report(env, reporter, c1)
    await _report(env, reporter, reply)

    def fetch(headers=None, slug="mao"):
        return env.client.get(
            "/api/v1/comments", params={"movie_slug": slug}, headers=headers
        )

    items = (await fetch(reporter)).json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == c1
    assert items[0]["reported"] is True
    assert items[0]["replies"][0]["id"] == reply
    assert items[0]["replies"][0]["reported"] is True

    other = (await fetch(reporter, slug="other")).json()["items"][0]
    assert other["reported"] is False

    bystander_items = (await fetch(bystander)).json()["items"]
    assert bystander_items[0]["reported"] is False
    assert bystander_items[0]["replies"][0]["reported"] is False

    anon_items = (await fetch()).json()["items"]
    assert anon_items[0]["reported"] is False
    assert anon_items[0]["replies"][0]["reported"] is False
