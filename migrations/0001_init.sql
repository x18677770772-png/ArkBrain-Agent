-- 0001_init.sql — A5 纵切片初始 schema（ADR-103：本目录为唯一 DDL 真源）
-- 字段语义对齐蓝图 v1.0（四元组/修订类型5枚举/plans 4态/tenant_id 第一天预留），
-- 形状契约 = 前端 seed src/ui/brain-ui/biz-data.js（头注释：A5 换 API 保持字段形状不变）。
-- 执行方：ark-api/migrate.py（schema_migrations 记录，幂等）。

CREATE TABLE tenants (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tenants (code, name) VALUES ('hq-demo', '生命方舟·金融城旗舰店');

-- 检测结果：JSONB doc 行（1 member = 最新 1 doc，upsert）。
-- seed 形状是契约（hero/items 整份保真回读）；行级拆分留给 OCR 阶段（source 已预留）。
CREATE TABLE lab_results (
  id            bigserial PRIMARY KEY,
  tenant_id     smallint NOT NULL DEFAULT 1 REFERENCES tenants(id),
  member_id     text NOT NULL,
  panel         text NOT NULL DEFAULT '',
  lab_name      text NOT NULL DEFAULT '',
  report_date   date,
  hero          jsonb NOT NULL,                       -- {name,code,value,unit,range[lo,hi],status,trend[]}
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{name,code,value,unit,range,status}]
  bio_age       numeric(5,1),
  chronological integer,
  ai_note       text NOT NULL DEFAULT '',
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','seed_import','ocr')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, member_id)
);
CREATE INDEX lab_results_member_idx ON lab_results (tenant_id, member_id, updated_at DESC);

-- 方案：状态机 draft → pending_review → signed → active（蓝图 PLN④）
CREATE TABLE plans (
  id          text PRIMARY KEY,                       -- 'PL-8841'
  tenant_id   smallint NOT NULL DEFAULT 1 REFERENCES tenants(id),
  member_id   text NOT NULL,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','pending_review','signed','active')),
  model       text,
  tokens      integer NOT NULL DEFAULT 0,
  cost        numeric(10,4) NOT NULL DEFAULT 0,
  draft       jsonb NOT NULL DEFAULT '[]'::jsonb,     -- AI 初稿（mock GW：种子播种）
  final       jsonb NOT NULL DEFAULT '[]'::jsonb,     -- 医生终版
  signed_at   timestamptz,
  signed_by   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_member_idx ON plans (tenant_id, member_id);

-- 播种切片目标方案（与前端 seed 逐字一致；diff 差异行 = [1,2,4,5]）
INSERT INTO plans (id, member_id, title, status, model, tokens, cost, draft, final)
VALUES (
  'PL-8841', 'MB-2041', '代谢优化干预包 · 90天', 'pending_review',
  'ark-code-latest', 4820, 0.62,
  '[
    "【目标】90天内空腹血糖稳定 <5.7 mmol/L，LDL-C 下降 ≥10%。",
    "【营养】每日热量 1650 kcal；碳水供能比 40%；晚餐提前至 19:00 前；补充 Omega-3 2g/日。",
    "【运动】每周 150 分钟中等强度有氧 + 2 次抗阻；步数目标 8000/日。",
    "【睡眠】就寝 23:00±30min，睡眠时长 ≥7h；睡前 1h 屏幕禁用。",
    "【随访】第 2/6/10 周各 1 次线上随访；第 90 天复检空腹血 + 血脂四项。",
    "【风险】LDL-C 若 6 周未降，转医学总监评估药物路径。"
  ]'::jsonb,
  '[
    "【目标】90天内空腹血糖稳定 <5.7 mmol/L，LDL-C 下降 ≥10%。",
    "【营养】每日热量 1600 kcal；碳水供能比 35%；晚餐提前至 19:00 前；补充 Omega-3 2g/日 + 维生素D 2000IU/日。",
    "【运动】每周 150 分钟中等强度有氧 + 2 次抗阻；步数目标 8000/日；久坐每小时起身 3 分钟。",
    "【睡眠】就寝 23:00±30min，睡眠时长 ≥7h；睡前 1h 屏幕禁用。",
    "【随访】第 2/6/10 周各 1 次线上随访；第 90 天复检空腹血 + 血脂四项 + 25-OH-VD。",
    "【风险】LDL-C 若 6 周未降，转医学总监评估药物路径；尿酸持续 >420 加痛风宣教。"
  ]'::jsonb
);

-- 偏好对：AI初稿 × 终版 × 逐字diff × 修订类型 × token成本（蓝图 TRJ②，服务端 difflib 单写者）
-- UNIQUE(tenant_id, plan_id) = 一方案一偏好对，DB 级签发幂等
CREATE TABLE preference_pairs (
  id              bigserial PRIMARY KEY,
  tenant_id       smallint NOT NULL DEFAULT 1 REFERENCES tenants(id),
  plan_id         text NOT NULL REFERENCES plans(id),
  member_id       text NOT NULL,
  draft           jsonb NOT NULL,
  final           jsonb NOT NULL,
  diff_ops        jsonb NOT NULL,                     -- {lines:[{i,same,ops:[{tag,text|old,new}]}]}
  revision_type   text NOT NULL CHECK (revision_type IN ('剂量','频次','措辞','禁忌','证据')),
  revision_types  jsonb NOT NULL DEFAULT '[]'::jsonb, -- 行级分类（改动行序）
  model           text,
  tokens          integer,
  cost            numeric(10,4),
  signed_by       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plan_id)
);
CREATE INDEX preference_pairs_created_idx ON preference_pairs (tenant_id, created_at DESC);

-- GW 占位表（A5 不写入；网关接入后每次 LLM 调用只增审计）
CREATE TABLE llm_calls (
  id            bigserial PRIMARY KEY,
  tenant_id     smallint NOT NULL DEFAULT 1 REFERENCES tenants(id),
  provider      text,
  model         text,
  prompt_hash   text,
  response_hash text,
  tokens_in     integer,
  tokens_out    integer,
  cost          numeric(10,4),
  actor         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_created_idx ON llm_calls (tenant_id, created_at DESC);
