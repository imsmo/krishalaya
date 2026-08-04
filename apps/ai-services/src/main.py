# apps/ai-services/src/main.py · FastAPI app for the internal inference tier. Lifespan boots fail-closed config,
# the asyncpg pool, the model registry + inference logger, per-provider circuit breakers, and metrics onto
# app.state.app; mounts the four routers; exposes /healthz + /metrics. A request-id middleware tags every log.
# All four model endpoints are service-to-service authed (constant-time bearer) and advisory only (Law 11).
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from .common.config import load_settings
from .common.db import AsyncpgDb
from .common.http import AppState
from .common.inference_logger import InferenceLogger
from .common.model_registry import ModelRegistry
from .common.resilience import BreakerConfig, CircuitBreaker
from .common.telemetry import Metrics, get_logger
from .price_bands.router import router as price_bands_router
from .voice_extraction.router import router as voice_router
from .photo_grading.router import router as photo_router
from .fraud_signals.router import router as fraud_router
from .assistant.router import router as assistant_router
from .doc_extraction.router import router as doc_extraction_router

log = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = load_settings()                      # raises → process exits on misconfig (fail closed)
    db = AsyncpgDb(settings.inference_log_db_url)
    await db.connect()
    app.state.app = AppState(
        settings=settings,
        db=db,
        registry=ModelRegistry(db),
        logger=InferenceLogger(db),
        metrics=Metrics(),
        breakers={
            "llm": CircuitBreaker(BreakerConfig(failure_threshold=5, reset_ms=15000, half_open_max=2)),
            "stt": CircuitBreaker(BreakerConfig(failure_threshold=5, reset_ms=15000, half_open_max=2)),
        },
    )
    log.info("ai-services started", extra={"fields": {"env": settings.env, "llm": settings.llm_enabled}})
    try:
        yield
    finally:
        await db.close()


app = FastAPI(title="krishalaya ai-services", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
app.include_router(price_bands_router)
app.include_router(voice_router)
app.include_router(photo_router)
app.include_router(fraud_router)
app.include_router(assistant_router)
app.include_router(doc_extraction_router)


@app.middleware("http")
async def request_id_mw(request: Request, call_next):
    rid = request.headers.get("x-request-id", "no-req-id")
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    return response


@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/metrics")
async def metrics(request: Request) -> PlainTextResponse:
    state: AppState = request.app.state.app
    return PlainTextResponse(state.metrics.render())
