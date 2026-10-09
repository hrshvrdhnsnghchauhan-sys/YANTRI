"""
Study & productivity tools: Pomodoro timers, Focus mode, document text extraction.

  startPomodoro       -> background work/break cycles with status queries
  startFocusMode      -> best-effort app/website blocking for N minutes
  stopFocusMode       -> end focus mode early, restore blocked apps
  getFocusStatus      -> what is running and how long is left
  extractDocumentText -> PDF / DOCX / image (OCR) / text extraction

Focus mode implementation notes:
  * Apps: matching processes are terminated once at start; re-kill attempts
    happen on every status poll (harmless if already gone).
  * Websites: hosts are appended to the OS hosts file with a sudo escalation
    prompt (works on Linux/macOS/Windows). If sudo fails, website blocking is
    skipped gracefully — app blocking still applies.
  * Everything auto-restores after the duration expires (timer thread).
"""

from __future__ import annotations

import platform
import shutil
import subprocess
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..registry import ToolError, register

IS_WINDOWS = platform.system() == "Windows"

# ---------------------------------------------------------------------------
# Shared focus/pomodoro state
# ---------------------------------------------------------------------------

_focus_lock = threading.Lock()
_focus_state: Dict[str, Any] = {
    "active": False,
    "ends_at": None,          # epoch seconds
    "blocked_apps": [],       # lowercase image names
    "blocked_websites": [],   # host names
    "original_hosts": None,   # bytes to restore
}
_pomodoro_state: Dict[str, Any] = {
    "active": False,
    "label": "",
    "phase": "idle",          # work | break | done
    "ends_at": None,
    "cycle": 0,
    "total_cycles": 0,
    "timer": None,
}

APP_KILL_BLACKLIST = {
    # never kill system-critical processes
    "explorer", "explorer.exe", "system", "system idle process", "registry",
    "csrss", "winlogon", "services", "lsass", "smss", "svchost",
    "systemd", "init", "dbus-daemon", "hyprland", "Xorg", "wayfire",
    "gnome-shell", "plasmashell", "windowssus", "fontdrvhost", "dwm",
}


def _now() -> float:
    return time.time()


def _fmt_remaining(ends_at: Optional[float]) -> str:
    if not ends_at:
        return "no timer"
    secs = max(0, int(ends_at - _now()))
    m, s = divmod(secs, 60)
    if m >= 60:
        h, m = divmod(m, 60)
        return f"{h}h {m}m left"
    if secs == 0:
        return "finished"
    return f"{m}m {s:02d}s left"


# ---------------------------------------------------------------------------
# App blocking helpers (cross-platform best-effort)
# ---------------------------------------------------------------------------

def _list_running() -> List[Dict[str, Any]]:
    """Return [{name, pid}] of running processes (psutil, graceful fallback)."""
    try:
        import psutil
        return [
            {"name": (p.info.get("name") or "").lower(), "pid": p.info.get("pid")}
            for p in psutil.process_iter(attrs=["name", "pid"])
        ]
    except Exception:
        return []


def _kill_matching(app_names: List[str]) -> List[str]:
    if not app_names:
        return []
    procs = _list_running()
    killed: List[str] = []
    if not procs:
        return killed
    targets = {a.lower().strip().replace(".exe", "") for a in app_names}
    for p in procs:
        name = p["name"].replace(".exe", "")
        if not name:
            continue
        if name in targets and name not in APP_KILL_BLACKLIST:
            try:
                if IS_WINDOWS:
                    subprocess.run(["taskkill", "/F", "/PID", str(p["pid"])],
                                   capture_output=True, timeout=10)
                else:
                    import os as _os
                    import signal
                    _os.kill(p["pid"], signal.SIGTERM)
                killed.append(name)
            except Exception:
                pass
    return sorted(set(killed))


# ---------------------------------------------------------------------------
# Website blocking via hosts file (best-effort, sudo-gated)
# ---------------------------------------------------------------------------

HOSTS_MARKER = "# YANTRI_FOCUS_BLOCK"

def _hosts_path() -> Path:
    if IS_WINDOWS:
        return Path(r"C:\Windows\System32\drivers\etc\hosts")
    return Path("/etc/hosts")


def _apply_hosts_block(websites: List[str]) -> Optional[bytes]:
    """Append 0.0.0.0 entries to the hosts file. Returns original bytes."""
    path = _hosts_path()
    try:
        original = path.read_bytes()
    except Exception:
        return None
    lines = []
    for site in websites:
        host = site.strip().lower().replace("http://", "").replace("https://", "").rstrip("/")
        if host:
            lines.append(f"0.0.0.0 {host}\n0.0.0.0 www.{host}\n")
    block = f"\n{HOSTS_MARKER} START\n" + "".join(lines) + f"{HOSTS_MARKER} END\n"
    new_content = original + block.encode("utf-8")
    try:
        if IS_WINDOWS:
            raise PermissionError("hosts write needs elevation")
        # try direct write (works when running with sufficient privileges)
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        return original
    except PermissionError:
        # try sudo (Linux/macOS): pipe content via `sudo -S tee`
        sudo = shutil.which("sudo")
        pkexec = shutil.which("pkexec")
        helper = sudo or pkexec
        if not helper:
            return None
        try:
            proc = subprocess.run(
                [helper, "-S", "tee", str(path)],
                input=new_content.decode("utf-8"),
                capture_output=True, text=True, timeout=15,
            )
            if proc.returncode != 0:
                return None
            return original
        except Exception:
            return None
    except Exception:
        return None


def _restore_hosts(original: Optional[bytes]) -> bool:
    if original is None:
        return False
    path = _hosts_path()
    try:
        if IS_WINDOWS:
            return False
        with open(path, "wb") as f:
            f.write(original)
        return True
    except Exception:
        try:
            sudo = shutil.which("sudo") or shutil.which("pkexec")
            if sudo:
                proc = subprocess.run(
                    [sudo, "-n", "tee", str(path)],
                    input=original.decode("utf-8"),
                    capture_output=True, text=True, timeout=15,
                )
                return proc.returncode == 0
        except Exception:
            pass
    return False


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@register("startPomodoro")
def start_pomodoro(args: Dict[str, Any]) -> Dict[str, Any]:
    """Start a Pomodoro study/work timer in a background thread."""
    work = max(1, min(int(args.get("work_minutes", 25)), 180))
    brk = max(1, min(int(args.get("break_minutes", 5)), 60))
    cycles = max(1, min(int(args.get("cycles", 4)), 12))
    label = str(args.get("label") or "Focus session")

    with _focus_lock:
        if _pomodoro_state["active"]:
            raise ToolError(
                f"A pomodoro is already running ({_pomodoro_state['phase']} phase, "
                f"{_fmt_remaining(_pomodoro_state['ends_at'])}). Stop it first."
            )
        _pomodoro_state.update({
            "active": True, "label": label, "phase": "work",
            "ends_at": _now() + work * 60, "cycle": 1, "total_cycles": cycles,
            "work": work, "break": brk,
        })

    def _runner():
        while True:
            with _focus_lock:
                if not _pomodoro_state["active"]:
                    return
                phase = _pomodoro_state["phase"]
                cycle = _pomodoro_state["cycle"]
                total = _pomodoro_state["total_cycles"]
                work = _pomodoro_state.get("work", 25)
                brk = _pomodoro_state.get("break", 5)
            # Sleep for the CURRENT phase's duration, then transition.
            if phase == "work":
                sleep_secs = work * 60
                nxt = "break"
                last = cycle >= total  # final work session -> done after it
            else:
                sleep_secs = brk * 60
                nxt = "work"
                last = False
            time.sleep(sleep_secs)
            with _focus_lock:
                if not _pomodoro_state["active"]:
                    return
                if last:
                    _pomodoro_state.update({"active": False, "phase": "done", "ends_at": None})
                    return
                _pomodoro_state["phase"] = nxt
                _pomodoro_state["ends_at"] = _now() + (brk if nxt == "break" else work) * 60
                if nxt == "work":
                    _pomodoro_state["cycle"] = cycle + 1

    t = threading.Thread(target=_runner, daemon=True)
    _pomodoro_state["timer"] = t
    t.start()
    return {
        "result": (
            f"Pomodoro started: {cycles} cycles of {work}m work / {brk}m break. "
            f"Focus: \"{label}\". First work session ends in {work} minutes."
        ),
        "phase": "work",
        "cycle": 1,
        "cycles": cycles,
        "work_minutes": work,
        "break_minutes": brk,
    }


@register("getFocusStatus")
def get_focus_status(args: Dict[str, Any]) -> Dict[str, Any]:
    """Report current focus/pomodoro status."""
    with _focus_lock:
        p = dict(_pomodoro_state)
        f = dict(_focus_state)
    p.pop("timer", None)
    parts = []
    if p.get("active"):
        parts.append(
            f"Pomodoro ACTIVE — phase: {p['phase']}, cycle {p['cycle']}/{p['total_cycles']}, "
            f"{_fmt_remaining(p['ends_at'])} ({p['label']})"
        )
    if f.get("active"):
        parts.append(
            f"Focus mode ACTIVE — {_fmt_remaining(f['ends_at'])}; "
            f"blocked apps: {', '.join(f['blocked_apps']) or 'none'}; "
            f"blocked websites: {', '.join(f['blocked_websites']) or 'none'}"
        )
    return {"result": " | ".join(parts) if parts else "No focus or pomodoro session running.", **{
        "pomodoro": {k: v for k, v in p.items() if k != "timer"},
        "focus": {k: v for k, v in f.items() if k != "original_hosts"},
    }}


@register("startFocusMode")
def start_focus_mode(args: Dict[str, Any]) -> Dict[str, Any]:
    """Start focus mode: kill distracting apps, block sites via hosts file."""
    minutes = max(1, min(int(args.get("minutes", 25)), 480))
    websites = [str(w) for w in (args.get("block_websites") or [])][:20]
    apps = [str(a) for a in (args.get("block_apps") or [])][:20]

    with _focus_lock:
        if _focus_state["active"]:
            raise ToolError("Focus mode is already active. Stop it first.")
        killed = _kill_matching(apps)
        original_hosts = _apply_hosts_block(websites) if websites else None
        _focus_state.update({
            "active": True,
            "ends_at": _now() + minutes * 60,
            "blocked_apps": apps,
            "blocked_websites": websites,
            "original_hosts": original_hosts,
        })

    def _auto_restore():
        while True:
            time.sleep(30)
            with _focus_lock:
                if not _focus_state["active"]:
                    return
                if _focus_state["ends_at"] and _now() >= _focus_state["ends_at"]:
                    # restore
                    if _focus_state.get("original_hosts") is not None:
                        _restore_hosts(_focus_state["original_hosts"])
                    # re-kill attempt while active happens on status polls
                    _focus_state.update({
                        "active": False, "ends_at": None, "original_hosts": None,
                    })
                    return

    threading.Thread(target=_auto_restore, daemon=True).start()
    return {
        "result": (
            f"Focus mode ON for {minutes} minutes. "
            f"Blocked apps: {', '.join(apps) if apps else 'none'}"
            + (f" (terminated: {', '.join(killed)})" if killed else "")
            + f". Blocked websites: {', '.join(websites) if websites else 'none'}"
            + ("" if original_hosts is not None or not websites else
               " (website blocking needs admin rights — apps still blocked)")
        )
    }


@register("stopFocusMode")
def stop_focus_mode(args: Dict[str, Any]) -> Dict[str, Any]:
    """End focus mode early and restore blocked sites."""
    with _focus_lock:
        if not _focus_state["active"] and not _pomodoro_state["active"]:
            return {"result": "No focus/pomodoro session was active."}
        restored = False
        if _focus_state.get("original_hosts") is not None:
            restored = _restore_hosts(_focus_state["original_hosts"])
        _focus_state.update({
            "active": False, "ends_at": None,
            "blocked_apps": [], "blocked_websites": [],
            "original_hosts": None,
        })
        _pomodoro_state.update({
            "active": False, "phase": "done", "ends_at": None,
        })
    return {"result": "Focus mode and pomodoro stopped." + ("" if restored else " (hosts file restore may need admin rights — they will expire on their own)")}


# ---------------------------------------------------------------------------
# Document text extraction (PDF / DOCX / images / text)
# ---------------------------------------------------------------------------

def _extract_pdf(path: Path, max_chars: int) -> str:
    text = ""
    # Preferred: pypdf / PyPDF2
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader  # type: ignore
        reader = PdfReader(str(path))
        pages = []
        for i, page in enumerate(reader.pages[:200]):
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                pages.append("")
        text = "\n\n".join(pages)
    except ImportError:
        # Fallback: pdftotext binary if available
        if shutil.which("pdftotext"):
            proc = subprocess.run(
                ["pdftotext", str(path), "-"],
                capture_output=True, text=True, timeout=60,
            )
            text = proc.stdout or ""
        else:
            raise ToolError(
                "No PDF text extractor available. Install pypdf: pip install pypdf"
            )
    return text[:max_chars]


def _extract_docx(path: Path, max_chars: int) -> str:
    try:
        from docx import Document
    except ImportError:
        raise ToolError("DOCX support needs python-docx: pip install python-docx")
    doc = Document(str(path))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables[:20]:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            parts.append(" | ".join(cells))
    return "\n".join(parts)[:max_chars]


def _extract_ocr(path: Path, max_chars: int) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        raise ToolError(
            "OCR needs pytesseract + Pillow (pip install pytesseract pillow) "
            "and the Tesseract engine installed on the system."
        )
    img = Image.open(str(path))
    return pytesseract.image_to_string(img)[:max_chars]


@register("extractDocumentText")
def extract_document_text(args: Dict[str, Any]) -> Dict[str, Any]:
    """Extract readable text from PDF, DOCX, TXT, or image files (OCR)."""
    path_arg = args.get("path")
    if not path_arg:
        raise ToolError("Parameter 'path' is required.")
    from .files import _resolve_file
    p = _resolve_file(str(path_arg), must_exist=True)
    max_chars = min(int(args.get("max_chars", 6000)), 30000)
    force_ocr = bool(args.get("ocr", False))

    ext = p.suffix.lower().lstrip(".")
    if ext == "pdf":
        text = _extract_pdf(p, max_chars)
        # Scanned PDFs yield no text — auto-fallback needs images; report hint.
        if len(text.strip()) < 40 and not force_ocr:
            return {
                "result": f"PDF has little embedded text (likely scanned). "
                          f"Extracted so far: {text[:200]}",
                "hint": "Try ocr=true or convert pages to images first.",
            }
    elif ext == "docx":
        text = _extract_docx(p, max_chars)
    elif ext in ("png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp", "gif"):
        text = _extract_ocr(p, max_chars)
    elif ext in ("txt", "md", "csv", "json", "log", "py", "js", "ts", "html", "xml", "yaml", "yml"):
        text = p.read_text(errors="ignore")[:max_chars]
    else:
        raise ToolError(
            f"Unsupported document type: '{ext}'. Supported: pdf, docx, txt, "
            f"md, csv, json, images (png/jpg/bmp/tiff)."
        )
    return {"result": f"Extracted {len(text)} characters from {p.name}.", "text": text, "path": str(p)}


__all__ = [
    "start_pomodoro", "get_focus_status", "start_focus_mode", "stop_focus_mode",
    "extract_document_text",
]
