"""
Google Calendar, Gmail, and Tasks integration via OAuth 2.0.

Setup:
  1. Go to https://console.cloud.google.com/ → Create Project
  2. Enable APIs: Calendar API, Gmail API, Google Tasks API
  3. Create OAuth 2.0 credentials (Desktop application type)
  4. Download credentials.json
  5. Place at: ~/.yantri/google_oauth/credentials.json
  6. First tool call will open a browser for OAuth consent
  7. Token saved to ~/.yantri/google_oauth/token.json (auto-refreshed)
"""

from __future__ import annotations

import json
import os
import pickle
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict

from ..registry import ToolError, register

import re as _re

# Optional import — HttpError gives friendlier OAuth/API diagnostics.
try:
    from googleapiclient.errors import HttpError  # noqa: F401
except Exception:  # pragma: no cover
    HttpError = Exception  # type: ignore

# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------

SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/tasks",
]

_OAUTH_DIR = Path.home() / ".yantri" / "google_oauth"
_CREDENTIALS_PATH = _OAUTH_DIR / "credentials.json"
_TOKEN_PATH = _OAUTH_DIR / "token.pickle"

# Lazy-loaded service references
_calendar_service = None
_gmail_service = None
_tasks_service = None


def _ensure_credentials() -> Any:
    """Return an authenticated Google API credentials object.

    Raises ToolError if credentials.json is missing or auth fails.
    """
    if not _CREDENTIALS_PATH.exists():
        raise ToolError(
            "Google API not configured. "
            f"Place your OAuth credentials.json at: {_CREDENTIALS_PATH}\n\n"
            "Setup steps:\n"
            "1. Go to https://console.cloud.google.com/ → Create Project\n"
            "2. Enable: Calendar API, Gmail API, Google Tasks API\n"
            "3. Create OAuth 2.0 credentials (Desktop app type)\n"
            "4. Download credentials.json and save to ~/.yantri/google_oauth/"
        )

    import google.auth.exceptions
    from google.auth.transport.requests import Request as AuthRequest
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if _TOKEN_PATH.exists():
        with open(_TOKEN_PATH, "rb") as f:
            creds = pickle.load(f)

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(AuthRequest())
        except Exception as e:
            creds = None

    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(
            str(_CREDENTIALS_PATH), SCOPES
        )
        creds = flow.run_local_server(port=0, open_browser=True)
        _OAUTH_DIR.mkdir(parents=True, exist_ok=True)
        with open(_TOKEN_PATH, "wb") as f:
            pickle.dump(creds, f)

    return creds


def _build_service(api: str, version: str, creds: Any) -> Any:
    """Build a Google API service with a friendly error if the client lib is missing."""
    try:
        from googleapiclient.discovery import build
    except ImportError:
        raise ToolError(
            "The Google API client library is not installed on this machine. "
            "Install it with: pip install google-api-python-client google-auth-oauthlib"
        )
    return build(api, version, credentials=creds)


def _calendar():
    global _calendar_service
    if _calendar_service is None:
        _calendar_service = _build_service("calendar", "v3", _ensure_credentials())
    return _calendar_service


def _gmail():
    global _gmail_service
    if _gmail_service is None:
        _gmail_service = _build_service("gmail", "v1", _ensure_credentials())
    return _gmail_service


def _tasks():
    global _tasks_service
    if _tasks_service is None:
        _tasks_service = _build_service("tasks", "v1", _ensure_credentials())
    return _tasks_service


# ---------------------------------------------------------------------------
# Calendar tools
# ---------------------------------------------------------------------------


@register("getCalendarEvents")
def get_calendar_events(args: Dict[str, Any]) -> Dict[str, Any]:
    """List upcoming Google Calendar events.

    Args:
        max_results: Number of events to return (default 10)
        days_ahead: How many days ahead to look (default 7)
        show_all: Return all details including description/location (default false)
    """
    max_results = min(int(args.get("max_results", 10)), 50)
    days_ahead = max(1, int(args.get("days_ahead", 7)))
    show_all = bool(args.get("show_all", False))

    now = datetime.utcnow()
    time_min = now.isoformat() + "Z"
    time_max = (now + timedelta(days=days_ahead)).isoformat() + "Z"

    try:
        events_result = (
            _calendar()
            .events()
            .list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        items = events_result.get("items", [])
    except Exception as e:
        raise ToolError(f"Failed to fetch calendar events: {e}")

    if not items:
        return {"result": f"No upcoming events found in the next {days_ahead} days.", "events": []}

    result = []
    for ev in items:
        start = ev["start"].get("dateTime", ev["start"].get("date", "Unknown"))
        end = ev["end"].get("dateTime", ev["end"].get("date", "Unknown"))
        entry = {
            "summary": ev.get("summary", "(No title)"),
            "start": start,
            "end": end,
            "htmlLink": ev.get("htmlLink", ""),
        }
        if show_all:
            entry["description"] = ev.get("description", "")
            entry["location"] = ev.get("location", "")
            entry["attendees"] = [
                {"email": a.get("email", ""), "responseStatus": a.get("responseStatus", "unknown")}
                for a in ev.get("attendees", [])
            ]
        result.append(entry)

    return {
        "result": f"Found {len(result)} event(s) in the next {days_ahead} days.",
        "events": result,
    }


@register("searchCalendarEvents")
def search_calendar_events(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search calendar events (title keywords + optional time window) with ids.

    Used by Yantri's server-side sync to import exam/meeting events into the
    Data Vault, and available as a general tool for voice queries like
    "find my events containing physics".

    Args:
        query: Case-insensitive keywords to match in the event title (optional).
        days_ahead: How many days ahead to search (default 90, max 365).
        days_back: How many days back to include (default 0, max 365).
        max_results: Max events to return (default 50, max 100).
    """
    query = str(args.get("query", "")).strip().lower()
    days_ahead = min(max(1, int(args.get("days_ahead", 90))), 365)
    days_back = min(max(0, int(args.get("days_back", 0))), 365)
    max_results = min(max(1, int(args.get("max_results", 50))), 100)

    now = datetime.now().astimezone()
    time_min = (now - timedelta(days=days_back)).isoformat()
    time_max = (now + timedelta(days=days_ahead)).isoformat()

    try:
        events_result = (
            _calendar()
            .events()
            .list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                maxResults=250,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        items = events_result.get("items", [])
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Failed to search calendar events: {e}")

    result = []
    for ev in items:
        summary = ev.get("summary", "") or ""
        if query and query not in summary.lower():
            continue
        start = ev["start"].get("dateTime", ev["start"].get("date", ""))
        end = ev["end"].get("dateTime", ev["end"].get("date", ""))
        result.append({
            "id": ev.get("id", ""),
            "summary": summary,
            "start": start,
            "end": end,
            "description": (ev.get("description", "") or "")[:500],
            "htmlLink": ev.get("htmlLink", ""),
        })
        if len(result) >= max_results:
            break

    if not result:
        scope = f"'{query}' " if query else ""
        return {"result": f"No calendar events matching {scope}in the next {days_ahead} day(s).", "events": []}
    return {
        "result": f"Found {len(result)} calendar event(s).",
        "events": result,
    }


@register("createCalendarEvent")
def create_calendar_event(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a Google Calendar event.

    Args:
        summary: Event title (required)
        description: Event description (optional)
        start_time: Start time in ISO format, e.g. '2026-07-24T14:00:00'
                   If only date like '2026-07-24', creates an all-day event
        end_time: End time in ISO format (required if start_time has time)
        location: Event location (optional)
        attendees: Comma-separated email addresses (optional)
    """
    summary = args.get("summary")
    if not summary:
        raise ToolError("'summary' (event title) is required.")

    start_time = args.get("start_time", "")
    end_time = args.get("end_time", "")
    description = args.get("description", "")
    location = args.get("location", "")

    # All-day events (date only) use the Google "date" key, NOT a dateTime with
    # a made-up timezone — this keeps the event on the intended calendar day.
    if start_time and "T" not in start_time:
        date_match = _re.match(r"^(\d{4})-(\d{2})-(\d{2})$", start_time.strip())
        if not date_match:
            raise ToolError(
                f"Invalid start_time '{start_time}'. Use a date '2026-07-24' "
                f"(all-day) or datetime '2026-07-24T14:00:00'."
            )
        end_date = (end_time or start_time).strip()
        if not _re.match(r"^\d{4}-\d{2}-\d{2}$", end_date):
            end_date = start_time.strip()
        event = {
            "summary": summary,
            "start": {"date": start_time[:10]},
            "end": {"date": end_date[:10]},
        }
        if description:
            event["description"] = description
        if location:
            event["location"] = location
        attendees_raw = args.get("attendees", "")
        if attendees_raw:
            event["attendees"] = [{"email": e.strip()} for e in attendees_raw.split(",") if e.strip()]
        try:
            created = _calendar().events().insert(calendarId="primary", body=event).execute()
            return {
                "result": f"All-day event created: \"{summary}\" on {start_time[:10]}",
                "eventLink": created.get("htmlLink", ""),
                "id": created.get("id", ""),
            }
        except ToolError:
            raise
        except Exception as e:
            raise ToolError(f"Failed to create event: {e}")

    # Timed events: accept naive ISO (treated in the machine's local timezone)
    # or timezone-aware ISO. End defaults to start + 1h when omitted.
    if not start_time:
        start_time = datetime.now().astimezone().isoformat()
    try:
        start_dt = datetime.fromisoformat(start_time)
    except ValueError:
        raise ToolError(f"Invalid start_time '{start_time}'. Use ISO format like '2026-07-24T14:00:00'.")

    if end_time:
        try:
            end_dt = datetime.fromisoformat(end_time)
        except ValueError:
            raise ToolError(f"Invalid end_time '{end_time}'. Use ISO format like '2026-07-24T15:00:00'.")
    else:
        end_dt = start_dt + timedelta(hours=1)

    def _to_api_dict(dt: datetime) -> Dict[str, str]:
        if dt.tzinfo is None:
            dt = dt.astimezone()  # attach local timezone
        return {"dateTime": dt.isoformat(), "timeZone": str(dt.tzinfo)}

    event = {
        "summary": summary,
        "start": _to_api_dict(start_dt),
        "end": _to_api_dict(end_dt),
    }
    if description:
        event["description"] = description
    if location:
        event["location"] = location

    attendees_raw = args.get("attendees", "")
    if attendees_raw:
        event["attendees"] = [{"email": e.strip()} for e in attendees_raw.split(",") if e.strip()]

    try:
        created = _calendar().events().insert(calendarId="primary", body=event).execute()
        return {
            "result": f"Event created: \"{summary}\"",
            "eventLink": created.get("htmlLink", ""),
            "id": created.get("id", ""),
        }
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Failed to create event: {e}")


@register("updateCalendarEvent")
def update_calendar_event(args: Dict[str, Any]) -> Dict[str, Any]:
    """Patch an existing Google Calendar event (partial update).

    Args:
        event_id: Calendar event id (required)
        summary / description / location / start_time / end_time: optional new values
    """
    event_id = args.get("event_id")
    if not event_id:
        raise ToolError("'event_id' is required.")

    try:
        existing = _calendar().events().get(calendarId="primary", eventId=str(event_id)).execute()
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Event not found (it may have been deleted from Google Calendar): {e}")

    patch: Dict[str, Any] = {}
    if args.get("summary"):
        patch["summary"] = args["summary"]
    if args.get("description"):
        patch["description"] = args["description"]
    if args.get("location"):
        patch["location"] = args["location"]

    start_time = args.get("start_time", "")
    end_time = args.get("end_time", "")
    if start_time and "T" not in start_time:
        patch["start"] = {"date": start_time[:10]}
        patch["end"] = {"date": (end_time or start_time)[:10]}
    else:
        if start_time:
            try:
                sdt = datetime.fromisoformat(start_time)
            except ValueError:
                raise ToolError(f"Invalid start_time '{start_time}'.")
            if sdt.tzinfo is None:
                sdt = sdt.astimezone()
            patch["start"] = {"dateTime": sdt.isoformat(), "timeZone": str(sdt.tzinfo)}
        if end_time:
            try:
                edt = datetime.fromisoformat(end_time)
            except ValueError:
                raise ToolError(f"Invalid end_time '{end_time}'.")
            if edt.tzinfo is None:
                edt = edt.astimezone()
            patch["end"] = {"dateTime": edt.isoformat(), "timeZone": str(edt.tzinfo)}

    if not patch:
        return {"result": "Nothing to update.", "id": str(event_id)}

    try:
        updated = (
            _calendar()
            .events()
            .update(calendarId="primary", eventId=str(event_id), body={**existing, **patch})
            .execute()
        )
        return {
            "result": f"Event updated: \"{updated.get('summary', event_id)}\"",
            "eventLink": updated.get("htmlLink", ""),
            "id": updated.get("id", ""),
        }
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Failed to update event: {e}")


@register("deleteCalendarEvent")
def delete_calendar_event(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a Google Calendar event by id.

    Args:
        event_id: Calendar event id (required)
    """
    event_id = args.get("event_id") or args.get("id")
    if not event_id:
        raise ToolError("'event_id' is required.")
    try:
        _calendar().events().delete(calendarId="primary", eventId=str(event_id)).execute()
        return {"result": f"Event {event_id} deleted."}
    except ToolError:
        raise
    except Exception as e:
        # 404/410 → already gone; treat as success so sync stays idempotent.
        msg = str(e)
        if "404" in msg or "410" in msg:
            return {"result": f"Event {event_id} already gone."}
        raise ToolError(f"Failed to delete event: {e}")


# ---------------------------------------------------------------------------
# Gmail tools
# ---------------------------------------------------------------------------


@register("sendEmail")
def send_email(args: Dict[str, Any]) -> Dict[str, Any]:
    """Send an email via Gmail.

    Args:
        to: Recipient email address (required). Comma-separated for multiple.
        subject: Email subject (required)
        body: Email body text (required)
        cc: CC email address (optional)
    """
    import re as _re

    to = args.get("to")
    subject = args.get("subject")
    body = args.get("body")
    cc = args.get("cc", "")

    # --- Robust recipient handling -------------------------------------------
    # Tolerates spoken garbage like "ravi at gmail dot com" and whitespace.
    def _fix_spoken(addr: str) -> str:
        a = addr.strip().lower()
        a = _re.sub(r"\s*at\s*", "@", a)
        a = _re.sub(r"\bdot\b", ".", a)
        a = _re.sub(r"\s+", "", a)  # addresses never contain spaces
        return a

    if to:
        # Repair spoken form FIRST (it contains spaces), then split.
        raw = str(to).lower()
        raw = _re.sub(r"\bdot\b", ".", raw)
        raw = _re.sub(r"\s+at\s+", "@", raw)
        # collapse spaces around @ and between word.dot boundaries
        raw = _re.sub(r"\s*@\s*", "@", raw)
        raw = _re.sub(r"([a-z0-9])\s*\.\s*([a-z0-9])", r"\1.\2", raw)
        addresses = [_fix_spoken(x) for x in _re.split(r"[,;\s]+", raw) if x.strip()]
        bad = [a for a in addresses if not _re.match(r"^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$", a)]
        if bad:
            raise ToolError(
                f"These don't look like valid email addresses: {', '.join(bad)}. "
                f"Ask the user to confirm the exact address before sending."
            )
        to = ", ".join(addresses)

    if not to or not subject or not body:
        raise ToolError("'to', 'subject', and 'body' are all required.")

    import base64
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg["From"] = "me"
    if cc:
        msg["Cc"] = cc
    msg.set_content(body)

    try:
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        _gmail().users().messages().send(userId="me", body={"raw": raw}).execute()
        return {"result": f"Email sent to {to}: \"{subject}\""}
    except ToolError:
        raise  # setup/validation errors already carry user-friendly guidance
    except HttpError as e:
        status = getattr(e.resp, "status", None) if hasattr(e, "resp") else None
        if status == 403:
            raise ToolError(
                "Gmail API rejected the request (403). Check that the Gmail API is "
                "enabled in your Google Cloud project and the OAuth scopes include "
                "gmail.send, then try again."
            )
        if status == 401:
            raise ToolError(
                "Google authentication expired. Delete ~/.yantri/google_oauth/token.pickle "
                "and try again to re-run the OAuth consent flow."
            )
        raise ToolError(f"Failed to send email: {e}")
    except Exception as e:
        raise ToolError(f"Failed to send email: {e}")


@register("getEmails")
def get_emails(args: Dict[str, Any]) -> Dict[str, Any]:
    """List recent emails from Gmail inbox.

    Args:
        max_results: Number of emails to return (default 5, max 20)
        query: Gmail search filter (optional), e.g. 'from:someone@email.com' or 'subject:meeting'
    """
    max_results = min(int(args.get("max_results", 5)), 20)
    query = args.get("query", "")

    try:
        result = _gmail().users().messages().list(userId="me", q=query, maxResults=max_results).execute()
        messages = result.get("messages", [])
    except Exception as e:
        raise ToolError(f"Failed to fetch emails: {e}")

    if not messages:
        return {"result": "No emails found matching your criteria.", "emails": []}

    emails = []
    for msg in messages:
        try:
            detail = _gmail().users().messages().get(userId="me", id=msg["id"], format="metadata", metadataHeaders=["From", "Subject", "Date"]).execute()
            headers = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
            snippet = detail.get("snippet", "")
            emails.append({
                "id": msg["id"],
                "from": headers.get("From", "Unknown"),
                "subject": headers.get("Subject", "(No subject)"),
                "date": headers.get("Date", "Unknown"),
                "snippet": snippet,
            })
        except Exception:
            continue

    return {
        "result": f"Found {len(emails)} email(s).",
        "emails": emails,
    }


# ---------------------------------------------------------------------------
# Google Tasks tools
# ---------------------------------------------------------------------------


@register("getTasks")
def get_tasks(args: Dict[str, Any]) -> Dict[str, Any]:
    """List tasks from Google Tasks.

    Args:
        tasklist: Task list title (default 'My Tasks')
        max_results: Max tasks to return (default 10)
        show_completed: Include completed tasks (default false)
    """
    tasklist_title = args.get("tasklist", "My Tasks")
    max_results = min(int(args.get("max_results", 10)), 50)
    show_completed = bool(args.get("show_completed", False))

    try:
        lists = _tasks().tasklists().list().execute().get("items", [])
        tl = next((t for t in lists if t["title"].lower() == tasklist_title.lower()), None)
        if not tl:
            available = ", ".join(t["title"] for t in lists) if lists else "No task lists found"
            raise ToolError(f"Task list '{tasklist_title}' not found. Available: {available}")
        tl_id = tl["id"]

        tasks_result = _tasks().tasks().list(tasklist=tl_id, maxResults=max_results, showCompleted=show_completed).execute()
        items = tasks_result.get("items", [])
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Failed to fetch tasks: {e}")

    if not items:
        return {"result": f"No tasks in '{tasklist_title}'.", "tasks": []}

    result = []
    for t in items:
        result.append({
            "title": t.get("title", "(Untitled)"),
            "notes": t.get("notes", ""),
            "due": t.get("due", ""),
            "status": t.get("status", "needsAction"),
            "id": t.get("id", ""),
        })

    return {
        "result": f"Found {len(result)} task(s) in '{tasklist_title}'.",
        "tasks": result,
    }


@register("createTask")
def create_task(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a task in Google Tasks.

    Args:
        title: Task title (required)
        notes: Task notes/description (optional)
        due: Due date in ISO format, e.g. '2026-07-30' (optional)
        tasklist: Task list title (default 'My Tasks')
    """
    title = args.get("title")
    if not title:
        raise ToolError("'title' is required.")

    notes = args.get("notes", "")
    due = args.get("due", "")
    tasklist_title = args.get("tasklist", "My Tasks")

    body = {"title": title}
    if notes:
        body["notes"] = notes
    if due:
        body["due"] = due

    try:
        lists = _tasks().tasklists().list().execute().get("items", [])
        tl = next((t for t in lists if t["title"].lower() == tasklist_title.lower()), None)
        if not tl:
            available = ", ".join(t["title"] for t in lists) if lists else "No task lists found"
            raise ToolError(f"Task list '{tasklist_title}' not found. Available: {available}")

        created = _tasks().tasks().insert(tasklist=tl["id"], body=body).execute()
        return {
            "result": f"Task created: \"{title}\"",
            "id": created.get("id", ""),
        }
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Failed to create task: {e}")


__all__ = [
    "get_calendar_events",
    "search_calendar_events",
    "create_calendar_event",
    "update_calendar_event",
    "delete_calendar_event",
    "send_email",
    "get_emails",
    "get_tasks",
    "create_task",
]
