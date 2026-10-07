"""ark-api — A5 纵切片服务层（蓝图：领域单写者，diff 唯一计算与落库点）。

端点（对外只经 3721 /slice/* 代理暴露，本服务仅监听 127.0.0.1:3724）：
  GET  /slice/health      —— 存活 + DB ping
  GET  /slice/bootstrap   —— metrics + plan(含现算 diffOps) + lab，三态之「实时」源
  POST /slice/lab/results —— 简版手工录入（整份 doc upsert，服务端重算 status）
  POST /slice/plans/sign   —— 签发：difflib 逐字 diff → plans.signed + preference_pairs 落库
"""
import logging
from contextlib import asynccontextmanager
from datetime import date as date_cls
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from db import create_pool, get_counts
from diff_service import classify_pair, compute_diff_ops
from migrate import run_migrations

TENANT = 1
SLICE_PLAN_MEMBER_DEFAULT = "MB-2041"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await create_pool()
    applied = await run_migrations(app.state.pool)
    if applied:
        print(f"[ark-api] migrations applied: {applied}")
    yield
    await app.state.pool.close()


app = FastAPI(title="ark-api (A5 slice)", lifespan=lifespan)


def _err(status: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": code})


def _status(value: Any, rng: Any) -> str:
    """参考区间判定：value<lo→low、>hi→high、否则 in。[0,hi] 型天然只有 in/high。"""
    try:
        lo, hi = float(rng[0]), float(rng[1])
        v = float(value)
    except (TypeError, ValueError, IndexError):
        return "in"
    if v < lo:
        return "low"
    if v > hi:
        return "high"
    return "in"


def _recompute_lab_status(lab: dict) -> dict:
    """服务端权威重算 status（客户端传入的 status 不可信）。"""
    hero = dict(lab.get("hero") or {})
    if isinstance(hero.get("range"), list) and "value" in hero:
        hero["status"] = _status(hero["value"], hero["range"])
    items = []
    for item in lab.get("items") or []:
        item = dict(item)
        if isinstance(item.get("range"), list) and "value" in item:
            item["status"] = _status(item["value"], item["range"])
        items.append(item)
    lab["hero"] = hero
    lab["items"] = items
    return lab


def _plan_row_to_contract(row, diff_ops: dict, revision_types: list[str]) -> dict:
    signed_at = row["signed_at"]
    return {
        "id": row["id"],
        "memberId": row["member_id"],
        "title": row["title"],
        "status": row["status"],
        "model": row["model"],
        "tokens": row["tokens"],
        "cost": float(row["cost"]),
        "draft": row["draft"],
        "final": row["final"],
        "diffOps": diff_ops,
        "revisionTypes": revision_types,
        "signedAt": signed_at.isoformat(sep=" ", timespec="minutes") if signed_at else None,
    }


def _lab_row_to_contract(row) -> dict:
    report_date = row["report_date"]
    return {
        "panel": row["panel"],
        "date": report_date.isoformat() if report_date else None,
        "lab": row["lab_name"],
        "hero": row["hero"],
        "items": row["items"],
        "bioAge": float(row["bio_age"]) if row["bio_age"] is not None else None,
        "chronological": row["chronological"],
        "aiNote": row["ai_note"],
    }


# ---------------------------------------------------------------- 健康检查

@app.get("/slice/health")
async def health(request: Request) -> JSONResponse:
    try:
        async with request.app.state.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return JSONResponse({"ok": True, "service": "ark-api", "db": "up"})
    except Exception as exc:  # noqa: BLE001 — 健康检查要如实报错
        return JSONResponse(status_code=503, content={"ok": False, "db": "down", "error": str(exc)[:200]})


# ---------------------------------------------------------------- bootstrap

@app.get("/slice/bootstrap")
async def bootstrap(request: Request, memberId: str) -> JSONResponse:
    if not memberId:
        return _err(400, "memberId_required")
    pool = request.app.state.pool
    try:
        metrics = await get_counts(pool)
        async with request.app.state.pool.acquire() as conn:
            plan_row = await conn.fetchrow(
                """SELECT * FROM plans WHERE tenant_id=$1 AND member_id=$2
                   ORDER BY created_at DESC LIMIT 1""",
                TENANT, memberId)
            lab_row = await conn.fetchrow(
                """SELECT * FROM lab_results WHERE tenant_id=$1 AND member_id=$2
                   ORDER BY updated_at DESC LIMIT 1""",
                TENANT, memberId)
        plan = None
        if plan_row is not None:
            # diffOps 请求时现算不落库（落库只在 sign）；行级类型同源同步算
            diff_ops = compute_diff_ops(plan_row["draft"], plan_row["final"])
            _, revision_types = classify_pair(diff_ops)
            plan = _plan_row_to_contract(plan_row, diff_ops, revision_types)
        return JSONResponse({
            "ok": True,
            "meta": {"source": "postgres", "fetchedAt": _now_iso()},
            "metrics": metrics,
            "plan": plan,
            "lab": _lab_row_to_contract(lab_row) if lab_row is not None else None,
        })
    except Exception:  # noqa: BLE001
        logging.exception("bootstrap failed")  # 详情进日志，不进响应体（防 DSN/SQL 泄露）
        return _err(500, "bootstrap_failed")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- 检测录入

class LabEntry(BaseModel):
    memberId: str
    lab: dict


@app.post("/slice/lab/results")
async def save_lab(request: Request, entry: LabEntry) -> JSONResponse:
    lab = _recompute_lab_status(entry.lab)
    hero = lab.get("hero")
    if not isinstance(hero, dict) or "value" not in hero:
        return _err(400, "lab_hero_required")
    try:
        report_date = date_cls.fromisoformat(str(lab["date"])) if lab.get("date") else None
    except ValueError:
        report_date = None
    pool = request.app.state.pool
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO lab_results
                  (tenant_id, member_id, panel, lab_name, report_date,
                   hero, items, bio_age, chronological, ai_note, source, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual', now())
                ON CONFLICT (tenant_id, member_id) DO UPDATE SET
                  panel=EXCLUDED.panel, lab_name=EXCLUDED.lab_name,
                  report_date=EXCLUDED.report_date, hero=EXCLUDED.hero,
                  items=EXCLUDED.items, bio_age=EXCLUDED.bio_age,
                  chronological=EXCLUDED.chronological, ai_note=EXCLUDED.ai_note,
                  source='manual', updated_at=now()
                RETURNING *""",
                TENANT, entry.memberId,
                str(lab.get("panel") or ""), str(lab.get("lab") or ""),
                report_date, hero, lab.get("items") or [],
                lab.get("bioAge"), lab.get("chronological"),
                str(lab.get("aiNote") or ""))
        return JSONResponse({
            "ok": True,
            "lab": _lab_row_to_contract(row),
            "savedAt": row["updated_at"].isoformat(timespec="seconds"),
        })
    except Exception:  # noqa: BLE001
        logging.exception("lab save failed")
        return _err(500, "lab_save_failed")


# ---------------------------------------------------------------- 方案签发

class SignRequest(BaseModel):
    planId: str
    memberId: str | None = None
    draft: list[str] | None = None   # 仅一致性校验，AI 初稿以 DB 行为准
    final: list[str]
    model: str | None = None
    tokens: int | None = None
    cost: float | None = None
    signedBy: str | None = None


@app.post("/slice/plans/sign")
async def sign_plan(request: Request, body: SignRequest) -> JSONResponse:
    pool = request.app.state.pool
    try:
        # 事务内只做读写与判定；响应构造与 counts 聚合一律在事务提交、
        # 连接归还池之后 —— 否则占用中的连接去开第二连接（池压力），
        # 且计数可能读到未提交前的旧值。
        already = False
        plan_row = None
        signed_row = None
        pair_row = None
        diff_ops = None
        revision_type = None
        revision_types: list[str] = []
        draft_mismatch = False

        async with pool.acquire() as conn:
            async with conn.transaction():
                plan_row = await conn.fetchrow(
                    "SELECT * FROM plans WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
                    body.planId, TENANT)
                if plan_row is None:
                    return _err(404, "unknown_plan")

                draft_mismatch = body.draft is not None and list(body.draft) != list(plan_row["draft"])

                if plan_row["status"] in ("signed", "active"):
                    # 幂等：不重复落库，回读现有偏好对
                    already = True
                    pair_row = await conn.fetchrow(
                        "SELECT * FROM preference_pairs WHERE tenant_id=$1 AND plan_id=$2",
                        TENANT, body.planId)
                else:
                    # AI 初稿以 DB 行为准；终版取本次签发提交
                    final = list(body.final)
                    diff_ops = compute_diff_ops(plan_row["draft"], final)
                    revision_type, revision_types = classify_pair(diff_ops)
                    signed_row = await conn.fetchrow("""
                        UPDATE plans
                           SET status='signed', signed_at=now(), signed_by=$1,
                               final=$2, model=COALESCE($3, model),
                               tokens=COALESCE($4, tokens), cost=COALESCE($5, cost),
                               updated_at=now()
                         WHERE id=$6 AND tenant_id=$7
                         RETURNING *""",
                        body.signedBy or "doctor", final,
                        body.model, body.tokens, body.cost, body.planId, TENANT)
                    pair_row = await conn.fetchrow("""
                        INSERT INTO preference_pairs
                          (tenant_id, plan_id, member_id, draft, final, diff_ops,
                           revision_type, revision_types, model, tokens, cost, signed_by)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                        ON CONFLICT (tenant_id, plan_id) DO NOTHING
                        RETURNING *""",
                        TENANT, body.planId, signed_row["member_id"], signed_row["draft"], final,
                        diff_ops, revision_type, revision_types,
                        signed_row["model"], signed_row["tokens"], float(signed_row["cost"]),
                        body.signedBy or "doctor")
                    if pair_row is None:  # 并发下另一请求先插入 —— 读回即可
                        pair_row = await conn.fetchrow(
                            "SELECT * FROM preference_pairs WHERE tenant_id=$1 AND plan_id=$2",
                            TENANT, body.planId)

        counts = await get_counts(pool)
        if already:
            ops = pair_row["diff_ops"] if pair_row else {"lines": []}
            types = list(pair_row["revision_types"]) if pair_row else []
            return JSONResponse({
                "ok": True, "alreadySigned": True,
                "pairId": pair_row["id"] if pair_row else None,
                "plan": _plan_row_to_contract(plan_row, ops, types),
                "diffOps": ops,
                "revisionType": pair_row["revision_type"] if pair_row else "措辞",
                "revisionTypes": types,
                "counts": counts,
                **({"draftMismatch": True} if draft_mismatch else {}),
            })
        return JSONResponse({
            "ok": True, "alreadySigned": False,
            "pairId": pair_row["id"] if pair_row else None,
            "plan": _plan_row_to_contract(signed_row, diff_ops, revision_types),
            "diffOps": diff_ops,
            "revisionType": revision_type,
            "revisionTypes": revision_types,
            "counts": counts,
            **({"draftMismatch": True} if draft_mismatch else {}),
        })
    except Exception:  # noqa: BLE001
        logging.exception("sign failed")  # 详情进 ark-api 日志，不进响应体
        return _err(500, "sign_failed")
