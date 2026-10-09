"""
YANTRI Desktop Control Agent — FastAPI entrypoint.

Single dispatch endpoint POST /execute { tool, args } -> { result } | { error }.
YANTRI's Node bridge (server.ts) calls this over HTTP on 127.0.0.1:8765.

Run:
    uvicorn agent.server:app --host 127.0.0.1 --port 8765
or:
    python -m agent.server
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .registry import DESKTOP_TOOL_NAMES, TOOLS, ToolError, load_all

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("yantri.desktop")


load_all()
log.info("Loaded %d desktop tools: %s", len(TOOLS), ", ".join(sorted(TOOLS)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("YANTRI Desktop Control Agent v%s starting up.", __version__)
    yield
    try:
        from .tools.browser import shutdown_browser

        shutdown_browser()
    except Exception as e:
        log.warning("Browser shutdown error: %s", e)
    log.info("YANTRI Desktop Control Agent stopped.")


app = FastAPI(
    title="YANTRI Desktop Control Agent",
    version=__version__,
    description="JARVIS-style desktop automation backend for YANTRI.",
    lifespan=lifespan,
    # Request size limit: 10MB max
    max_request_size=10 * 1024 * 1024,
)

# CORS configuration - restrict to YANTRI frontend origins
allowed_origins = os.environ.get("YANTRI_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Agent-Secret"],
)


class ExecuteRequest(BaseModel):
    tool: str
    args: Dict[str, Any] = {}


class ExecuteResponse(BaseModel):
    ok: bool
    result: Any = None
    error: str | None = None
    tool: str = ""


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "tools": sorted(TOOLS),
        "tool_count": len(TOOLS),
    }


@app.get("/tools")
async def list_tools():
    return sorted(TOOLS)


# Shared secret for Node ↔ Python agent authentication
AGENT_SHARED_SECRET = os.environ.get("AGENT_SHARED_SECRET", "")

async def verify_agent_secret(request: Request) -> bool:
    """Verify the shared secret from Node server."""
    if not AGENT_SHARED_SECRET:
        return True  # No secret configured, allow all (backward compatibility)
    secret = request.headers.get("X-Agent-Secret")
    return secret == AGENT_SHARED_SECRET


@app.post("/execute", response_model=ExecuteResponse)
async def execute(request: Request, req: ExecuteRequest) -> ExecuteResponse:
    # Verify shared secret
    if not await verify_agent_secret(request):
        log.warning("Invalid or missing agent secret from %s", request.client.host)
        return ExecuteResponse(ok=False, error="Unauthorized: Invalid agent secret", tool=req.tool)
    
    tool_name = req.tool
    args = req.args or {}
    if tool_name not in TOOLS:
        return ExecuteResponse(ok=False, error=f"Unknown tool: {tool_name}", tool=tool_name)
    handler = TOOLS[tool_name]
    try:
        if inspect.iscoroutinefunction(handler):
            result = await handler(args)
        else:
            result = await asyncio.to_thread(handler, args)
        return ExecuteResponse(ok=True, result=result, tool=tool_name)
    except ToolError as e:
        return ExecuteResponse(ok=False, error=str(e), tool=tool_name)
    except Exception as e:
        log.exception("Tool %s failed", tool_name)
        return ExecuteResponse(ok=False, error=f"{type(e).__name__}: {e}", tool=tool_name)


def main() -> None:
    import uvicorn

    host = os.environ.get("YANTRI_AGENT_HOST", "127.0.0.1")
    port = int(os.environ.get("YANTRI_AGENT_PORT", "8765"))
    log.info("Launching uvicorn on %s:%d", host, port)
    uvicorn.run(
        "agent.server:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
