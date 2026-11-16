"""
Forgera AI Agent — FastAPI Server

Endpoints:
  POST /api/agent/generate-alerts
  GET  /api/purchase-orders/pending-approval
"""

import os
from dotenv import load_dotenv

load_dotenv()
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


from agents.alert_engine import generate_alerts
from supabase_client import supabase


app = FastAPI(title="Forgera AI Agent API", version="1.0.0")

# ── CORS — allow the Vite frontend to call the API ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "https://forgera.vercel.app",
        "https://os.forgera.app",
        "https://forgera-rho.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response schemas ───────────────────────────────────────────────
class AgentRequest(BaseModel):
    message: str
    history: List[Dict[str, Any]] = []
    mode: str = "assistant"


class AgentResponse(BaseModel):
    response: str
    history: List[Dict[str, Any]]


class HealthResponse(BaseModel):
    status: str
    version: str


class GenerateAlertsResponse(BaseModel):
    success: bool
    created: int
    updated: int
    resolved: int
    current_open_alerts: int


@app.post("/api/agent/generate-alerts", response_model=GenerateAlertsResponse)
async def generate_alerts_endpoint(authorization: Optional[str] = Header(default=None)):
    """Trigger the unified alert engine on demand.

    Cron infrastructure is not yet wired here, so this is safe to call from a
    button/action until scheduled execution is available.
    """
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip() or None

    try:
        result = generate_alerts(auth_token=token)
        return GenerateAlertsResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate alerts: {e}")


# ── Endpoints ────────────────────────────────────────────────────────────────


@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok", version="2.0.0")

@app.get("/api/purchase-orders/pending-approval")
async def get_pending_approval_purchase_orders():
    """
    Retrieves a list of purchase orders that are currently in 'pending_approval' status,
    ordered by creation date (oldest first) to prioritize review.
    """
    try:
        result = supabase.table("purchases").select(
            """
            *,
            users!sold_by(full_name),
            suppliers(supplier_name),
            locations(name)
            """
        ).eq("status", "pending_approval").order("created_at", desc=False).execute()
        
        return result.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))