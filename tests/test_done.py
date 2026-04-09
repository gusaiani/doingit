"""Tests for the done-items feature (mark later items as done)."""


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_mark_done(client, alice):
    r = client.post("/done", json={"id": "d1", "text": "Buy groceries"}, headers=auth(alice["token"]))
    assert r.status_code == 201
    assert r.json() == {"ok": True}


def test_mark_done_duplicate_is_noop(client, alice):
    client.post("/done", json={"id": "d1", "text": "Buy groceries"}, headers=auth(alice["token"]))
    r = client.post("/done", json={"id": "d1", "text": "Buy groceries"}, headers=auth(alice["token"]))
    assert r.status_code == 201

    items = client.get("/done", headers=auth(alice["token"])).json()
    assert items["total"] == 1


def test_get_done_empty(client, alice):
    r = client.get("/done", headers=auth(alice["token"]))
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_get_done_returns_items(client, alice):
    client.post("/done", json={"id": "d1", "text": "Item one"}, headers=auth(alice["token"]))
    client.post("/done", json={"id": "d2", "text": "Item two"}, headers=auth(alice["token"]))

    body = client.get("/done", headers=auth(alice["token"])).json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    texts = {item["text"] for item in body["items"]}
    assert texts == {"Item one", "Item two"}
    assert "done_at" in body["items"][0]


def test_get_done_pagination(client, alice):
    for i in range(5):
        client.post("/done", json={"id": f"d{i}", "text": f"Item {i}"}, headers=auth(alice["token"]))

    body = client.get("/done?offset=0&limit=2", headers=auth(alice["token"])).json()
    assert body["total"] == 5
    assert len(body["items"]) == 2

    body2 = client.get("/done?offset=2&limit=2", headers=auth(alice["token"])).json()
    assert len(body2["items"]) == 2

    body3 = client.get("/done?offset=4&limit=2", headers=auth(alice["token"])).json()
    assert len(body3["items"]) == 1


def test_done_isolation(client, alice, bob):
    client.post("/done", json={"id": "d1", "text": "Alice item"}, headers=auth(alice["token"]))
    client.post("/done", json={"id": "d2", "text": "Bob item"}, headers=auth(bob["token"]))

    alice_items = client.get("/done", headers=auth(alice["token"])).json()
    assert alice_items["total"] == 1
    assert alice_items["items"][0]["text"] == "Alice item"

    bob_items = client.get("/done", headers=auth(bob["token"])).json()
    assert bob_items["total"] == 1
    assert bob_items["items"][0]["text"] == "Bob item"


def test_done_stats(client, alice):
    for i in range(3):
        client.post("/done", json={"id": f"d{i}", "text": f"Item {i}"}, headers=auth(alice["token"]))

    r = client.get("/done/stats", headers=auth(alice["token"]))
    assert r.status_code == 200
    stats = r.json()
    assert stats["this_month"] == 3
    assert stats["this_week"] == 3
    assert stats["avg_per_week"] == 3.0  # 3 items / 1 week (new user)
    assert stats["avg_weeks"] == 1
    assert stats["weekly"] == [3]


def test_done_stats_older_user(client, alice, db_conn):
    """User signed up 6 weeks ago — avg uses 4 weeks, sparkline shows 6 weeks."""
    cur = db_conn.cursor()
    # Backdate signup to 6 weeks ago
    cur.execute(
        "UPDATE users SET created_at = NOW() - INTERVAL '6 weeks' WHERE email = %s",
        (alice["email"],),
    )
    # Insert done items spread across time
    for i in range(5):
        cur.execute(
            "INSERT INTO done_items (id, user_id, text, done_at) "
            "VALUES (%s, (SELECT id FROM users WHERE email = %s), %s, NOW())",
            (f"s{i}", alice["email"], f"Item {i}"),
        )

    r = client.get("/done/stats", headers=auth(alice["token"]))
    assert r.status_code == 200
    stats = r.json()
    assert stats["avg_weeks"] == 4
    assert len(stats["weekly"]) == 6
    assert sum(stats["weekly"]) == 5  # all 5 items accounted for
    assert stats["weekly"][-1] == 5  # all in current week
    # avg = 5 items in last 4 weeks / 4
    assert stats["avg_per_week"] == 1.2


def test_done_stats_empty(client, alice):
    """Stats for user with no done items."""
    r = client.get("/done/stats", headers=auth(alice["token"]))
    assert r.status_code == 200
    stats = r.json()
    assert stats["this_week"] == 0
    assert stats["this_month"] == 0
    assert stats["avg_per_week"] == 0.0
    assert stats["avg_weeks"] == 1
    assert stats["weekly"] == [0]


def test_done_requires_auth(client):
    r = client.post("/done", json={"id": "d1", "text": "test"})
    assert r.status_code == 403

    r = client.get("/done")
    assert r.status_code == 403

    r = client.get("/done/stats")
    assert r.status_code == 403


def test_done_page_serves_html(client):
    r = client.get("/done-list")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
