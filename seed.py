#!/usr/bin/env python3
"""
seed.py — populate a user's tasks with two weeks of realistic sessions.

Connects directly to Postgres using DATABASE_URL from .env (or environment).
Safe to re-run: never removes existing tasks or sessions.

Usage:
    python3 seed.py --email you@example.com
    python3 seed.py --email you@example.com --db postgresql://localhost/tt
"""
import argparse, json, os, random, uuid
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(42)

# ── Task definitions ───────────────────────────────────────────────────────────
SEED_TASKS = [
    {"name": "deep work",     "freq": 0.85, "min_h": 1.0, "max_h": 3.5},
    {"name": "email & slack", "freq": 0.90, "min_h": 0.3, "max_h": 1.2},
    {"name": "code review",   "freq": 0.65, "min_h": 0.5, "max_h": 2.0},
    {"name": "meetings",      "freq": 0.55, "min_h": 0.5, "max_h": 2.0},
    {"name": "planning",      "freq": 0.40, "min_h": 0.3, "max_h": 1.0},
]

EXISTING_SEEDS = {
    "React Query":    {"freq": 0.55, "min_h": 0.5, "max_h": 2.5},
    "Interview Prep": {"freq": 0.45, "min_h": 0.5, "max_h": 1.5},
}

# ── Helpers ────────────────────────────────────────────────────────────────────
def to_ms(d: date, hour: int, minute: int = 0) -> int:
    return int(datetime(d.year, d.month, d.day, hour, minute).timestamp() * 1000)

def gen_sessions(d: date, total_hours: float) -> list[dict]:
    total_ms  = int(total_hours * 3_600_000)
    day_start = to_ms(d, 9)
    day_end   = to_ms(d, 18, 30)
    latest    = max(day_start, day_end - total_ms - 1_800_000)
    cursor    = random.randint(day_start, latest)
    n         = random.choices([1, 2, 3], weights=[0.45, 0.40, 0.15])[0]
    remaining = total_ms
    sessions  = []
    for i in range(n):
        is_last = (i == n - 1)
        chunk   = remaining if is_last else int(remaining * random.uniform(0.35, 0.60))
        end_ts  = min(cursor + chunk, day_end)
        sessions.append({"start": cursor, "end": end_ts})
        remaining -= (end_ts - cursor)
        if remaining <= 0:
            break
        cursor = end_ts + random.randint(5, 25) * 60_000
        if cursor >= day_end:
            break
    return sessions

def past_weekdays(n_weeks: int) -> list[date]:
    today     = date.today()
    yesterday = today - timedelta(days=1)
    start     = today - timedelta(weeks=n_weeks)
    days, d   = [], start
    while d <= yesterday:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    # load .env before parsing so DATABASE_URL is available as a default
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

    parser = argparse.ArgumentParser(description="Seed Doing It with sample data")
    parser.add_argument("--email", required=True, help="User email to seed")
    parser.add_argument("--db", default=os.getenv("DATABASE_URL"),
                        help="Postgres URL (default: DATABASE_URL from .env)")
    args = parser.parse_args()

    if not args.db:
        parser.error("No database URL — pass --db or set DATABASE_URL in .env")

    import psycopg2
    import psycopg2.extras

    with psycopg2.connect(args.db, cursor_factory=psycopg2.extras.RealDictCursor) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (args.email,))
            row = cur.fetchone()
            if not row:
                print(f"No user found with email: {args.email}")
                return
            user_id = row["id"]

            cur.execute("SELECT tasks_json FROM user_data WHERE user_id = %s", (user_id,))
            row = cur.fetchone()
            data = json.loads(row["tasks_json"]) if row else {"tasks": []}

        by_name = {t["name"]: t for t in data["tasks"]}

        for spec in SEED_TASKS:
            if spec["name"] not in by_name:
                task = {"id": str(uuid.uuid4()), "name": spec["name"], "sessions": []}
                data["tasks"].append(task)
                by_name[spec["name"]] = task

        days = past_weekdays(2)

        def add_sessions(task, spec):
            existing = {s["start"] for s in task["sessions"]}
            for d in days:
                if random.random() > spec["freq"]:
                    continue
                for s in gen_sessions(d, random.uniform(spec["min_h"], spec["max_h"])):
                    if s["start"] not in existing:
                        task["sessions"].append(s)
                        existing.add(s["start"])

        for spec in SEED_TASKS:
            add_sessions(by_name[spec["name"]], spec)
        for name, spec in EXISTING_SEEDS.items():
            if name in by_name:
                add_sessions(by_name[name], spec)

        for task in data["tasks"]:
            task["sessions"].sort(key=lambda s: s["start"])

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO user_data (user_id, tasks_json) VALUES (%s, %s) "
                "ON CONFLICT (user_id) DO UPDATE SET tasks_json = EXCLUDED.tasks_json",
                (user_id, json.dumps(data)),
            )
        conn.commit()

    print(f"Seeded {len(days)} weekdays ({days[0]} → {days[-1]}) for {args.email}\n")
    for task in data["tasks"]:
        done    = [s for s in task["sessions"] if s.get("end")]
        total_h = sum(s["end"] - s["start"] for s in done) / 3_600_000
        n_days  = len({datetime.fromtimestamp(s["start"] / 1000).date() for s in done})
        print(f"  {task['name']:<20}  {n_days:>2} days  {total_h:>5.1f}h")

if __name__ == "__main__":
    main()
