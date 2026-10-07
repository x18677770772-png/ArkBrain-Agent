#!/usr/bin/env python3
"""A5 切片测试：diff 纯函数 + 分类器 + 端到端（TestClient 直连真 PG）。

Run: /usr/bin/python3 ark-api/test_slice.py
会重置并最终清空开发库中的切片状态（preference_pairs / lab_results 截断、
PL-8841 回 pending_review），保证阶段间验收从干净现场开始。
"""
import asyncio
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

failed = 0


def check(cond: bool, label: str) -> None:
    global failed
    if cond:
        print(f"PASS: {label}")
    else:
        print(f"FAIL: {label}")
        failed += 1


# ---------------------------------------------------------------- 纯函数

def seed_draft_final() -> tuple[list[str], list[str]]:
    """从契约真源 biz-data.js 提取种子方案（锁「字段形状不变」承诺）。"""
    src = (HERE.parent / "src" / "ui" / "brain-ui" / "biz-data.js").read_text(encoding="utf-8")
    seg = src[src.index("plan: {"):src.index("revisions:")]
    def grab(key: str) -> list[str]:
        arr = re.search(key + r":\s*(\[[^\]]*\])", seg, re.S).group(1)
        return json.loads(re.sub(r",(\s*[\]])", r"\1", arr))  # 去 JS 尾逗号
    return grab("draft"), grab("final")


from diff_service import REVISION_TYPES, classify_pair, classify_text, compute_diff_ops  # noqa: E402

draft, final = seed_draft_final()
ops = compute_diff_ops(draft, final)
changed = [line["i"] for line in ops["lines"] if not line["same"]]
check(changed == [1, 2, 4, 5], f"种子恰 4 改动行 [1,2,4,5]（实际 {changed}）")
check(len(ops["lines"]) == 6, "6 行全对齐")

line1 = next(l for l in ops["lines"] if l["i"] == 1)
replaces = [(op.get("old"), op.get("new")) for op in line1["ops"] if op["tag"] == "replace"]
# 逐字（字符级）= 最小替换：1650→1600 切成 5→0，40%→35% 切成 40→35
check(("5", "0") in replaces, "逐字粒度：1650→1600 最小切分为 5→0")
check(("40", "35") in replaces, "逐字粒度：40%→35% 最小切分为 40→35")
edits1 = [op for op in line1["ops"] if op["tag"] != "equal"]
check(len(edits1) >= 3, f"行1 有 ≥3 个独立编辑区（旧 diffSeg 只给 1 段；实际 {len(edits1)}）")
check(all(op["tag"] in ("equal", "delete", "insert", "replace") for l in ops["lines"]
          if not l["same"] for op in l["ops"]), "tag 只在 4 枚举内")
check(all("i" in l and "same" in l for l in ops["lines"]), "每行含 i/same")

check(classify_text("禁与人参同服，避免空腹") == "禁忌", "分类器 → 禁忌")
check(classify_text("每日热量 1650 kcal，碳水 40%") == "剂量", "分类器 → 剂量")
check(classify_text("久坐每小时起身 3 分钟") == "频次", "分类器 → 频次")
check(classify_text("依据 RCT 研究与指南证据") == "证据", "分类器 → 证据")
check(classify_text("转医学总监评估路径") == "措辞", "分类器 → 措辞兜底")

pair_type, line_types = classify_pair(ops)
check(pair_type in REVISION_TYPES, f"pair 主类型在 5 枚举内（实际 {pair_type}）")
check(len(line_types) == len(changed), "行级类型数 = 改动行数")
check(line_types[0] == "剂量", f"种子行1(热量/碳水/维D) → 剂量（实际 {line_types[0]}）")
check(line_types[1] == "频次", f"种子行2(每小时起身) → 频次（实际 {line_types[1]}）")


# ---------------------------------------------------------------- DB 现场重置

def reset_db() -> None:
    import asyncpg
    from db import load_dsn
    async def go() -> None:
        conn = await asyncpg.connect(load_dsn())
        try:
            await conn.execute("""
                TRUNCATE preference_pairs;
                TRUNCATE lab_results;
                UPDATE plans SET status='pending_review', signed_at=NULL,
                       signed_by=NULL, updated_at=now()
                 WHERE id='PL-8841';
            """)
        finally:
            await conn.close()
    asyncio.run(go())


# ---------------------------------------------------------------- 端到端

from fastapi.testclient import TestClient  # noqa: E402
from app import app  # noqa: E402  （import 触发模块加载；lifespan 由 TestClient 启动）

reset_db()

with TestClient(app) as client:
    r = client.get("/slice/health")
    check(r.status_code == 200 and r.json().get("db") == "up", "health: db up")

    r = client.get("/slice/bootstrap", params={"memberId": "MB-2041"})
    b = r.json()
    check(r.status_code == 200 and b["ok"], "bootstrap ok")
    check(b["meta"]["source"] == "postgres", "meta.source=postgres")
    check(b["metrics"] == {"preferencePairs": 0, "preferenceToday": 0, "plansSigned": 0},
          f"空库 metrics 全 0（实际 {b['metrics']}）")
    check(b["plan"] and b["plan"]["status"] == "pending_review", "plan=pending_review")
    check(b["lab"] is None, "lab 无行 → null（前端回种子）")
    boot_changed = [l["i"] for l in b["plan"]["diffOps"]["lines"] if not l["same"]]
    check(boot_changed == [1, 2, 4, 5], "bootstrap 现算 diffOps 与纯函数一致")

    # 检测录入：客户端谎报 status，服务端必须重算
    lab_doc = {
        "panel": "功能医学核心 · 62项", "date": "2026-10-08", "lab": "金域医学",
        "hero": {"name": "空腹血糖", "code": "GLU", "value": 6.5,
                 "unit": "mmol/L", "range": [3.9, 6.1], "status": "in",  # 谎报 in
                 "trend": [5.4, 5.8, 6.1, 6.3, 6.5]},
        "items": [
            {"name": "空腹血糖", "code": "GLU", "value": 6.5, "unit": "mmol/L",
             "range": [3.9, 6.1], "status": "in"},
            {"name": "维生素D", "code": "25-OH-VD", "value": 28, "unit": "ng/mL",
             "range": [30, 80], "status": "in"},
        ],
        "bioAge": 43.1, "chronological": 42, "aiNote": "录入测试",
    }
    r = client.post("/slice/lab/results", json={"memberId": "MB-2041", "lab": lab_doc})
    saved = r.json()
    check(r.status_code == 200 and saved["ok"], "lab 录入 ok")
    check(saved["lab"]["hero"]["status"] == "high",
          f"服务端重算 hero status：in→high（实际 {saved['lab']['hero']['status']}）")
    check(saved["lab"]["items"][1]["status"] == "low",
          f"服务端重算 item status：in→low（实际 {saved['lab']['items'][1]['status']}）")

    r = client.get("/slice/bootstrap", params={"memberId": "MB-2041"})
    check(r.json()["lab"] and r.json()["lab"]["date"] == "2026-10-08",
          "lab 回读：日期与 doc 保真")

    # 签发
    r = client.post("/slice/plans/sign", json={
        "planId": "PL-8841", "memberId": "MB-2041",
        "draft": draft, "final": final,
        "model": "ark-code-latest", "tokens": 4820, "cost": 0.62,
        "signedBy": "周慕白",
    })
    s = r.json()
    check(r.status_code == 200 and s["ok"] and s["alreadySigned"] is False, "首次签发成功")
    check(s["plan"]["status"] == "signed" and s["plan"]["signedAt"], "plan → signed + signedAt")
    check(s["counts"] == {"preferencePairs": 1, "preferenceToday": 1, "plansSigned": 1},
          f"签发后 counts=1/1/1（实际 {s['counts']}）")
    check(s["pairId"] is not None, f"返回 pairId（{s['pairId']}）")
    sign_changed = [l["i"] for l in s["diffOps"]["lines"] if not l["same"]]
    check(sign_changed == [1, 2, 4, 5], "落库 diffOps 含逐字改动")
    check(s["revisionType"] in REVISION_TYPES, f"revisionType ∈ 枚举（{s['revisionType']}）")

    # 幂等重签
    r = client.post("/slice/plans/sign", json={
        "planId": "PL-8841", "memberId": "MB-2041", "final": final})
    s2 = r.json()
    check(s2["ok"] and s2["alreadySigned"] is True, "重复签发 → alreadySigned")
    check(s2["counts"]["preferencePairs"] == 1, "重签不产生第二行（pairs 仍 1）")

    # 错误路径
    r = client.post("/slice/plans/sign", json={"planId": "NOPE", "final": final})
    check(r.status_code == 404 and r.json()["error"] == "unknown_plan", "未知方案 → 404")
    r = client.post("/slice/lab/results", json={"memberId": "MB-2041", "lab": {}})
    check(r.status_code == 400 and r.json()["error"] == "lab_hero_required", "空 lab → 400")

reset_db()
print(("\n全部通过" if failed == 0 else f"\n{failed} 项失败"))
sys.exit(1 if failed else 0)
