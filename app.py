import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

import scanner

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# In-memory cached scan result
cache_lock = threading.Lock()
cached_data = None

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

@app.get("/api/service/{name}/logs")
def get_logs(name: str, lines: int = 100):
    try:
        logs = scanner.get_service_logs(name, lines=lines)
        return {"name": name, "logs": logs}
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
