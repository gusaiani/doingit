from tests.helpers import auth_headers


def test_get_preferences_without_auth_returns_403(client):
    r = client.get("/preferences")
    assert r.status_code == 403


def test_put_preferences_without_auth_returns_403(client):
    r = client.put("/preferences", json={"theme": "dark"})
    assert r.status_code == 403


def test_new_user_has_null_theme(client, alice):
    r = client.get("/preferences", headers=auth_headers(alice["token"]))
    assert r.status_code == 200
    assert r.json()["theme"] is None


def test_set_theme_dark(client, alice):
    r = client.put("/preferences", json={"theme": "dark"}, headers=auth_headers(alice["token"]))
    assert r.status_code == 204

    r = client.get("/preferences", headers=auth_headers(alice["token"]))
    assert r.json()["theme"] == "dark"


def test_set_theme_light(client, alice):
    r = client.put("/preferences", json={"theme": "light"}, headers=auth_headers(alice["token"]))
    assert r.status_code == 204

    r = client.get("/preferences", headers=auth_headers(alice["token"]))
    assert r.json()["theme"] == "light"


def test_set_theme_null_clears(client, alice):
    client.put("/preferences", json={"theme": "dark"}, headers=auth_headers(alice["token"]))
    r = client.put("/preferences", json={"theme": None}, headers=auth_headers(alice["token"]))
    assert r.status_code == 204

    r = client.get("/preferences", headers=auth_headers(alice["token"]))
    assert r.json()["theme"] is None


def test_invalid_theme_rejected(client, alice):
    r = client.put("/preferences", json={"theme": "neon"}, headers=auth_headers(alice["token"]))
    assert r.status_code == 422


def test_preferences_isolated_between_users(client, alice, bob):
    client.put("/preferences", json={"theme": "dark"}, headers=auth_headers(alice["token"]))

    r = client.get("/preferences", headers=auth_headers(bob["token"]))
    assert r.json()["theme"] is None


def test_get_data_includes_theme(client, alice):
    client.put("/preferences", json={"theme": "dark"}, headers=auth_headers(alice["token"]))
    r = client.get("/data", headers=auth_headers(alice["token"]))
    assert r.json()["theme"] == "dark"


def test_get_data_theme_null_by_default(client, alice):
    r = client.get("/data", headers=auth_headers(alice["token"]))
    assert r.json()["theme"] is None
