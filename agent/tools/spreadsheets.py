"""
Spreadsheet tools: create, append to, read and summarise CSV/XLSX files.

  writeSpreadsheet      -> create a new sheet with headers + rows
  appendSpreadsheetRows -> append rows (create with headers if missing)
  readSpreadsheet       -> read rows from a sheet
  summarizeSpreadsheet  -> stats: counts, numeric column aggregates, preview
  logInventoryEntry     -> one-step inventory logger (append + record)

Uses openpyxl for .xlsx when available; CSV is always available (stdlib).
Numbers are preserved as numbers so summarizeSpreadsheet can aggregate.
"""

from __future__ import annotations

import csv
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Sequence, cast

from ..registry import ToolError, register
from .files import ensure_safe


def _resolve_sheet_path(raw: str, must_exist: bool = False) -> Path:
    if not raw:
        raise ToolError("Parameter 'path' is required.")
    p = Path(os.path.expandvars(os.path.expanduser(str(raw)))).resolve()
    if must_exist and not p.exists():
        raise ToolError(f"Spreadsheet not found: {p}")
    if p.suffix.lower() not in (".csv", ".xlsx"):
        # default to xlsx for extension-less paths
        p = p.with_suffix(".xlsx")
    ensure_safe(p)
    return p


def _coerce_cell(value: Any) -> Any:
    """Best-effort type coercion for CSV cells."""
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return value
    s = str(value).strip()
    try:
        if s and (s.isdigit() or (s.replace(".", "", 1).isdigit() and s.count(".") <= 1)):
            return float(s) if "." in s else int(s)
    except Exception:
        pass
    return s


def _rows_from_args(rows_arg: Any) -> List[List[Any]]:
    if rows_arg is None:
        return []
    if not isinstance(rows_arg, list):
        raise ToolError("'rows' must be an array of rows (each row an array of cell values).")
    rows: List[List[Any]] = []
    for r in cast(List[Any], rows_arg):
        if isinstance(r, list):
            rows.append([_coerce_cell(c) for c in cast(List[Any], r)])
        elif isinstance(r, (int, float, str)):
            rows.append([_coerce_cell(r)])
        else:
            # dict row — take values in insertion order
            if isinstance(r, dict):
                rows.append([_coerce_cell(v) for v in cast(Dict[str, Any], r).values()])
            else:
                rows.append([str(r)])
    return rows


def _headers_from_args(headers_arg: Any) -> List[str]:
    if headers_arg is None:
        return []
    if isinstance(headers_arg, list):
        return [str(h) for h in cast(List[Any], headers_arg)]
    if isinstance(headers_arg, str):
        return [h.strip() for h in headers_arg.split(",") if h.strip()]
    raise ToolError("'headers' must be an array of column names.")


# ---------------------------------------------------------------------------
# XLSX helpers (openpyxl lazy-imported)
# ---------------------------------------------------------------------------

def _openpyxl() -> Any:
    try:
        import openpyxl
    except ImportError:
        return None
    return openpyxl


def _xlsx_write(path: Path, sheet_name: str, headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> None:
    openpyxl = _openpyxl()
    if openpyxl is None:
        raise ToolError("Writing .xlsx needs openpyxl: pip install openpyxl (or use a .csv path).")
    wb = openpyxl.Workbook()
    ws: Any = wb.active
    ws.title = sheet_name or "Sheet1"
    if headers:
        ws.append(list(headers))
    for row in rows:
        ws.append(list(row))
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(path))


def _xlsx_append(path: Path, sheet_name: str, headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> int:
    openpyxl = _openpyxl()
    if openpyxl is None:
        raise ToolError("Appending to .xlsx needs openpyxl: pip install openpyxl (or use a .csv path).")
    if path.exists():
        wb = openpyxl.load_workbook(str(path))
        ws: Any = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
    else:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = sheet_name or "Sheet1"
        if headers:
            ws.append(list(headers))
    for row in rows:
        ws.append(list(row))
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(path))
    return len(rows)


def _xlsx_read(path: Path, sheet_name: str, max_rows: int, max_cols: int):
    openpyxl = _openpyxl()
    if openpyxl is None:
        raise ToolError("Reading .xlsx needs openpyxl: pip install openpyxl (or use a .csv path).")
    wb = openpyxl.load_workbook(str(path), data_only=True)
    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb[wb.sheetnames[0]]
    out: List[List[Any]] = []
    for row in ws.iter_rows(max_row=max_rows, max_col=max_cols, values_only=True):
        out.append(list(row))
    return out, ws.title


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def _csv_write(path: Path, headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if headers:
            w.writerow(list(headers))
        w.writerows(rows)


def _csv_append(path: Path, headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> int:
    exists = path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if not exists and headers:
            w.writerow(list(headers))
        w.writerows(rows)
    return len(rows)


def _csv_read(path: Path, max_rows: int, max_cols: int):
    with open(path, "r", newline="", encoding="utf-8", errors="ignore") as f:
        reader = csv.reader(f)
        out: List[List[Any]] = []
        for i, row in enumerate(reader):
            if i >= max_rows:
                break
            out.append([_coerce_cell(c) for c in row[:max_cols]])
    return out, "csv"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@register("writeSpreadsheet")
def write_spreadsheet(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new CSV/XLSX spreadsheet with headers and rows."""
    path = _resolve_sheet_path(str(args.get("path", "")))
    sheet_name = str(args.get("sheet_name") or "Sheet1")
    headers = _headers_from_args(args.get("headers"))
    rows = _rows_from_args(args.get("rows"))
    overwrite = bool(args.get("overwrite", False))

    if path.exists() and not overwrite:
        raise ToolError(f"File already exists: {path}. Pass overwrite=true to replace.")

    if path.suffix.lower() == ".csv":
        _csv_write(path, headers, rows)
    else:
        _xlsx_write(path, sheet_name, headers, rows)
    return {
        "result": f"Created {path.suffix.lower()[1:].upper()} with {len(rows)} rows: {path}",
        "path": str(path),
        "rows_written": len(rows),
    }


@register("appendSpreadsheetRows")
def append_spreadsheet_rows(args: Dict[str, Any]) -> Dict[str, Any]:
    """Append rows to a CSV/XLSX file, creating it with headers when missing."""
    path = _resolve_sheet_path(str(args.get("path", "")))
    sheet_name = str(args.get("sheet_name") or "Sheet1")
    headers = _headers_from_args(args.get("headers"))
    rows = _rows_from_args(args.get("rows"))
    if not rows:
        raise ToolError("No rows provided to append.")

    if path.suffix.lower() == ".csv":
        n = _csv_append(path, headers, rows)
    else:
        n = _xlsx_append(path, sheet_name, headers, rows)
    return {"result": f"Appended {n} row(s) to {path.name}.", "path": str(path), "rows_appended": n}


@register("readSpreadsheet")
def read_spreadsheet(args: Dict[str, Any]) -> Dict[str, Any]:
    """Read rows from a CSV/XLSX file."""
    path = _resolve_sheet_path(str(args.get("path", "")), must_exist=True)
    sheet_name = str(args.get("sheet_name") or "")
    max_rows = max(1, min(int(args.get("max_rows", 100)), 1000))
    max_cols = max(1, min(int(args.get("max_cols", 20)), 100))

    if path.suffix.lower() == ".csv":
        grid, used = _csv_read(path, max_rows, max_cols)
    else:
        grid, used = _xlsx_read(path, sheet_name, max_rows, max_cols)

    if not grid:
        return {"result": "The sheet is empty.", "rows": []}
    headers = [str(h) for h in grid[0]]
    data_rows = grid[1:]
    as_dicts = [dict(zip(headers, r)) for r in data_rows]
    preview = "\n".join(
        " | ".join("" if c is None else str(c) for c in row) for row in grid[:15]
    )
    return {
        "result": f"Read {len(data_rows)} row(s) from {path.name} (sheet: {used}).\n{preview}",
        "headers": headers,
        "rows": as_dicts,
    }


@register("summarizeSpreadsheet")
def summarize_spreadsheet(args: Dict[str, Any]) -> Dict[str, Any]:
    """Summarise a CSV/XLSX sheet with counts and numeric aggregates."""
    path = _resolve_sheet_path(str(args.get("path", "")), must_exist=True)
    sheet_name = str(args.get("sheet_name") or "")
    group_by = str(args.get("group_by") or "")
    value_col = str(args.get("value_column") or "")

    if path.suffix.lower() == ".csv":
        grid, used = _csv_read(path, 5000, 50)
    else:
        grid, used = _xlsx_read(path, sheet_name, 5000, 50)

    if not grid:
        return {"result": "The sheet is empty."}
    headers = [str(h) if h is not None else f"col{i}" for i, h in enumerate(grid[0])]
    data = grid[1:]
    numeric: Dict[str, List[float]] = {}
    for row in data:
        for i, cell in enumerate(row):
            if i >= len(headers):
                break
            try:
                v = float(cell)
            except (TypeError, ValueError):
                continue
            numeric.setdefault(headers[i], []).append(v)

    lines = [
        f"Sheet '{used}' in {path.name}: {len(data)} data rows, {len(headers)} columns.",
        f"Columns: {', '.join(headers)}",
    ]
    for col, vals in numeric.items():
        if not vals:
            continue
        lines.append(
            f"- {col}: sum={sum(vals):.2f}, avg={sum(vals)/len(vals):.2f}, "
            f"min={min(vals):.2f}, max={max(vals):.2f}, count={len(vals)}"
        )
    if group_by and value_col and group_by in headers and value_col in headers:
        gi = headers.index(group_by)
        vi = headers.index(value_col)
        groups: Dict[str, float] = {}
        for row in data:
            try:
                groups[str(row[gi])] = groups.get(str(row[gi]), 0.0) + float(row[vi])
            except (TypeError, ValueError, IndexError):
                continue
        if groups:
            lines.append(f"Grouped by {group_by} (sum of {value_col}):")
            for k, v in sorted(groups.items(), key=lambda kv: -kv[1])[:20]:
                lines.append(f"  - {k}: {v:.2f}")
    return {"result": "\n".join(lines), "row_count": len(data), "columns": headers}


@register("logInventoryEntry")
def log_inventory_entry(args: Dict[str, Any]) -> Dict[str, Any]:
    """Log one inventory entry: append to inventory sheet + save a record."""
    item = args.get("item")
    quantity = args.get("quantity")
    if not item or quantity is None:
        raise ToolError("'item' and 'quantity' are required.")
    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        raise ToolError("'quantity' must be a number.")

    unit_price = args.get("unit_price")
    try:
        unit_price = float(unit_price) if unit_price is not None else None
    except (TypeError, ValueError):
        unit_price = None
    direction = str(args.get("direction") or "in").lower()
    if direction not in ("in", "out"):
        direction = "in"
    supplier = str(args.get("supplier") or "")
    notes = str(args.get("notes") or "")
    date = str(args.get("date") or datetime.now().strftime("%Y-%m-%d"))
    total = round(quantity * unit_price, 2) if unit_price is not None else None

    # 1) Append to the inventory sheet (default location under Documents).
    inv_dir = Path.home() / "Documents" / "YantriBusiness"
    inv_path = inv_dir / "inventory.xlsx"
    headers = ["Date", "Direction", "Item", "Quantity", "Unit Price", "Total", "Supplier", "Notes"]
    row: List[Any] = [
        date, direction, str(item), quantity,
        unit_price if unit_price is not None else "",
        total if total is not None else "",
        supplier, notes,
    ]
    try:
        if inv_path.suffix == ".xlsx":
            _xlsx_append(inv_path, "Inventory", headers, [row])
        else:
            _csv_append(inv_path, headers, [row])
        sheet_msg = f"appended to {inv_path}"
    except ToolError as e:
        # openpyxl missing — fall back to CSV so the data is never lost
        inv_path = inv_dir / "inventory.csv"
        _csv_append(inv_path, headers, [row])
        sheet_msg = f"appended to {inv_path} (xlsx unavailable: {e})"

    # 2) Save a searchable user record via the Node bridge is done server-side;
    # here we only return the structured entry.
    return {
        "result": (
            f"Inventory logged: {quantity:g} x {item} ({direction})"
            + (f" @ {unit_price:g}" if unit_price is not None else "")
            + (f" = {total:g}" if total is not None else "")
            + (f" from {supplier}" if supplier else "")
            + f" — {sheet_msg}."
        ),
        "entry": {
            "date": date, "direction": direction, "item": str(item),
            "quantity": quantity, "unit_price": unit_price, "total": total,
            "supplier": supplier, "notes": notes,
        },
        "sheet": str(inv_path),
    }


__all__ = [
    "write_spreadsheet", "append_spreadsheet_rows", "read_spreadsheet",
    "summarize_spreadsheet", "log_inventory_entry",
]
