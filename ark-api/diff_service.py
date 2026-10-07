"""偏好对 diff 服务 —— 蓝图 TRJ「两表一函数」的函数侧。

服务端 difflib 单写者（蓝图裁定：埋点反面清单第 1 条 = 绝不让前端自算第二套）。
纯函数、零 IO：app.py 的 bootstrap/sign 都调这里；测试直接 import。
"""
import re
from difflib import SequenceMatcher

# 5 枚举（蓝图 PLN⑤）。元组顺序 = 平票时的优先级：禁忌 > 剂量 > 频次 > 证据 > 措辞
REVISION_TYPES = ("禁忌", "剂量", "频次", "证据", "措辞")

_RULES = (
    # 字面词匹配（审查修正：字符类 [禁忌] 会把单个「忌」误判为禁忌）
    ("禁忌", re.compile(r"禁忌|禁用|禁食|不建议|慎用|慎食|避免")),
    ("剂量", re.compile(r"\d+(?:\.\d+)?\s*(?:kcal|%|mg|g|μg|IU|ml|mL|mmol|ng)(?:/(?:日|周|天))?")),
    # 第 2/6/10 周 这类多序号随访节奏也算频次（种子行 4 的真实形态）
    ("频次", re.compile(r"每(?:日|周|天|小时|次|晚)|次\s*/|/\s*(?:日|周)|第\s*\d+(?:/\d+)*\s*周|分钟|小时")),
    ("证据", re.compile(r"研究|证据|文献|指南|荟萃|RCT")),
)


def compute_diff_ops(draft: list[str], final: list[str]) -> dict:
    """逐字 diff（行对齐 + 行内字符级）。输出即 preference_pairs.diff_ops 的 JSONB 形状。"""
    lines = []
    for i in range(max(len(draft), len(final))):
        old = draft[i] if i < len(draft) else None
        new = final[i] if i < len(final) else None
        if old is None:
            lines.append({"i": i, "same": False, "ops": [{"tag": "insert", "text": new}]})
        elif new is None:
            lines.append({"i": i, "same": False, "ops": [{"tag": "delete", "text": old}]})
        elif old == new:
            lines.append({"i": i, "same": True})
        else:
            ops = []
            # autojunk=False：中文短句里高频字符也会被当垃圾块，必须关
            for tag, a1, a2, b1, b2 in SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
                if tag == "equal":
                    ops.append({"tag": "equal", "text": old[a1:a2]})
                elif tag == "delete":
                    ops.append({"tag": "delete", "text": old[a1:a2]})
                elif tag == "insert":
                    ops.append({"tag": "insert", "text": new[b1:b2]})
                else:
                    ops.append({"tag": "replace", "old": old[a1:a2], "new": new[b1:b2]})
            lines.append({"i": i, "same": False, "ops": ops})
    return {"lines": lines}


def _changed_text(ops: list[dict]) -> str:
    """拼接一行内所有非 equal 段的 old∪new 文本，供分类器匹配。"""
    parts = []
    for op in ops:
        if op["tag"] == "equal":
            continue
        if "old" in op:
            parts.append(op["old"])   # replace
        if "new" in op:
            parts.append(op["new"])   # replace / insert
        if "text" in op:
            parts.append(op["text"])  # delete / insert
    return "".join(parts)


def classify_text(text: str) -> str:
    """对改动文本按 禁忌→剂量→频次→证据 首命中，兜底 措辞。"""
    for label, pattern in _RULES:
        if pattern.search(text):
            return label
    return "措辞"


def classify_pair(diff_ops: dict) -> tuple[str, list[str]]:
    """返回 (pair 级主类型, 改动行的行级类型列表，顺序 = 改动行出现序)。

    pair 级：改动行类型取多数；平票按 REVISION_TYPES 优先级。
    """
    line_types: list[str] = []
    for line in diff_ops["lines"]:
        if line.get("same"):
            continue
        line_types.append(classify_text(_changed_text(line["ops"])))
    if not line_types:
        return "措辞", []
    counts = {t: line_types.count(t) for t in set(line_types)}
    top = max(counts.values())
    # 平票：按优先级元组顺序取第一个达到 top 的类型
    for t in REVISION_TYPES:  # 元组顺序即优先级 禁忌>剂量>频次>证据>措辞
        if counts.get(t) == top:
            return t, line_types
    return "措辞", line_types
