# Fly.io → DigitalOcean Migration

## What you're replacing

| Fly.io | DigitalOcean |
|--------|-------------|
| Fly app (uvicorn) | systemd service on your Droplet |
| Fly Postgres | Postgres on the same Droplet |
| Fly TLS termination | nginx + Let's Encrypt |

Running Postgres on the same Droplet is fine for this app. A DO Managed Database is $15/month and only worth it when you need automated backups, failover, or separate scaling.

---

## Step 1 — Dump the Fly database

```bash
fly proxy 5433:5432 -a <your-fly-pg-app> &
pg_dump -h localhost -p 5433 -U postgres doingit > doingit.dump
kill %1
```

---

## Step 2 — Set up the Droplet

```bash
# Postgres
sudo apt install -y postgresql python3-pip python3-venv nginx certbot python3-certbot-nginx

sudo -u postgres psql -c "CREATE USER doingit WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "CREATE DATABASE doingit OWNER doingit;"

# Restore data
psql -U doingit -d doingit < doingit.dump
```

---

## Step 3 — Deploy the app

```bash
cd /opt/doingit
git clone https://github.com/gusaiani/doingit.git .
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Create `/etc/systemd/system/doingit.service`:

```ini
[Unit]
Description=Doing It
After=network.target postgresql.service

[Service]
User=www-data
WorkingDirectory=/opt/doingit
EnvironmentFile=/opt/doingit/.env
ExecStart=/opt/doingit/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now doingit
```

---

## Step 4 — nginx + TLS

`/etc/nginx/sites-available/doingit`:

```nginx
server {
    server_name doingit.online;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/doingit /etc/nginx/sites-enabled/
sudo certbot --nginx -d doingit.online
```

---

## Step 5 — Cut over

1. Point DNS A record to the Droplet IP
2. Wait for propagation, smoke-test
3. `fly scale count 0` to pause the Fly app (keeps it as backup for a day or two)
4. `fly apps destroy` once you're confident

---

## Environment variables

`/opt/doingit/.env`:

```
DATABASE_URL=postgresql://doingit:yourpassword@localhost/doingit
SECRET_KEY=...
# rest of your existing env vars
```
