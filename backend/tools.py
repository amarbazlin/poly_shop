"""
Forgera Business Intelligence Tools
Anthropic-compatible tool schemas + Supabase query execution functions.

Each tool is self-contained — queries only what's needed, when it's needed.
"""

import os
from typing import Optional

from datetime import datetime, timedelta
from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://mosucapcjbbcgndciurt.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vc3VjYXBjamJiY2duZGNpdXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDQ2MzksImV4cCI6MjA5NDA4MDYzOX0.K3cm12jOCTHRsPZDziPDXt3EsWTQAl-BpGKc2i1_CCk")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def set_auth_token(auth_token: Optional[str] = None) -> None:
    """
    Rebind the module-level Supabase client to the user's JWT so RLS policies
    apply with the caller's identity (same pattern as agents/alert_engine.py).

    Called at the start of each agent request. If no token is given, falls
    back to the default anon-key client.
    """
    global supabase
    if not auth_token:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        return
    options = SyncClientOptions(headers={"Authorization": f"Bearer {auth_token}"})
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY, options=options)


# ── Helper ──────────────────────────────────────────────────────────────────────
def _date_range(days: int) -> tuple:
    """Return (from_iso, to_iso) for the last N days."""
    now = datetime.utcnow()
    from_dt = now - timedelta(days=days)
    return from_dt.isoformat(), now.isoformat()


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL SCHEMAS — Anthropic-compatible (for Claude Tool Use)
# ═══════════════════════════════════════════════════════════════════════════════

ASSISTANT_TOOLS = [
    {
        "name": "get_inventory_summary",
        "description": "Get a summary of current inventory including total products, total stock value at cost, and item count by category",
        "input_schema": {
            "type": "object",
            "properties": {
                "business_id": {
                    "type": "integer",
                    "description": "Business ID for multi-tenant data isolation"
                }
            },
            "required": []
        }
    },
    {
        "name": "get_sales_summary",
        "description": "Get total sales revenue, order count, and average order value for a given period",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Number of days to look back, e.g. 7, 30, 90"
                },
                "business_id": {
                    "type": "integer",
                    "description": "Business ID for multi-tenant data isolation"
                }
            },
            "required": ["days"]
        }
    },
    {
        "name": "get_low_stock_items",
        "description": "Get list of products that are at or below their reorder level (low stock)",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max number of items to return (default 20)"
                },
                "business_id": {
                    "type": "integer",
                    "description": "Business ID for multi-tenant data isolation"
                }
            },
            "required": []
        }
    },
    {
        "name": "get_top_selling_products",
        "description": "Get best-selling products by quantity sold or revenue generated for a period",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Number of days to look back"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of products to return (default 10)"
                },
                "by": {
                    "type": "string",
                    "enum": ["quantity", "revenue"],
                    "description": "Sort by 'quantity' sold or 'revenue' generated (default: quantity)"
                },
                "business_id": {
                    "type": "integer",
                    "description": "Business ID for multi-tenant data isolation"
                }
            },
            "required": ["days"]
        }
    },
    {
        "name": "get_alerts",
        "description": "Get unresolved business alerts sorted by severity",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max number of alerts to return (default 20)"
                },
                "business_id": {
                    "type": "integer",
                    "description": "Business ID for multi-tenant data isolation"
                }
            },
            "required": []
        }
    },
    {
        "name": "get_customer_summary",
        "description": "Get customer count and credit risk info — total customers and those with outstanding balances",
        "input_schema": {
            "type": "object",
            "properties": {
                "business_id": {
                    "type": "integer",
                    "description": "Business ID for multi-tenant data isolation"
                }
            },
            "required": []
        }
    },
]


# ═══════════════════════════════════════════════════════════════════════════════
# EXECUTE FUNCTIONS — each queries Supabase directly, returns dict/list
# ═══════════════════════════════════════════════════════════════════════════════

def execute_tool(tool_name: str, tool_input: dict):
    """
    Route a tool name + args to the correct database query.
    Returns a JSON-serializable result (dict or list).
    """
    handler = _TOOL_HANDLERS.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}"}
    return handler(tool_input)


# ── Handler implementations ─────────────────────────────────────────────────────

def _get_sales_summary(args: dict) -> dict:
    days = args["days"]
    business_id = args.get("business_id")
    from_dt, to_dt = _date_range(days)

    query = supabase.table("sales").select("id, total_amount, created_at")\
        .gte("created_at", from_dt)\
        .lte("created_at", to_dt)

    if business_id:
        query = query.eq("business_id", business_id)

    result = query.execute()

    sales = result.data or []
    total_revenue = sum(float(s.get("total_amount", 0)) for s in sales)
    transaction_count = len(sales)
    avg_order_value = round(total_revenue / transaction_count, 2) if transaction_count > 0 else 0

    return {
        "period_days": days,
        "total_revenue_lkr": round(total_revenue, 2),
        "transaction_count": transaction_count,
        "average_order_value_lkr": avg_order_value,
        "from": from_dt,
        "to": to_dt,
    }


def _get_low_stock_items(args: dict) -> list:
    limit = args.get("limit", 20)
    business_id = args.get("business_id")

    query = supabase.table("products").select("""
        id, product_name, product_code, quantity, reorder_level,
        cost_price, selling_price, unit,
        supplier:supplier_id(supplier_name, average_delivery_days)
    """)\
        .eq("status", "active")

    if business_id:
        query = query.eq("business_id", business_id)

    result = query.execute()

    products = result.data or []
    low_stock = []
    for p in products:
        qty = float(p.get("quantity", 0))
        reorder = float(p.get("reorder_level", 0))
        if qty <= reorder:
            margin_pct = 0
            bp = float(p.get("cost_price", 0))
            sp = float(p.get("selling_price", 0))
            if bp > 0:
                margin_pct = round(((sp - bp) / bp) * 100, 1)

            low_stock.append({
                "id": p["id"],
                "name": p["product_name"],
                "code": p.get("product_code", ""),
                "current_stock": qty,
                "reorder_level": reorder,
                "shortage": reorder - qty,
                "cost_price_lkr": bp,
                "selling_price_lkr": sp,
                "margin_pct": margin_pct,
                "unit": p.get("unit", "pcs"),
                "supplier": p.get("supplier", {}).get("supplier_name", "Unknown") if p.get("supplier") else "Unknown",
                "lead_time_days": p.get("supplier", {}).get("average_delivery_days") if p.get("supplier") else None,
            })

    # Sort by most urgent (lowest stock first)
    low_stock.sort(key=lambda x: x["shortage"], reverse=True)
    return low_stock[:limit]


def _get_top_selling_products(args: dict) -> list:
    days = args["days"]
    limit = args.get("limit", 10)
    sort_by = args.get("by", "quantity")
    business_id = args.get("business_id")
    from_dt, to_dt = _date_range(days)

    # Fetch sale items with product info
    query = supabase.table("sales_items").select("""
        product_id,
        quantity,
        subtotal,
        products(id, product_name, product_code, quantity, selling_price),
        sale:sale_id!inner(created_at, business_id)
    """)\
        .gte("sale.created_at", from_dt)\
        .lte("sale.created_at", to_dt)\
        .limit(500)

    if business_id:
        query = query.eq("sale.business_id", business_id)

    result = query.execute()

    # Aggregate by product
    agg = {}
    for item in result.data or []:
        pid = item.get("product_id")
        if not pid:
            continue
        if pid not in agg:
            agg[pid] = {
                "product_id": pid,
                "name": item.get("products", {}).get("product_name", f"Product #{pid}"),
                "code": item.get("products", {}).get("product_code", ""),
                "current_stock": float(item.get("products", {}).get("quantity", 0)),
                "selling_price_lkr": float(item.get("products", {}).get("selling_price", 0)),
                "qty_sold": 0,
                "revenue_lkr": 0,
            }
        agg[pid]["qty_sold"] += int(item.get("quantity", 0))
        agg[pid]["revenue_lkr"] += float(item.get("subtotal", 0))

    # Sort
    sorted_products = sorted(agg.values(), key=lambda x: x["qty_sold" if sort_by == "quantity" else "revenue_lkr"], reverse=True)
    return sorted_products[:limit]


def _get_inventory_summary(args: dict) -> dict:
    business_id = args.get("business_id")

    query = supabase.table("products").select("""
        id, product_name, quantity, cost_price, selling_price, status,
        category:category_id(name)
    """)\
        .eq("status", "active")

    if business_id:
        query = query.eq("business_id", business_id)

    result = query.execute()

    products = result.data or []
    total_value = sum(float(p.get("quantity", 0)) * float(p.get("cost_price", 0)) for p in products)
    total_selling_value = sum(float(p.get("quantity", 0)) * float(p.get("selling_price", 0)) for p in products)
    item_count = len(products)

    by_category = {}
    for p in products:
        cat = p.get("category", {}).get("name", "Uncategorized") if p.get("category") else "Uncategorized"
        qty = float(p.get("quantity", 0))
        val = qty * float(p.get("cost_price", 0))
        if cat not in by_category:
            by_category[cat] = {"product_count": 0, "total_stock": 0, "value_lkr": 0}
        by_category[cat]["product_count"] += 1
        by_category[cat]["total_stock"] += qty
        by_category[cat]["value_lkr"] += val

    return {
        "total_products": item_count,
        "total_stock_units": sum(float(p.get("quantity", 0)) for p in products),
        "total_stock_value_at_cost_lkr": round(total_value, 2),
        "total_stock_value_at_retail_lkr": round(total_selling_value, 2),
        "categories": [
            {"name": cat, **data}
            for cat, data in sorted(by_category.items(), key=lambda x: x[1]["value_lkr"], reverse=True)
        ],
    }


def _get_alerts(args: dict) -> list:
    limit = args.get("limit", 20)
    business_id = args.get("business_id")

    query = supabase.table("alerts").select("id, alert_type, message, severity, created_at")\
        .eq("resolved", False)\
        .order("created_at", desc=True)\
        .limit(limit)

    if business_id:
        query = query.eq("business_id", business_id)

    result = query.execute()
    return result.data or []


def _get_customer_summary(args: dict) -> dict:
    business_id = args.get("business_id")

    # Total customers
    count_query = supabase.table("customers").select("id", count="exact", head=True)
    if business_id:
        count_query = count_query.eq("business_id", business_id)
    count_result = count_query.execute()
    total = count_result.count or 0

    # Customers with credit balances
    credit_query = supabase.table("customers").select("id, name, current_balance, credit_limit")\
        .gt("current_balance", 0)\
        .order("current_balance", desc=True)\
        .limit(10)

    if business_id:
        credit_query = credit_query.eq("business_id", business_id)

    credit_result = credit_query.execute()

    credit_risk = []
    for c in credit_result.data or []:
        bal = float(c.get("current_balance", 0))
        limit = float(c.get("credit_limit", 0))
        credit_risk.append({
            "name": c["name"],
            "outstanding_balance_lkr": round(bal, 2),
            "credit_limit_lkr": limit,
            "utilization_pct": round((bal / limit) * 100, 1) if limit > 0 else None,
            "over_limit": bal > limit,
        })

    total_outstanding = sum(c["outstanding_balance_lkr"] for c in credit_risk)

    return {
        "total_customers": total,
        "customers_with_credit_balance": len(credit_risk),
        "total_outstanding_credit_lkr": round(total_outstanding, 2),
        "at_risk_customers": credit_risk,
    }


# ── Handler registry ────────────────────────────────────────────────────────────

_TOOL_HANDLERS = {
    "get_sales_summary": _get_sales_summary,
    "get_low_stock_items": _get_low_stock_items,
    "get_top_selling_products": _get_top_selling_products,
    "get_inventory_summary": _get_inventory_summary,
    "get_alerts": _get_alerts,
    "get_customer_summary": _get_customer_summary,
}

ALL_TOOLS = ASSISTANT_TOOLS