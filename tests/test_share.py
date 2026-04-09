"""Tests for the share-profile-via-UUID feature."""
import json

from tests.helpers import auth_headers


# ── Token generation ─────────────────────────────────────────────────────────

def test_share_enable_generates_token(client, alice):
    r = client.post("/share/enable", headers=auth_headers(alice["token"]))
    assert r.status_code == 200
    body = r.json()
    assert "share_token" in body
    assert len(body["share_token"]) == 36  # UUID format


def test_share_enable_returns_same_token(client, alice):
    r1 = client.post("/share/enable", headers=auth_headers(alice["token"]))
    r2 = client.post("/share/enable", headers=auth_headers(alice["token"]))
    assert r1.json()["share_token"] == r2.json()["share_token"]


def test_share_enable_requires_auth(client):
    r = client.post("/share/enable")
    assert r.status_code in (401, 403)


# ── Public data endpoint ─────────────────────────────────────────────────────

def test_shared_data_returns_tasks(client, alice):
    payload = {"tasks": [{"id": "t1", "name": "My task", "sessions": []}], "later": []}
    client.post(
        "/data",
        content=json.dumps(payload),
        headers={**auth_headers(alice["token"]), "Content-Type": "application/json"},
    )
    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}/data")
    assert r.status_code == 200
    assert r.json()["tasks"][0]["name"] == "My task"


def test_shared_data_invalid_token_404(client):
    r = client.get("/shared/00000000-0000-0000-0000-000000000000/data")
    assert r.status_code == 404


# ── Public done endpoints ────────────────────────────────────────────────────

def test_shared_done(client, alice):
    client.post("/done", json={"id": "d1", "text": "Done item"}, headers=auth_headers(alice["token"]))
    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}/done")
    assert r.status_code == 200
    assert r.json()["total"] == 1


def test_shared_done_stats(client, alice):
    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}/done/stats")
    assert r.status_code == 200
    assert "this_week" in r.json()


# ── Public report endpoint ───────────────────────────────────────────────────

def test_shared_report(client, alice):
    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}/report/monthly")
    assert r.status_code == 200
    assert "total_ms" in r.json()


# ── Isolation ────────────────────────────────────────────────────────────────

def test_shared_isolation(client, alice, bob):
    """Alice's share token only shows Alice's data."""
    alice_payload = {"tasks": [{"id": "t1", "name": "Alice secret", "sessions": []}], "later": []}
    client.post(
        "/data",
        content=json.dumps(alice_payload),
        headers={**auth_headers(alice["token"]), "Content-Type": "application/json"},
    )
    bob_payload = {"tasks": [{"id": "t2", "name": "Bob stuff", "sessions": []}], "later": []}
    client.post(
        "/data",
        content=json.dumps(bob_payload),
        headers={**auth_headers(bob["token"]), "Content-Type": "application/json"},
    )

    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}/data")
    names = [t["name"] for t in r.json()["tasks"]]
    assert "Alice secret" in names
    assert "Bob stuff" not in names


# ── Page routes serve HTML ───────────────────────────────────────────────────

def test_shared_page_serves_html(client, alice):
    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_shared_done_page_serves_html(client, alice):
    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}/done-list")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_shared_report_page_serves_html(client, alice):
    token = client.post("/share/enable", headers=auth_headers(alice["token"])).json()["share_token"]
    r = client.get(f"/shared/{token}/report")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
