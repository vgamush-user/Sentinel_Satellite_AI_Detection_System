"""Start the whole real-time Sentinel pipeline with one command.

    python scripts/start_all.py                  # live agents on Groq
    python scripts/start_all.py --agents cached  # offline demo, no Groq calls
    python scripts/start_all.py --speed 20 --mode all --open

What it does:
  1. docker compose up -d   (Kafka + Kafka UI), waits until Kafka is ready
  2. creates the Kafka topics
  3. starts recorder, detector, incident manager, agent worker, producer and
     the website, each as its own process
  4. prints each service's log lines with a [name] prefix (full logs in
     data/live/logs/), and stops everything on Ctrl+C

Website: http://127.0.0.1:8050    Kafka UI: http://localhost:8080
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
LOGS = ROOT / "data" / "live" / "logs"
sys.path.insert(0, str(SRC))

COLORS = {"recorder": "90", "detector": "36", "incidents": "33", "agents": "35", "producer": "32", "web": "34"}


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, **kw)


def start_docker() -> None:
    if not shutil.which("docker"):
        sys.exit("Docker is not installed or not on PATH. Install Docker Desktop, then retry.")
    if run(["docker", "info"]).returncode != 0:
        sys.exit("Docker is installed but not running. Start Docker Desktop, wait until it's ready, then retry.")
    print("Starting Kafka (docker compose up -d)...", flush=True)
    r = run(["docker", "compose", "up", "-d"])
    if r.returncode != 0:
        sys.exit("docker compose up failed:\n" + r.stderr)


def pump(name: str, proc: subprocess.Popen, log_path: Path, quiet: bool) -> None:
    """Copy a child's output to its log file and (filtered) to the console."""
    color = COLORS.get(name, "0")
    with open(log_path, "a", encoding="utf-8") as log:
        for line in proc.stdout:
            log.write(line)
            log.flush()
            text = line.rstrip()
            # The agent worker prints CrewAI's full verbose trace; on the
            # console show only its own status lines and retries.
            if quiet and not (f"[{name}]" in text or "llm retry" in text or "Error" in text):
                continue
            if text:
                print(f"\x1b[{color}m[{name:9s}]\x1b[0m {text}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Start the Sentinel real-time pipeline.")
    ap.add_argument("--speed", type=float, default=10, help="replay rows per second (default 10)")
    ap.add_argument("--mode", choices=["normal", "all", "shuffle"], default="normal",
                    help="replay only Normal rows (default), every row, or shuffled")
    ap.add_argument("--dataset", default="noised", help="noised (default) | raw | path to CSV")
    ap.add_argument("--agents", choices=["live", "cached"], default=os.getenv("AGENT_MODE", "live"),
                    help="live = 4 agents on Groq; cached = stored reports, no Groq calls")
    ap.add_argument("--no-docker", action="store_true", help="don't run docker compose (Kafka already running)")
    ap.add_argument("--open", action="store_true", help="open the website in the browser")
    args = ap.parse_args()

    if os.name == "nt":
        os.system("")  # enable ANSI colours in the Windows console

    if not args.no_docker:
        start_docker()
    from streaming.topics import ensure_topics, wait_for_broker
    from streaming.config import WEB_HOST, WEB_PORT

    print("Waiting for Kafka...", flush=True)
    wait_for_broker(timeout_sec=90)
    ensure_topics()

    LOGS.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "AGENT_MODE": args.agents}
    services = [
        ("recorder", ["-m", "streaming.recorder"]),
        ("detector", ["-m", "streaming.detector"]),
        ("incidents", ["-m", "streaming.incident_manager"]),
        ("agents", ["-m", "streaming.agent_worker"]),
        ("web", ["-m", "web.server"]),
        ("producer", ["-m", "streaming.producer", "--speed", str(args.speed), "--mode", args.mode,
                      "--dataset", args.dataset]),
    ]
    procs = []
    for name, cmd in services:
        log_path = LOGS / f"{name}.log"
        log_path.write_text(f"--- started {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n", encoding="utf-8")
        p = subprocess.Popen([sys.executable, *cmd], cwd=SRC, env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        threading.Thread(target=pump, args=(name, p, log_path, name == "agents"), daemon=True).start()
        procs.append((name, p))
        if name == "producer":
            continue
        time.sleep(0.5)

    url = f"http://{WEB_HOST}:{WEB_PORT}"
    print(f"\n  Sentinel website: {url}\n  Kafka UI:         http://localhost:8080\n"
          f"  Agents: {args.agents} | replay: {args.mode} @ {args.speed:g} rows/s | logs: {LOGS}\n"
          f"  Press Ctrl+C to stop everything.\n", flush=True)
    if args.open:
        threading.Timer(3, webbrowser.open, args=(url,)).start()

    try:
        while True:
            time.sleep(1)
            for name, p in procs:
                if p.poll() is not None:
                    print(f"\n[{name}] exited with code {p.returncode}; see {LOGS / (name + '.log')}. Stopping.",
                          flush=True)
                    raise KeyboardInterrupt
    except KeyboardInterrupt:
        pass
    finally:
        print("Stopping services...", flush=True)
        for _, p in procs:
            if p.poll() is None:
                p.terminate()
        for _, p in procs:
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
        print("Stopped. Kafka is still running in Docker (docker compose down to stop it).", flush=True)


if __name__ == "__main__":
    main()
