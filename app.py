import os
import sys
import re
import json
import threading
import time
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from typing import Optional
from pydantic import BaseModel
import uvicorn

import scanner

APP_VERSION = "v1.1.0"
GITHUB_REPO = "PlasmaDrifter/podman-systemd-dashboard"

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# In-memory cached scan result
cache_lock = threading.Lock()
cached_data = None

UPDATE_CACHE = {
    "last_checked": 0,
    "latest_version": APP_VERSION,
    "release_url": f"https://github.com/{GITHUB_REPO}/releases",
    "has_update": False,
    "lock": threading.Lock(),
}

def parse_version_tuple(v_str: str):
    if not v_str:
        return (0, 0, 0)
    cleaned = re.sub(r'^[vV]', '', str(v_str).strip())
    parts = []
    for p in re.split(r'[-.+_]', cleaned):
        if p.isdigit():
            parts.append(int(p))
        else:
            m = re.match(r'(\d+)', p)
            if m:
                parts.append(int(m.group(1)))
    return tuple(parts)

def is_newer_version(latest: str, current: str) -> bool:
    try:
        return parse_version_tuple(latest) > parse_version_tuple(current)
    except Exception:
        return False

def check_github_update(force=False, enabled=True):
    if not enabled:
        return {
            "has_update": False,
            "latest_version": APP_VERSION,
            "release_url": f"https://github.com/{GITHUB_REPO}/releases",
            "current_version": APP_VERSION,
            "check_enabled": False,
        }

    now = time.time()
    # Check persisted cache on first run
    with UPDATE_CACHE["lock"]:
        if UPDATE_CACHE["last_checked"] == 0:
            persisted = scanner.get_cached_update()
            if persisted and "last_checked" in persisted:
                UPDATE_CACHE["last_checked"] = persisted.get("last_checked", 0)
                UPDATE_CACHE["latest_version"] = persisted.get("latest_version", APP_VERSION)
                UPDATE_CACHE["release_url"] = persisted.get("release_url", f"https://github.com/{GITHUB_REPO}/releases")
                UPDATE_CACHE["has_update"] = persisted.get("has_update", False)

        # 1-hour cache window (3600 seconds) unless forced
        if not force and (now - UPDATE_CACHE["last_checked"] < 3600) and UPDATE_CACHE["last_checked"] > 0:
            return {
                "has_update": UPDATE_CACHE["has_update"],
                "latest_version": UPDATE_CACHE["latest_version"],
                "release_url": UPDATE_CACHE["release_url"],
                "current_version": APP_VERSION,
                "check_enabled": True,
            }

    try:
        url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": f"podman-systemd-dashboard-UpdateChecker/{APP_VERSION}",
                "Accept": "application/vnd.github.v3+json"
            }
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tag = data.get("tag_name", "").strip()
            html_url = data.get("html_url") or f"https://github.com/{GITHUB_REPO}/releases"
            has_update = bool(tag and is_newer_version(tag, APP_VERSION))

            with UPDATE_CACHE["lock"]:
                UPDATE_CACHE["last_checked"] = now
                UPDATE_CACHE["latest_version"] = tag or APP_VERSION
                UPDATE_CACHE["release_url"] = html_url
                UPDATE_CACHE["has_update"] = has_update

            scanner.set_cached_update({
                "last_checked": now,
                "latest_version": tag or APP_VERSION,
                "release_url": html_url,
                "has_update": has_update
            })

            return {
                "has_update": has_update,
                "latest_version": tag or APP_VERSION,
                "release_url": html_url,
                "current_version": APP_VERSION,
                "check_enabled": True,
            }
    except Exception as e:
        with UPDATE_CACHE["lock"]:
            # On error, wait 10 min before re-attempting (cooldown = 3600 - 3000 = 600s)
            UPDATE_CACHE["last_checked"] = now - 3000
            return {
                "has_update": UPDATE_CACHE["has_update"],
                "latest_version": UPDATE_CACHE["latest_version"],
                "release_url": UPDATE_CACHE["release_url"],
                "current_version": APP_VERSION,
                "check_enabled": True,
                "error": str(e)
            }

def run_periodic_scanner(interval_seconds=86400):
    global cached_data
    while True:
        try:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Running automatic daily services scan...")
            new_data = scanner.scan_all()
            with cache_lock:
                cached_data = new_data
        except Exception as e:
            print("Error in background scan:", e)
        time.sleep(interval_seconds)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global cached_data
    with cache_lock:
        cached_data = scanner.scan_all()
    # Start background thread (86400s = 24h)
    scanner_thread = threading.Thread(target=run_periodic_scanner, args=(86400,), daemon=True)
    scanner_thread.start()
    yield

app = FastAPI(title="podman-systemd-dashboard", lifespan=lifespan)

class FileUpdateRequest(BaseModel):
    content: str
    restart: bool = False

class ActionRequest(BaseModel):
    action: str

@app.get("/api/services")
def get_services():
    global cached_data
    with cache_lock:
        if cached_data is None:
            cached_data = scanner.scan_all()
        return cached_data

@app.post("/api/scan")
def trigger_scan():
    global cached_data
    try:
        new_data = scanner.scan_all()
        with cache_lock:
            cached_data = new_data
        return {"status": "ok", "data": cached_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/service/{name}/file")
def get_file(name: str):
    try:
        content, path = scanner.get_unit_content(name)
        return {"name": name, "file_path": path, "content": content}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/service/{name}/file")
def save_file(name: str, req: FileUpdateRequest):
    try:
        backup_path = scanner.save_unit_content(name, req.content)
        restarted = False
        if req.restart:
            scanner.service_action(name, "restart")
            restarted = True
            
        # Refresh cache
        trigger_scan()
        return {"status": "saved", "backup": backup_path, "restarted": restarted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/service/{name}/action")
def perform_action(name: str, req: ActionRequest):
    try:
        scanner.service_action(name, req.action)
        # Short sleep to let systemd state update
        time.sleep(0.5)
        trigger_scan()
        return {"status": "ok", "action": req.action}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SettingsUpdateRequest(BaseModel):
    show_github_btn: Optional[bool] = None
    check_for_updates: Optional[bool] = None
    show_appindex_link: Optional[bool] = None
    open_appindex_same_tab: Optional[bool] = None
    appindex_url: Optional[str] = None

@app.get("/api/settings")
def get_settings_endpoint():
    try:
        settings = scanner.get_settings()
        update_info = check_github_update(force=False, enabled=settings.get("check_for_updates", True))
        return {
            "status": "ok",
            "settings": settings,
            "update_info": update_info,
            "app_version": APP_VERSION,
            "github_repo": GITHUB_REPO
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/settings")
def update_settings_endpoint(req: SettingsUpdateRequest):
    try:
        updates = {}
        if req.show_github_btn is not None:
            updates["show_github_btn"] = req.show_github_btn
        if req.check_for_updates is not None:
            updates["check_for_updates"] = req.check_for_updates
        if req.show_appindex_link is not None:
            updates["show_appindex_link"] = req.show_appindex_link
        if req.open_appindex_same_tab is not None:
            updates["open_appindex_same_tab"] = req.open_appindex_same_tab
        if req.appindex_url is not None:
            updates["appindex_url"] = req.appindex_url
        new_settings = scanner.update_settings(updates)
        update_info = check_github_update(force=False, enabled=new_settings.get("check_for_updates", True))
        return {
            "status": "ok",
            "settings": new_settings,
            "update_info": update_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/check-update")
def check_update_endpoint():
    try:
        update_info = check_github_update(force=True, enabled=True)
        return {
            "status": "ok",
            "update_info": update_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.api_route("/favicon.ico", methods=["GET", "HEAD"], include_in_schema=False)
def favicon():
    fav_file = STATIC_DIR / "favicon.ico"
    if fav_file.exists():
        return FileResponse(fav_file)
    raise HTTPException(status_code=404)

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def root_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return "<h1>podman-systemd-dashboard</h1><p>Static files loading...</p>"

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=5100, reload=False, log_level="info")
