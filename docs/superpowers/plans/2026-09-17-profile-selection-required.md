# Profile selection required — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A login/refresh token must not carry a profile until the user explicitly
picks one, so a PIN-locked profile (including the default one) stays unreadable
until its PIN is verified — no endpoint leaks profile data to an "auto-selected"
default.

**Architecture:** The access-token `pid` claim becomes the *proof of selection*
(and therefore of PIN verification), instead of being minted by login. `login`
and `refresh` mint tokens without `pid`; `POST /me/profiles/{id}/switch` is the
only way to obtain one (it already verifies the PIN). `get_active_profile` stops
falling back to the default profile and answers `403 PROFILE_REQUIRED`; the few
endpoints that must work before a profile is chosen (list profiles, switch,
delete) move to a new `get_session_context` dependency. On the web, a shell-level
gate sends any authenticated session without a profile to `/profiles`, so the
chooser still owns the selection flow.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + PyJWT (apps/api), Next.js 15 App
Router + TanStack Query v5 (apps/web), Playwright E2E.

**Spec:** this file (design derived from `docs/decisions.md` #132, amended by
#135 → new #136). Chosen design: option "không bind profile khi login".

## Global Constraints

- Language: user-facing copy + docs prose in Vietnamese, identifiers/comments/commit
  messages in English. Conventional Commits, one commit per task.
- No DB migration needed: `refresh_tokens.profile_id` is already `nullable=True`
  with `ON DELETE SET NULL` (`app/db/models/refresh_token.py:21-26`).
- Error contract: `403` + `code=PROFILE_REQUIRED` (sibling of `PIN_REQUIRED`).
  `404 PROFILE_NOT_FOUND` stays for a foreign/unknown `pid`.
- `pid` absent from a token means "no profile selected", never "use the default".
- Do not touch `zoom-*`/`sheet-*`/`toast-*` animations, PIN throttling, or the
  refresh-token rotation/reuse-detection logic.
- Every task ends green: `cd apps/api && uv run ruff check app tests && uv run
  pytest -q -m "not integration"`; web `cd apps/web && pnpm lint && pnpm exec tsc
  --noEmit`; E2E via `pnpm test:e2e` (kill dev `:3000` first, `rm -rf .next`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/app/core/security.py` | `create_access_token` accepts `profile_id: uuid.UUID \| None` and omits `pid` |
| `apps/api/app/services/auth_service.py` | `_build_pair`/`_issue_pair` take `uuid.UUID \| None`; `login`/`register` issue profile-less pairs; `refresh` never falls back to the default |
| `apps/api/app/services/profile_service.py` | `repoint_session` accepts `None`; `current_profile_for` removed (dead once the dependency is strict) |
| `apps/api/app/core/deps.py` | `ProfileRequired` (strict) vs `get_session_context` (optional profile); `ActiveProfile` unchanged |
| `apps/api/app/api/v1/routers/profiles.py` | `list_profiles`/`switch_profile`/`delete_profile` use `get_session_context`; delete of the active profile returns no token |
| `apps/api/tests/conftest.py` | shared `select_default(client, token)` + `make_access_token` stays (explicit pid) |
| `apps/api/tests/test_profile_*.py`, `test_library.py`, `test_reviews.py`, `test_moderation.py`, `test_preferences_api.py`, `test_recommendations_api.py`, `test_profiles_api.py` | local `_register_login` helpers switch to the default profile |
| `apps/web/lib/errors.ts` | `PROFILE_REQUIRED` message + `isProfileRequired(error)` |
| `apps/web/components/profile/profile-gate.tsx` (new) | shell gate: authenticated + no profile → `/profiles?next=…` |
| `apps/web/components/layout/app-shell.tsx` | mounts `ProfileGate` on non-immersive routes |
| `apps/web/app/profiles/page.tsx` | always switch on select (current profile included) |
| `apps/web/app/profiles/manage/page.tsx` | deleting the current profile routes back to `/profiles` |
| `apps/web/e2e/helpers/auth.ts` | `loginViaApi`/`loginViaUi` complete the chooser |
| `docs/decisions.md`, `docs/api-profiles.md`, `docs/web-pages.md`, `docs/e2e.md`, `docs/todo.md` | behaviour + follow-ups |

---

### Task 1: API — a token carries no profile until one is selected

**Files:**
- Modify: `apps/api/app/core/security.py:44-52`, `apps/api/app/services/auth_service.py:19-46,49-66,130-175`, `apps/api/app/core/deps.py:62-96`, `apps/api/app/services/profile_service.py:57-64,198-208`
- Test: `apps/api/tests/test_profile_session.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `create_access_token(user_id, session_jti, profile_id: uuid.UUID | None = None) -> str` (omits `pid` when `None`); `repoint_session(db, session_jti: str, profile_id: uuid.UUID | None) -> None`; `get_active_profile() -> ActiveProfile` raising `AppException("Profile required", "PROFILE_REQUIRED", 403)`; `get_session_context() -> SessionContext` with `profile: Profile | None`.

- [ ] **Step 1: Write failing tests** in `apps/api/tests/test_profile_session.py`:

```python
async def test_login_token_has_no_profile(client, user_payload):
    """A fresh login must not activate the default profile."""
    await client.post("/api/v1/auth/register", json=user_payload)
    res = await client.post(
        "/api/v1/auth/login",
        data={"username": user_payload["username"], "password": user_payload["password"]},
    )
    assert res.status_code == 200
    token = res.json()["access_token"]
    claims = security.decode_token(token)
    assert "pid" not in claims
    locked = await client.get("/api/v1/me/profile", headers=_hdrs(token))
    assert locked.status_code == 403
    assert locked.json()["code"] == "PROFILE_REQUIRED"


async def test_switch_unlocks_only_the_picked_profile(client, user_payload):
    """`switch` is the sole way to get a profile-bound token."""
    await client.post("/api/v1/auth/register", json=user_payload)
    token = (await client.post("/api/v1/auth/login", data=...)).json()["access_token"]
    lst = await client.get("/api/v1/me/profiles", headers=_hdrs(token))
    default = lst.json()["items"][0]["id"]
    res = await client.post(f"/api/v1/me/profiles/{default}/switch", headers=_hdrs(token), json={})
    assert res.status_code == 200
    bound = res.json()["access_token"]
    assert security.decode_token(bound)["pid"] == default
    assert (await client.get("/api/v1/me/profile", headers=_hdrs(bound))).status_code == 200


async def test_refresh_of_unselected_session_stays_unselected(client, user_payload):
    """The refresh cookie must not silently pick the default profile."""
```

- [ ] **Step 2: Run and confirm they fail** — `uv run pytest tests/test_profile_session.py -q` → `pid` present / `403 != 200` failures.

- [ ] **Step 3: Implement**

```python
# security.py
def create_access_token(user_id, session_jti, profile_id: uuid.UUID | None = None) -> str:
    extra = {"sid": session_jti, **({"pid": str(profile_id)} if profile_id else {})}
    return _encode(str(user_id), ACCESS_TOKEN_TYPE, timedelta(...), extra)

# auth_service.login / register
return await _issue_pair(db, user, None)   # no profile until a switch
```

`refresh`: keep `profile_id = presented.profile_id`; when it is `None` or the
profile no longer resolves, use `None` and `repoint_session(jti, None)` — never
`default_for`.

`deps._profile_from_claims`: raise `PROFILE_REQUIRED` when `pid` is missing; when
the `pid` no longer resolves, `repoint_session(jti, None)` then raise
`PROFILE_REQUIRED`; a foreign `pid` stays `404 PROFILE_NOT_FOUND`. Add
`_optional_profile_from_claims` returning `None` in both cases, and:

```python
@dataclass(frozen=True)
class SessionContext:
    user: User
    profile: Profile | None
    session_jti: str | None

async def get_session_context(token=Depends(oauth2_scheme), db=Depends(get_db)) -> SessionContext: ...
```

- [ ] **Step 4: Run** the module + whole suite; update every helper from the File
  Structure table that assumed login binds the default (shared
  `select_default(client, token)` in `conftest.py`, then one line per local
  `_register_login`).

- [ ] **Step 5: Commit** — `fix(api): bind a session to a profile only on explicit switch`

### Task 2: API — endpoints that must work before a profile is chosen

- [ ] **Step 1: Failing tests** in `apps/api/tests/test_profiles_api.py`: listing is
  allowed with an unselected token (and every `is_current` is `false`), `switch`
  works from an unselected token, deleting the *active* profile returns
  `{"access_token": null, "profile": null}` and a follow-up `/me/profile` is
  `PROFILE_REQUIRED` (session repointed to `NULL`).
- [ ] **Step 2: Run** → fail (`403` on list / non-null token).
- [ ] **Step 3: Implement** in `routers/profiles.py`: `list_profiles`,
  `switch_profile`, `delete_profile` depend on `get_session_context`;
  `is_current = ctx.profile is not None and p.id == ctx.profile.id`;
  delete: `was_active = ctx.profile is not None and profile.id == ctx.profile.id`
  → `repoint_session(db, ctx.session_jti, None)` when active, always
  `SwitchOut(access_token=None, profile=None)`.
- [ ] **Step 4: Run** suite.
- [ ] **Step 5: Commit** — `fix(api): keep profile list/switch usable before a profile is picked`

### Task 3: Web — gate the shell on an active profile

- [ ] **Step 1: Failing E2E** in `apps/web/e2e/profiles.spec.ts`:

```ts
test("an unselected session cannot browse until a profile is picked", async ({ page }) => {
  await loginViaApi(page, { skipChooser: true });
  await page.goto("/");
  await expect(page).toHaveURL(/\/profiles\?next=%2F$/);
  await expect(page.getByTestId("profile-chooser")).toBeVisible();
});
```

- [ ] **Step 2: Run** → fail (stays on `/`).
- [ ] **Step 3: Implement** `components/profile/profile-gate.tsx`
  (`useAuth` + `useCurrentProfile`; if authenticated and the query errored with
  `PROFILE_REQUIRED` → `router.replace(\`/profiles?next=${encodeURIComponent(pathname + search)}\`)`
  once, rendering a skeleton meanwhile; children otherwise), mount it in
  `AppShell` for non-immersive routes, skipping `/profiles/manage`, `/login`,
  `/register`; add the error message + `isProfileRequired` to `lib/errors.ts`.
- [ ] **Step 4: Run** the spec.
- [ ] **Step 5: Commit** — `fix(web): require a chosen profile before rendering the shell`

### Task 4: Web — the chooser asks for the PIN even for the current profile

- [ ] **Step 1: Failing E2E**: a session already bound to a PIN profile that opens
  `/profiles` and taps its own card must see the PIN dialog (no silent `leave()`)
  — extend the existing "logging in lands on the full-screen chooser" test.
- [ ] **Step 2: Run** → fail (leaves immediately).
- [ ] **Step 3: Implement** `app/profiles/page.tsx:handleSelect`: drop the
  `is_current` shortcut; always `switchProfile.mutate({ id, pin? })`, keeping the
  `has_pin`/`PIN_REQUIRED` dialog paths. `leave()` unchanged.
- [ ] **Step 4: Run** spec + full E2E (36 → new count), `pnpm lint && tsc`.
- [ ] **Step 5: Commit** — `fix(web): always verify the PIN when picking a profile`

### Task 5: Docs, e2e helpers and decisions

- [ ] **Step 1:** update `e2e/helpers/auth.ts` so `loginViaApi`/`loginViaUi` end with
  a selected profile (default, no PIN) and expose `skipChooser` for the gate test;
  adapt `continuePastChooser` users if the flow collapses into one helper.
- [ ] **Step 2:** `docs/decisions.md` #136 (supersedes the "old sessions fall back to
  the default profile" half of #130 and the "login binds the default" half of
  #132: a token without `pid` means *unselected*; `GET /me/profiles` stays open;
  deleting the active profile leaves the session unselected); update
  `docs/api-profiles.md` (error codes, switch as the only selector),
  `docs/web-pages.md` (gate + chooser), `docs/e2e.md` (helper behaviour, new
  specs); add the follow-up "PIN change does not revoke sessions already bound to
  that profile" to `docs/todo.md`.
- [ ] **Step 3:** run the pre-commit checklist from `AGENTS.md`, then
  `fix(api,web): require an explicit profile selection after login` (or per-commit
  messages already used in Tasks 1–4; docs commit separately:
  `docs: record explicit profile selection (#136)`).

---

## Self-Review

- Spec coverage: no-`pid`-at-login (T1), one place where the fallback used to be
  (T1 deps/refresh), endpoints that must stay reachable (T2), UI gate (T3),
  chooser PIN for the current card (T4), docs + revocation follow-up (T5).
- Placeholders: the `...` in T1 Step 1 is the same login call already written in
  the first test of that step — the executor repeats it verbatim.
- Type consistency: `create_access_token(..., profile_id: uuid.UUID | None)`,
  `repoint_session(..., profile_id: uuid.UUID | None)`, `SessionContext.profile:
  Profile | None`, web `isProfileRequired(error)` — used identically in every task.
