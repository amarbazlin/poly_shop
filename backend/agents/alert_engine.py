"""Unified alert generation for inventory and purchasing signals.

The engine is intentionally idempotent. Each run recomputes the desired
open alert set, inserts missing alerts, updates changed alerts, and marks
stale alerts resolved when the underlying condition clears.
"""

from __future__ import annotations

import math
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://mosucapcjbbcgndciurt.supabase.co")
SUPABASE_KEY = os.getenv(
    "SUPABASE_SERVICE_KEY",
    os.getenv(
        "SUPABASE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vc3VjYXBjamJiY2duZGNpdXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ2MzksImV4cCI6MjA5NDA4MDYzOX0.K3cm12jOCTHRsPZDziPDXt3EsWTQAl-BpGKc2i1_CCk",
    ),
)

MANAGED_ALERT_TYPES = {
    "low_stock",
    "out_of_stock",
    "dead_stock",
    "late_delivery",
    "supplier_credit_due",
}

SEVERITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1}
DEAD_STOCK_LOOKBACK_DAYS = 90


def _create_client(auth_token: Optional[str] = None):
    headers = {}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    options = SyncClientOptions(headers=headers, auto_refresh_token=False, persist_session=False)
    return create_client(SUPABASE_URL, SUPABASE_KEY, options=options)


def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


def _to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return fallback


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _alert_key(alert: dict[str, Any]) -> tuple[str, Optional[int], Optional[int]]:
    return (
        alert["alert_type"],
        alert.get("product_id"),
        alert.get("related_purchase_order_id"),
    )


def _build_alert(
    alert_type: str,
    message: str,
    severity: str,
    *,
    product_id: Optional[int] = None,
    related_purchase_order_id: Optional[int] = None,
    business_id: Optional[int] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "alert_type": alert_type,
        "message": message,
        "severity": severity,
        "business_id": business_id,
    }
    if product_id is not None:
        payload["product_id"] = product_id
    if related_purchase_order_id is not None:
        payload["related_purchase_order_id"] = related_purchase_order_id
    return payload


def _fetch_active_products(client) -> list[dict[str, Any]]:
    result = (
        client.table("products")
        .select(
            "id, product_name, product_code, quantity, reorder_level, cost_price, status, suppliers ( supplier_name, average_delivery_days )"
        )
        .eq("status", "active")
        .execute()
    )
    return result.data or []


def _fetch_existing_alerts(client) -> list[dict[str, Any]]:
    result = (
        client.table("alerts")
        .select("id, alert_type, message, severity, product_id, related_purchase_order_id, resolved")
        .eq("resolved", False)
        .in_("alert_type", sorted(MANAGED_ALERT_TYPES))
        .execute()
    )
    return result.data or []


def _fetch_dead_stock_product_ids(client) -> set[int]:
    from_date = (datetime.now(timezone.utc) - timedelta(days=DEAD_STOCK_LOOKBACK_DAYS)).isoformat()
    result = (
        client.table("sales_items")
        .select("product_id, sale:sale_id!inner(created_at)")
        .gte("sale.created_at", from_date)
        .execute()
    )
    sold_ids: set[int] = set()
    for row in result.data or []:
        product_id = row.get("product_id")
        if product_id is not None:
            sold_ids.add(int(product_id))
    return sold_ids


def _fetch_overdue_purchase_orders(client) -> list[dict[str, Any]]:
    result = (
        client.table("purchases")
        .select("id, status, expected_delivery_date, suppliers ( supplier_name )")
        .execute()
    )
    return [row for row in (result.data or []) if row.get("expected_delivery_date")]


SUPPLIER_CREDIT_WARNING_DAYS = (7, 3, 1)


def _fetch_unpaid_credit_purchases(client) -> list[dict[str, Any]]:
    """Unpaid/partially-paid credit purchases with paid sums from purchase_payments."""
    result = (
        client.table("purchases")
        .select(
            "id, invoice_number, total_amount, payment_type, due_date, created_at, "
            "suppliers ( supplier_name )"
        )
        .eq("payment_type", "credit")
        .execute()
    )
    purchases = [p for p in (result.data or []) if p.get("payment_type") == "credit"]
    if not purchases:
        return []

    paid_by_purchase: dict[int, float] = defaultdict(float)
    pp = client.table("purchase_payments").select("purchase_id, amount").execute()
    for row in pp.data or []:
        try:
            paid_by_purchase[int(row["purchase_id"])] += _to_float(row.get("amount"))
        except (TypeError, ValueError):
            continue

    unpaid = []
    for p in purchases:
        total = _to_float(p.get("total_amount"))
        balance = total - paid_by_purchase.get(_to_int(p.get("id")), 0.0)
        if balance <= 0.005:
            continue
        unpaid.append({**p, "balance": balance})
    return unpaid


def _supplier_credit_severity(days_remaining: Optional[int]) -> str:
    if days_remaining is None:
        return "low"
    if days_remaining < 0:
        return "critical"
    if days_remaining <= 1:
        return "high"
    if days_remaining <= 3:
        return "medium"
    return "low"


def _stockout_severity(quantity: float) -> str:
    if quantity <= 0:
        return "critical"
    if quantity <= 1:
        return "high"
    return "medium"


def _low_stock_severity(quantity: float, reorder_level: float) -> str:
    if reorder_level <= 0:
        return "medium"
    ratio = quantity / reorder_level
    if ratio <= 0.25:
        return "high"
    if ratio <= 0.5:
        return "high"
    return "medium"


def _dead_stock_severity(inventory_value: float) -> str:
    if inventory_value >= 250_000:
        return "critical"
    if inventory_value >= 50_000:
        return "high"
    return "medium"


def _late_delivery_severity(days_overdue: int) -> str:
    if days_overdue >= 8:
        return "critical"
    if days_overdue >= 4:
        return "high"
    return "medium"


def generate_alerts(auth_token: Optional[str] = None) -> dict[str, Any]:
    client = _create_client(auth_token)
    products = _fetch_active_products(client)
    existing_alerts = _fetch_existing_alerts(client)
    existing_by_key = {_alert_key(alert): alert for alert in existing_alerts}

    desired_alerts: list[dict[str, Any]] = []
    desired_keys: set[tuple[str, Optional[int], Optional[int]]] = set()

    dead_stock_ids = _fetch_dead_stock_product_ids(client)

    for product in products:
        product_id = _to_int(product.get("id"))
        if not product_id:
            continue

        quantity = _to_float(product.get("quantity"))
        reorder_level = _to_float(product.get("reorder_level"))
        cost_price = _to_float(product.get("cost_price"))
        product_name = product.get("product_name") or f"Product #{product_id}"
        product_code = product.get("product_code")
        display_name = f"{product_name} ({product_code})" if product_code else product_name

        if quantity <= 0:
            alert = _build_alert(
                "out_of_stock",
                f"{display_name} is out of stock. Reorder immediately.",
                _stockout_severity(quantity),
                product_id=product_id,
            )
            desired_alerts.append(alert)
            desired_keys.add(_alert_key(alert))
            continue

        if reorder_level > 0 and quantity <= reorder_level:
            alert = _build_alert(
                "low_stock",
                f"{display_name} is at {quantity:g} units, at or below reorder level {reorder_level:g}.",
                _low_stock_severity(quantity, reorder_level),
                product_id=product_id,
            )
            desired_alerts.append(alert)
            desired_keys.add(_alert_key(alert))
            continue

        if product_id in dead_stock_ids and quantity > 0:
            inventory_value = quantity * cost_price
            alert = _build_alert(
                "dead_stock",
                f"{display_name} has had no sales in the last {DEAD_STOCK_LOOKBACK_DAYS} days. {quantity:g} units remain tied up (about LKR {inventory_value:,.2f}).",
                _dead_stock_severity(inventory_value),
                product_id=product_id,
            )
            desired_alerts.append(alert)
            desired_keys.add(_alert_key(alert))

    today = datetime.now(timezone.utc).date()
    for po in _fetch_overdue_purchase_orders(client):
        po_id = _to_int(po.get("id"))
        if not po_id:
            continue

        expected_delivery_date = _parse_date(po.get("expected_delivery_date"))
        if not expected_delivery_date:
            continue

        days_overdue = (today - expected_delivery_date).days
        if days_overdue <= 0:
            continue

        supplier_name = (po.get("suppliers") or {}).get("supplier_name") or "Unknown supplier"
        alert = _build_alert(
            "late_delivery",
            f"PO #{po_id} for {supplier_name} is {days_overdue} days overdue (expected {expected_delivery_date.isoformat()}).",
            _late_delivery_severity(days_overdue),
            related_purchase_order_id=po_id,
        )
        desired_alerts.append(alert)
        desired_keys.add(_alert_key(alert))

    today = datetime.now(timezone.utc).date()
    for credit in _fetch_unpaid_credit_purchases(client):
        purchase_id = _to_int(credit.get("id"))
        if not purchase_id:
            continue

        due_date = _parse_date(credit.get("due_date")) or _parse_date(credit.get("created_at"))
        if not due_date:
            continue

        days_remaining = (due_date - today).days
        # Raise from 7 days out and keep the alert alive until paid, with the
        # message/severity escalating at 3 days, 1 day and when overdue.
        if days_remaining > max(SUPPLIER_CREDIT_WARNING_DAYS):
            continue

        supplier_name = (credit.get("suppliers") or {}).get("supplier_name") or "Unknown supplier"
        bill_no = credit.get("invoice_number") or f"BILL-{purchase_id:06d}"
        if days_remaining < 0:
            message = (
                f"Supplier credit OVERDUE: {supplier_name} bill {bill_no} "
                f"(LKR {credit['balance']:,.2f}) was due {due_date.isoformat()} "
                f"({-days_remaining} days ago)."
            )
        else:
            message = (
                f"Supplier credit due in {days_remaining} day(s): {supplier_name} bill "
                f"{bill_no} for LKR {credit['balance']:,.2f} due {due_date.isoformat()}."
            )
        alert = _build_alert(
            "supplier_credit_due",
            message,
            _supplier_credit_severity(days_remaining),
            related_purchase_order_id=purchase_id,
        )
        desired_alerts.append(alert)
        desired_keys.add(_alert_key(alert))

    created = 0
    updated = 0
    resolved = 0

    for alert in desired_alerts:
        key = _alert_key(alert)
        existing = existing_by_key.get(key)
        if existing:
            updates: dict[str, Any] = {}
            if existing.get("message") != alert["message"]:
                updates["message"] = alert["message"]
            if existing.get("severity") != alert["severity"]:
                updates["severity"] = alert["severity"]
            if updates:
                client.table("alerts").update(updates).eq("id", existing["id"]).execute()
                updated += 1
        else:
            client.table("alerts").insert(alert).execute()
            created += 1

    for existing in existing_alerts:
        if _alert_key(existing) in desired_keys:
            continue
        client.table("alerts").update({"resolved": True}).eq("id", existing["id"]).execute()
        resolved += 1

    return {
        "success": True,
        "created": created,
        "updated": updated,
        "resolved": resolved,
        "current_open_alerts": len(desired_alerts),
    }
