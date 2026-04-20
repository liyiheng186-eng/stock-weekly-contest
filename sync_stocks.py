import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from datetime import timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data.js"


def load_data():
    text = DATA_FILE.read_text(encoding="utf-8")
    match = re.search(r"window\.STOCK_CONTEST_DATA\s*=\s*(\{.*\});\s*$", text, re.S)
    if not match:
        raise ValueError("data.js 格式不正确，未找到 window.STOCK_CONTEST_DATA")
    raw = match.group(1)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        normalized = re.sub(r"(?m)^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', raw)
        normalized = re.sub(r",(\s*[}\]])", r"\1", normalized)
        return json.loads(normalized)


def write_data(data):
    content = "window.STOCK_CONTEST_DATA = "
    content += json.dumps(data, ensure_ascii=False, indent=2)
    content += ";\n"
    DATA_FILE.write_text(content, encoding="utf-8")


def ymd(value):
    return value.strftime("%Y%m%d")


def to_float(value):
    if value is None:
        return ""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return ""
    if math.isnan(parsed) or parsed <= 0:
        return ""
    return round(parsed, 3)


def normalize_columns(df):
    return {str(column).strip(): column for column in df.columns}


def fetch_history(ak, code, start_date, end_date, target_start=None):
    target_start = target_start or start_date
    errors = []
    for source_name, fetcher in (
        ("东方财富日线", lambda: ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start_date, end_date=end_date, adjust="")),
        ("腾讯日线", lambda: ak.stock_zh_a_hist_tx(symbol=market_symbol(code), start_date=start_date, end_date=end_date, adjust="")),
        ("新浪日线", lambda: ak.stock_zh_a_daily(symbol=market_symbol(code), start_date=start_date, end_date=end_date, adjust="")),
        ("新浪分钟线", lambda: ak.stock_zh_a_minute(symbol=market_symbol(code), period="1", adjust="")),
    ):
        try:
            df = fetcher()
            rows = minute_dataframe_to_rows(df, start_date, end_date) if source_name == "新浪分钟线" else dataframe_to_rows(df)
            rows = [row for row in rows if row["date"].replace("-", "") <= end_date]
            has_target_window = any(row["date"].replace("-", "") >= target_start for row in rows)
            if rows and has_target_window:
                return rows, source_name
            if rows:
                errors.append(f"{source_name}: 最近数据仅到 {rows[-1]['date']}")
        except Exception as exc:
            errors.append(f"{source_name}: {exc}")

    raise RuntimeError("；".join(errors) or "未取到行情")


def dataframe_to_rows(df):
    if df is None or df.empty:
        return []

    columns = normalize_columns(df)
    date_col = columns.get("日期") or columns.get("date")
    open_col = columns.get("开盘") or columns.get("open")
    close_col = columns.get("收盘") or columns.get("close")
    high_col = columns.get("最高") or columns.get("high")
    low_col = columns.get("最低") or columns.get("low")

    if not date_col or not open_col or not close_col:
        raise KeyError("缺少日期/开盘/收盘列")

    rows = []
    for _, row in df.iterrows():
        rows.append(
            {
                "date": str(row[date_col]),
                "open": to_float(row[open_col]),
                "close": to_float(row[close_col]),
                "high": to_float(row[high_col]) if high_col else "",
                "low": to_float(row[low_col]) if low_col else "",
            }
        )
    return rows


def minute_dataframe_to_rows(df, start_date, end_date):
    if df is None or df.empty:
        return []

    columns = normalize_columns(df)
    day_col = columns.get("day") or columns.get("时间")
    open_col = columns.get("open") or columns.get("开盘")
    close_col = columns.get("close") or columns.get("收盘")
    high_col = columns.get("high") or columns.get("最高")
    low_col = columns.get("low") or columns.get("最低")

    if not day_col or not open_col or not close_col:
        raise KeyError("缺少分钟线时间/开盘/收盘列")

    grouped = {}
    for _, row in df.iterrows():
        date_text = str(row[day_col])[:10]
        date_key = date_text.replace("-", "")
        if date_key < start_date or date_key > end_date:
            continue
        grouped.setdefault(date_text, []).append(row)

    rows = []
    for date_text in sorted(grouped):
        minute_rows = grouped[date_text]
        first = minute_rows[0]
        last = minute_rows[-1]
        highs = [to_float(row[high_col]) for row in minute_rows] if high_col else []
        lows = [to_float(row[low_col]) for row in minute_rows] if low_col else []
        rows.append(
            {
                "date": date_text,
                "open": to_float(first[open_col]),
                "close": to_float(last[close_col]),
                "high": max([value for value in highs if value != ""], default=""),
                "low": min([value for value in lows if value != ""], default=""),
            }
        )
    return rows


def market_symbol(code):
    code = str(code).zfill(6)
    if code.startswith(("920", "8", "4")):
        return f"bj{code}"
    if code.startswith("6"):
        return f"sh{code}"
    return f"sz{code}"


def limit_ratio(code, name):
    code = str(code)
    if is_st_name(name):
        return 0.05
    if code.startswith(("300", "301", "688")):
        return 0.20
    if code.startswith(("8", "4", "920")):
        return 0.30
    return 0.10


def is_open_limit_up(first_day, previous_day, code, name):
    if not previous_day or not previous_day.get("close") or not first_day.get("open"):
        return False
    expected = round(float(previous_day["close"]) * (1 + limit_ratio(code, name)), 2)
    return float(first_day["open"]) >= expected - 0.01


def fetch_spot_map(ak):
    try:
        df = ak.stock_zh_a_spot_em()
    except Exception:
        return {}
    if df is None or df.empty:
        return {}

    columns = normalize_columns(df)
    code_col = columns.get("代码")
    name_col = columns.get("名称")
    latest_col = columns.get("最新价")
    open_col = columns.get("今开")

    result = {}
    for _, row in df.iterrows():
        code = str(row[code_col]).zfill(6)
        result[code] = {
          "name": str(row[name_col]) if name_col else "",
          "latest": to_float(row[latest_col]) if latest_col else "",
          "todayOpen": to_float(row[open_col]) if open_col else "",
        }
    return result


def is_st_name(name):
    normalized = str(name).upper().replace(" ", "")
    return normalized.startswith("ST") or normalized.startswith("*ST") or "ST" in normalized[:4]


def sync(data, start_date, end_date, use_realtime):
    try:
        import akshare as ak
    except ImportError as exc:
        raise RuntimeError("缺少 akshare，请先运行：python -m pip install akshare pandas") from exc

    spot_map = fetch_spot_map(ak) if use_realtime else {}
    synced = 0
    failed = []

    lookback_start = ymd(datetime.strptime(start_date, "%Y%m%d") - timedelta(days=14))

    for entry in data.get("entries", []):
        code = str(entry.get("stockCode", "")).zfill(6)
        if not code:
            continue

        try:
            rows, source_name = fetch_history(ak, code, lookback_start, end_date, target_start=start_date)
        except Exception as exc:
            failed.append(f"{code} {entry.get('stockName', '')}: {exc}")
            continue

        week_rows = [row for row in rows if row["date"].replace("-", "") >= start_date]
        if not week_rows:
            entry["note"] = append_note(entry.get("note", ""), "未取到本周行情，请手动核对")
            continue

        first_day = week_rows[0]
        last_day = week_rows[-1]
        first_index = next((index for index, row in enumerate(rows) if row is first_day), 0)
        previous_day = rows[first_index - 1] if first_index > 0 else None
        spot = spot_map.get(code, {})
        latest = spot.get("latest") if use_realtime else ""
        settlement = latest or last_day["close"]
        spot_name = spot.get("name", "")
        display_name = spot_name or entry.get("stockName", "")

        entry["mondayOpen"] = first_day["open"]
        entry["fridayClose"] = settlement
        entry["stockName"] = display_name
        entry["mondayLimitUp"] = is_open_limit_up(first_day, previous_day, code, display_name)
        entry["invalid"] = bool(entry.get("invalid", False))
        entry["syncedAt"] = datetime.now(timezone.utc).isoformat()
        entry["quoteDate"] = last_day["date"]

        notes = []
        if len(week_rows) < 5:
            notes.append(f"本周已取到 {len(week_rows)} 个交易日")
        if display_name and is_st_name(display_name):
            entry["invalid"] = True
            notes.append("名称含 ST，已标记无效")
        if entry["mondayLimitUp"]:
            notes.append("周一开盘涨停，按 0% 计算")
        if latest:
            notes.append("已用实时最新价作临时结算价")
        else:
            notes.append(f"已用 {source_name} {last_day['date']} 收盘价")

        existing_note = clean_stale_note(entry.get("note", ""))
        entry["note"] = merge_notes(existing_note, notes)
        synced += 1

    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    data["version"] = f"sync-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    data.setdefault("history", [])
    return synced, failed


def append_note(existing, note):
    existing = str(existing or "").strip()
    if not existing:
        return note
    if note in existing:
        return existing
    return f"{existing}；{note}"


def merge_notes(existing, notes):
    cleaned = str(existing or "").strip()
    for note in notes:
        cleaned = append_note(cleaned, note)
    return cleaned


def clean_stale_note(note):
    note = str(note or "")
    stale_parts = {"未取到本周行情，请手动核对"}
    parts = [part.strip() for part in note.split("；") if part.strip()]
    return "；".join(part for part in parts if part not in stale_parts)


def main():
    parser = argparse.ArgumentParser(description="同步 A 股周赛行情到 data.js")
    parser.add_argument("--start", required=True, help="本周起始交易日，格式 YYYYMMDD，例如 20260420")
    parser.add_argument("--end", required=True, help="本周结束/当前日期，格式 YYYYMMDD，例如 20260424")
    parser.add_argument("--no-realtime", action="store_true", help="不用实时最新价，只用历史日线最后一个收盘价")
    args = parser.parse_args()

    data = load_data()
    synced, failed = sync(data, args.start, args.end, use_realtime=not args.no_realtime)
    write_data(data)

    print(f"同步完成：{synced} 只股票已更新到 {DATA_FILE.name}")
    if failed:
        print("以下股票同步失败，请手动核对：")
        for item in failed:
            print(f"- {item}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"同步失败：{exc}", file=sys.stderr)
        sys.exit(1)
