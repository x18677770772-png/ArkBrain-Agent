# 睿美云 SaaS 二次开发技术文档

> **文档用途**：交付给 AI Agent 开发方（Claude），用于构建与「睿美云」SaaS 集成的自动化 Agent / 数据看板 / 业务机器人。
> **信息来源**：睿美云 Windows 客户端 `4.128.8` 前端 bundle 全量静态提取（4229 个路径）+ 真实租户环境实测验证（33 个接口，32 个成功，含完整响应结构）。
> **生成时间**：2026-09-10（v2：补入真实字段级 Schema）｜ **样本租户**：`bksw9854`（贵州北科生物，subdomain `bksw`）
> **配套文件**：
> - `api-endpoints.json` — 4229 条接口/路由全量清单（机器可读，含分类、模块、方法、验证状态）
> - `agent-tools.json` — 建议的 Agent 工具清单（业务意图 → 接口映射）
> - `api-schemas.json` — 33 个接口的实测响应结构（字段级，PII 已脱敏）
> - `reference-data.json` — 参考数据：25 个客户数据集定义、6 个公海池明细、字典、科室树
> - `harvest-schemas.js` — 结构采样脚本（换新 token 可重新生成 schema）

---

## 0. 快速上手（TL;DR）

```text
1) 取 token：GET  https://{子域}.hospital.realmerit.com.cn/api/v1/getPublicKey
2) 登录：    POST https://{子域}.hospital.realmerit.com.cn/api/v1/login
             body: {account, password: RSA加密后base64, hospitalKey, tenantId, type:1, mac, loginType:"PC_WEB"}
              ★ type:1 必传，缺失会报 20009 密码错误（见 §2.6.3）
3) 取数：    GET/POST https://{子域}.hospital.realmerit.com.cn/api/v1/xxx
             headers: { Authorization: <JWT裸值>, tenant: "1", lang: "zh-CN" }
4) 响应：    { code: 10000|10001|10002, msg: "...", data: {...} }   ← 三种都算成功
5) 运营报表：POST https://{子域}.hospital.realmerit.com.cn/api/report/v1/wym/{类目}/{报表}
             body: { year: "2026" }   ← 核心参数（见 §9，69/77 实测可用）
6) 注意：    浏览器端 POST 会被 CORS 拦截（服务端只允许 GET 跨域）→ 必须经服务端代理
```

**最小可用调用（已验证）**

```bash
curl -H "Authorization: <JWT>" -H "tenant: 1" -H "lang: zh-CN" \
     "https://bksw.hospital.realmerit.com.cn/api/v1/channel/getCustomerNumber"
# → {"code":10001,"msg":"成功获取数据，数据非空","data":3428}

# 运营报表（客户腰率/流失预警）：
curl -X POST -H "Authorization: <JWT>" -H "tenant: 1" -H "lang: zh-CN" -H "Content-Type: application/json" \
     -d '{"year":"2026"}' \
     "https://bksw.hospital.realmerit.com.cn/api/report/v1/wym/celebrateCustomer/getCustomerWaistRate"
# → {"code":10001,...,"data":{"average":2041.2,"customerAmount":20412,"customerNum":10,"waistRate":"10.00%"}}
```

---

## 1. 系统架构总览

### 1.1 三层结构

```
┌─────────────────────────────────────────────────────────────────┐
│ ① 睿美云桌面客户端（Windows / Electron，内部代号 Neuron）        │
│    E:\Program Files (x86)\ruimeiyun\睿美云.exe                    │
│    · 仅是一个"壳"：主进程加载远程 Web 页面，不含业务逻辑          │
│    · webSecurity:false / nodeIntegration:true / devTools:true    │
│    · 本地插件桥 WebSocket: ws://localhost:9800/plugin            │
│    · product_name=智能管理平台  version=5.0.0  build=4.128.8     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 加载远程页面
┌───────────────────────────▼─────────────────────────────────────┐
│ ② Web SPA「智能管理系统」（React + axios + mobx，多标签页架构）  │
│    · 加载器：https://system.realmerit.com.cn                     │
│    · 静态资源：https://web.realmerit.com.cn/static/4.128.8/      │
│    · 前端路由 256 个（/portal/xxx），全部在 api-endpoints.json   │
│    · 本地存储经自研 WASM 加密（__realmerit__ / gateway_info_*）  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ XHR / WebSocket（Authorization: JWT）
┌───────────────────────────▼─────────────────────────────────────┐
│ ③ 租户 API 网关（每院独立子域，微服务聚合）                      │
│    https://{hospitalKey}.hospital.realmerit.com.cn/api           │
│    · /api/v1/*      3604 个端点（主业务微服务）                  │
│    · /api/v2/*       181 个端点（新版：预约/接诊/RFM/数据集）    │
│    · /report/v1/*    184 个端点（报表统计服务）                  │
│    · /api/v2/ws      WebSocket（消息/通知推送）                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 域名与环境地图

| 域名 | 用途 | 关键路径（实测） |
|---|---|---|
| `{hk}.hospital.realmerit.com.cn` | **租户业务 API 网关**（hk=医院标识，本例 `bksw`） | `/api/v1/*`、`/api/v2/*`、`/report/v1/*` |
| `gateway.system.realmerit.com.cn` | 医院网关配置下发（响应 WASM 加密） | `/release/api/hospital/{hospitalKey}/{host}` |
| `gatewaybackup.system.realmerit.com.cn` | 网关配置备份 | `/{hospitalKey}.json` |
| `client.realmerit.com.cn` | 客户端版本管理 | `/appversion/v1/appVersionInfo/pass/getByOrgCode?orgCode={hk}` → `currentVersion: 4.128.8` |
| `web.realmerit.com.cn` | 前端静态资源 CDN（OSS） | `/static/{version}/app.html`、`/static/{version}/login.html` |
| `system.realmerit.com.cn` | SPA 加载器入口 | `/`（含 chunk 映射与版本切换逻辑） |
| `middleplatform.realmerit.com.cn` | 集团中台（组织/广告位） | `/organization/v1/orgAdvert/pass/currentInfo?terminal=pc&type=realmerit` |
| `poster.realmerit.com.cn` | 中台海报资源 | — |
| 测试环境 | 厂商内部测试 | `test.system.realmerit.com.cn`、`test.hospital.realmerit.com.cn`（192.168.2.115）、`testmiddleplatform.realmerit.com.cn` |

> ⚠️ **多环境注意**：生产 API 域名与静态 CDN 域名不同；静态资源版本号来自版本接口，**不要硬编码**（本例客户端本地 `build_version` 是 `4.128.84`，而实际 CDN 目录是 `4.128.8`，写错会 404）。

### 1.3 多租户模型

| 概念 | 说明 | 本例值 |
|---|---|---|
| `hospitalKey` / `orgCode` | 医院唯一标识（决定 API 子域） | `bksw9854` |
| 子域前缀 | API 域名首段 | `bksw` |
| `tenantId` | 租户 ID（请求头 `tenant`） | `1` |
| `userId` / `userNo` | 用户 ID（19 位雪花 ID） | `497462525051273216` |
| `sole` | 会话唯一标识（JWT 内） | 32 位 hex |
| 集团模式 | `IS_GROUP` 开关 → 跨院共享/审批 | 前端存在，需按租户确认 |

**推论**：接入任意一家医院，只需替换 `{hk}` 子域 + 该院账号，接口路径完全一致（同一套代码多租户部署）。

### 1.4 运行时地址（**注意：不是登录响应下发的**）

二次开发只需知道 API 基址即可，用固定的租户子域名：

```
api_url         https://{subdomain}.hospital.realmerit.com.cn/api   ← 本例 https://bksw.hospital.realmerit.com.cn/api
websocket_url   wss://{subdomain}.hospital.realmerit.com.cn
文件/影像        https://{subdomain}.hospital.realmerit.com.cn/file   ← 见登录响应 photoDomainPrefix
```

> 客户端是从网关接口 `https://gateway.system.realmerit.com.cn/release/api/hospital/{hospitalKey}/{host}`
> 取得这些地址的，返回值为**加密十六进制串**（客户端 WASM 解密）。
> 登录响应 `data` 里**没有** `api_url`/`websocket_url` 字段（实测约 120 个字段，见 §2.6.7）。

---

## 2. 认证与鉴权

### 2.1 登录流程（三步，已实测）

```
① GET  /api/v1/getPublicKey                       ← 无需鉴权
   → { code:10000, data: "<Base64 编码的 RSA 公钥(SPKI/PKCS#8)>" }

② 本地加密：RSA/ECB/PKCS1Padding（PKCS#1 v1.5）
   cipher = base64( RSA_encrypt( publicKey, utf8(明文密码) ) )

③ POST /api/v1/login
   body: {
     "account":    "<登录账号>",
     "password":   "<② 的密文>",
     "hospitalKey":"bksw9854",
     "tenantId":   "1",          // 来自 GET /v1/getAllTenantTree 的 value
     "type":       1,            // ★★★ 必需！缺失会返回 20009「密码错误」（极易踩坑）
     "mac":        "",           // 网页版为空串；Electron 客户端传真实 MAC
     "loginType":  "PC_WEB"      // 网页版 PC_WEB；Electron 客户端 PC
   }
   → { code:10000, data:{ user:{ token:"<JWT>", ... }, permList, menuList, globalConfig, ... } }
```

> **⚠️ 头号踩坑点：`type: 1` 必须传。**
> 网页版表单提交的完整载荷是 `{account, password, hospitalKey, tenantId, tenantInfo, type: 1, rememberPwd}`，
> 其中 `login()` 只剔除 `tenantInfo` 与 `rememberPwd`，**`type: 1` 会随请求发出**。
> 漏掉它时服务端仍会找到账号并返回 `20009 密码错误`（而不是提示缺参数），排查极易走偏——本会话实测踩过此坑。
>
> `phone` 字段**不是必需的**（网页版不发送）；发送也不会报错。

**⚠️ 运行时配置不是登录响应下发的**（修正早期版本）：`api_url` / `websocket_url` 等来自网关接口
`https://gateway.system.realmerit.com.cn/release/api/hospital/{hospitalKey}/{host}`，返回**加密十六进制串**，
由客户端本地 WASM 解密。二次开发时直接用已知的 `https://{subdomain}.hospital.realmerit.com.cn/api` 即可。

**Node.js 实现（已验证可用）**

```js
const crypto = require('crypto');

async function login(base, { account, password, hospitalKey, tenantId = '1' }) {
  const pub = await (await fetch(`${base}/v1/getPublicKey`)).json();
  const key = `-----BEGIN PUBLIC KEY-----\n${pub.data.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  const enc = crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(password, 'utf8')
  ).toString('base64');

  const r = await (await fetch(`${base}/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'lang': 'zh-CN' },
    body: JSON.stringify({ account, phone: '', password: enc, hospitalKey, tenantId, mac: '', loginType: 'PC_WEB' })
  })).json();

  if (r.code !== 10000) throw new Error(`登录失败: ${r.msg}`);
  return { token: r.data.user.token, runtime: r.data };
}
```

**Python 实现**

```python
import base64, json, requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

def login(base, account, password, hospital_key, tenant_id="1"):
    pub_b64 = requests.get(f"{base}/v1/getPublicKey").json()["data"]
    pub = serialization.load_der_public_key(base64.b64decode(pub_b64))
    enc = base64.b64encode(pub.encrypt(password.encode(), padding.PKCS1v15())).decode()
    r = requests.post(f"{base}/v1/login", json={
        "account": account, "phone": "", "password": enc,
        "hospitalKey": hospital_key, "tenantId": tenant_id,
        "mac": "", "loginType": "PC_WEB"
    }, headers={"lang": "zh-CN"}).json()
    assert r["code"] == 10000, r["msg"]
    return r["data"]["user"]["token"], r["data"]
```

### 2.2 JWT 结构与有效期

**算法**：HS256（对称签名，服务端密钥）
**实测 payload**：

```json
{
  "tenant_id": "1",
  "sole": "34cf985103b146fb957c47350dc341f1",
  "userNo": "497462525051273216",
  "currentTimeMillis": 1788515419216,
  "id": "497462525051273216",
  "type": "user",
  "exp": 1788811199
}
```

- `exp` 为 Unix 秒 → 实测有效期 **约 3.4~3.7 天**（两次采样：登录时刻 +82h / +88h，非固定值 —— **请按 `exp` 动态计算，不要硬编码**）
- 过期响应：HTTP 401 + `{"code":401,"msg":"身份信息已经过期，请重新登陆！"}`
- 无 token：HTTP 401 + `{"msg":"无权访问，请登录后再操作！","code":401}`

### 2.3 请求头规范

| Header | 值 | 必需 |
|---|---|---|
| `Authorization` | **JWT 裸值，不带 `Bearer ` 前缀** | ✅ |
| `tenant` | 租户 ID（如 `1`） | ✅ |
| `lang` | `zh-CN` | 建议 |
| `Content-Type` | `application/json`（POST 时） | 写操作必需 |
| `X-No-Wrap` | `true` → 强制返回明文 JSON（否则可能被 WASM 包装/加密） | 建议 |

### 2.4 Token 续期

| 接口 | 说明 |
|---|---|
| `GET /api/v1/refreshLogin` | 续期（需带当前有效 token），返回新 token |
| `GET /api/v1/afterLoginLoadData?tenantId={id}` | 登录后聚合数据（菜单/权限/配置），**Agent 启动时应调用一次**以获取权限上下文 |

**Agent 建议**：实现 token 缓存 + 到期前 12 小时自动重新登录；登录失败（如密码策略变更）需告警而非静默重试。
密码策略接口：`/api/v1/loginPasswordRuleConfiguration/getPasswordRule`。

### 2.5 权限模型

- `afterLoginLoadData` 返回 `permList`（本例 **1018 项权限点**）、`menuList`、`globalConfig`(279)、`menuTempList`(123)、`fieldList`
- 权限点粒度到「按钮/字段」级；无权限时接口可能返回空数据而非报错（**Agent 需区分"无数据"与"无权限"**）
- 数据范围：`/api/v1/user/dataRange`（可见客户范围）、`/api/v1/user/exclusive-servers`（专属客服）
- **建议**：为 Agent 单独创建最小权限服务账号，只授予需要的模块（客户查询/报表只读）

---

### 2.6 多账号 / 多角色登录（Agent 集成场景）★

#### 2.6.1 概念澄清：没有「按角色登录」，只有「按账号登录」

登录参数中**不存在 roleId / role 字段**。角色是**账号的属性**：登录后由 `GET /v1/afterLoginLoadData?tenantId=1`
下发 `permList`（权限点，本租户实测 1018 项）、`menuList`、`dataRange`（数据范围），服务端据此自动裁剪数据。

> 因此「按不同角色登录」的正确实现 = **为每个角色创建一个专用账号**（在后台配好角色/岗位/权限），Agent 按角色选用对应账号登录。

#### 2.6.2 机构下拉菜单的数据源（登录前，公开接口）

```http
GET /api/v1/getAllTenantTree?phone={手机号}&hospitalKey={机构码}
→ { "code": 10001, "data": [ { "title": "贵州北科生物", "value": "1", "disabled": false,
                              "shopType": 3, "key": "1", "parentId": "" } ] }
```

- `value` 即登录时要传的 **`tenantId`**
- 该接口同时是**账号存在性校验**：手机号无账号时返回 `code:10002` + 空数组（实测对照：虚构手机号 → 0 个机构）
- 网页版登录页的「机构下拉菜单」就是它渲染的

#### 2.6.3 完整登录请求体（实测字段，逐项对应客户端实现）

```json
POST /api/v1/login
{
  "account":    "18677770772",     // 账号（手机号）
  "phone":      "18677770772",     // 同账号
  "password":   "<RSA 密文 Base64>", // JSEncrypt.encrypt(明文)，PKCS#1 v1.5
  "hospitalKey":"bksw9854",        // 机构码（URL ?code= 的值）
  "tenantId":   "1",               // 来自 getAllTenantTree 的 value
  "type":       1,                 // ★★★ 必需！缺失 → 20009 密码错误
  "mac":        "",                // 网页版为空；Electron 客户端传真实 MAC
  "loginType":  "PC_WEB"           // 网页版 PC_WEB；Electron 客户端 PC
}
```

> 客户端源码逐行对应（`login-index.js` 与表单 chunk `index-3e47ee42.js`）：
> 表单提交：`j.login({account, password, hospitalKey, tenantId, tenantInfo:{flatList,list}, type:1, rememberPwd})`；
> `login()` 中：`loginType: this.env.isElectron ? "PC" : "PC_WEB"`；`mac = isElectron ? electron.getMac() : ""`；
> `password: this.security.encryptPassword(publicKey, password)`（标准 JSEncrypt，PKCS#1 v1.5，无二次哈希）；
> 请求体中的 `tenantInfo`、`rememberPwd` 被解构剔除**不发送**，但 **`type: 1` 会发送**。

**登录相关错误码（实测）**

| code | msg | 含义 |
|---|---|---|
| `20001` | 密码不能为空 | password 传空串 |
| `20007` | 用户不存在 | 账号在本租户下不存在 |
| `20009` | 密码错误 | 账号存在但密码不对；**缺 `type` 字段或密文损坏也返回此码** |
| `20004` | 您不是最新版本…(缺少必要请求参数) | 缺参数 |
| `PASSWORD_LOCK` | 密码锁定 | 前端枚举中有此码（多次失败会锁，登录页会弹提示并跳转） |
| `DISABLE_ACCOUNT` / `MOBILE_ERROR` | 账号停用 / 手机号错误 | 前端枚举 |

> 前端错误码枚举（来自表单 chunk）：`MOBILE_ERROR`、`DISABLE_ACCOUNT`、`USER_NOT_FOUND` → 显示在账号输入框；
> `USER_PASSWORD_ERROR` → 显示在密码输入框；`PASSWORD_LOCK` → 全局提示并锁定。**建议失败重试不超过 3 次。**

#### 2.6.4 ✅ 同一账号允许多个并发会话（实测，已修正）

**实测结论**：连续用同一账号登录 3 次，得到的 3 个 token **全部同时有效**——新登录**不会**踢掉旧会话，
每次登录只是轮换 JWT 中的 `sole`（会话标识）。

```
[1] 登录成功  sole=360b3455…
[2] 登录成功  sole=9b5419f9…
[3] 登录成功  sole=d03e9401…
T1(最早) → code=10000 ✅ 仍有效
T2       → code=10000 ✅ 仍有效
T3(最新) → code=10000 ✅ 仍有效
```

> 早期版本本文档曾判断「一账号一会话」，那是**错误结论**：当时 token 失效的真实原因是**在网页端主动点了退出登录**。
> 正确理解：**显式登出会使 token 失效**（`POST /v1/customerSourceConfig/globalLoginOutAll` 可全局登出），
> 而并发登录不会。

**对 Agent 的影响**：
- 仍然**强烈建议每个角色使用独立机器人账号**（权限最小化、审计清晰），但技术上**不强制**——Agent 可与人工共用账号
- Bridge 仍必须捕获 `401`（token 约 3.5 天到期，或被显式登出）并**自动重新登录**
- 系统提供 `GET /v1/sysloginlog/getpage`（登录日志，可审计）

#### 2.6.5 密码策略（影响服务账号设计）

```http
GET /api/v1/loginPasswordRuleConfiguration/getPasswordRule?phone={手机号}&tenantId={tenantId}
→ { minPasswordLength: 6, maxPasswordLength: 50, containLetters: false, containSymbol: false,
    containsDigit: false, letterCapitalization: false, continuity: null, consistence: null,
    passwordLock: null, passwordValidityPeriod: "", restrictingModificationRules: null }
```

> 实测本租户：最少 6 位、无复杂度强制、无有效期（`passwordValidityPeriod` 为空）。
> 相关接口：`POST /v1/loginPasswordRuleConfiguration/verifyPassword`、`GET /v1/loginPasswordRuleConfiguration/getLoginRule`、
> `POST /v1/user/resetPassword`、`GET /v1/user/selectForgetPassInfo?accountInfo=&tenantId=`（返回 `{phone, sms:true}`）。

#### 2.6.6 ❌ 官方网页版的登录嵌入机制（已彻底分析，不可用于第三方集成）

结论先说：**不要试图用 iframe 嵌网页版登录页来获取 token——官方没有开可用通道。**

分析证据（`system.realmerit.com.cn` 的 SPA 外壳 + 登录页 bundle）：

| 机制 | 实现 | 第三方能否用 |
|---|---|---|
| 官方 SPA 外壳嵌登录页 | `<iframe id="realmerit" src="https://system.realmerit.com.cn/login/index.html">` | 能嵌（无 `X-Frame-Options`/CSP），但拿不到 token |
| 登录成功后的 token 传递 | 写入 **sessionStorage**（键 `__realmerit__`，加密）→ `location.replace(同源 /static/{version}/app.html)` | ❌ 靠**同源共享存储**，跨域 iframe 读不到 |
| `?justlogin=1` 模式 | `window.parent.postMessage({action:"realmerit_login_success", payload:{token, api_url, websocket_url, user}}, "https://web.realmerit.com.cn")` | ❌ targetOrigin 硬编码 `web.realmerit.com.cn`，其他域名收不到；且父窗口 handler 无此 action（死代码） |
| `action:"login"` 通道 | `postMessage(..., "*")` —— 但仅在 `?__dev__=true` 或 `?model=native` 时触发 | ⚠️ 这两个参数会把环境切到 **test**（host 变 `test.system.realmerit.com.cn`），**不可用于生产** |

> **正确做法**：服务端（Bridge）直接调 `/v1/login` 换 token。iframe 只能当「给人看的登录界面」。
>
#### 2.6.7 登录响应的真实结构（实测，约 120 个字段）

```json
POST /api/v1/login → { "code": 10000, "msg": "登录成功",
  "data": {
    "user": { "token": "<JWT>", "userCtrlType": { /* 数十项界面控件开关 */ }, ... },
    "permList": [ ... ],        // ★ 权限点（实测 1721 项）
    "menuList": [ ... ],        // 菜单（实测 4 项）
    "menuTempList": [ ... ],    // 菜单模板
    "globalConfig": [ ... ],    // 全局配置（实测 279 项）
    "fieldList": [ ... ], "fieldConfig": [ ... ],   // 字段配置
    "groupConfig": {...}, "areaConfig": {...}, "systemPrintingConfig": {...},
    "hospitalName": "...", "tenantHospitalName": "...", "hospitalIdentity": "...",
    "shopType": 3, "currency": "...", "lang": "...", "systemCategory": "...",
    "photoDomainPrefix": "https://bksw.hospital.realmerit.com.cn/file",
    "ossConfig": {...}, "accessKey": "...", "secretKey": "...",
    "isGroup": false, "groupMode": ..., "membershipType": ..., "callCenterType": ...,
    "smsConfigType": "0", "qrCodeStatus" /* 等约 100 项租户级开关 */
  }}
```

> **一次登录即可拿到权限与菜单**，不必额外调用 `/v1/afterLoginLoadData`
> （后者同样返回 `menuList/globalConfig/menuTempList/permList/fieldList`，实测 `permList` 1721 项）。
> 注意登录响应**不含** `api_url`/`websocket_url`（见 §1.4）。

#### 2.6.8 已交付：多角色 Bridge 服务（可直接运行）

`bridge/multi-role-server.js` —— 让 Agent 以不同角色账号调用睿美云，凭据不出服务端：

```
AI Agent ──► Bridge (127.0.0.1:8900) ──HTTPS──► https://bksw.hospital.realmerit.com.cn/api
```

| 端点 | 作用 |
|---|---|
| `GET /health` | 各角色可用性与当前会话（含 `sole`、到期时间） |
| `GET /roles` | 角色清单（不含任何凭据） |
| `GET /whoami?role=admin` | 触发登录并返回身份 + 权限数量自检 |
| `POST /api/call` | 通用代理 `{role, path, method, body, query}` |
| `POST /api/normalize` | 把 `"null"`/`"[]"` 字符串转回真实类型（§5.0 的坑） |

已实现：角色→账号映射、token 池（到期前 6h 主动续期）、**401 自动重登**、每角色 5 req/s 限流、
**报表路径支持（`/report/v1/wym/*`）**、**报表限流自动退避**（识别 401 伪装响应，等 4s 重试）、
**带 body 自动 POST**、PII 脱敏日志、审计日志（`bridge/bridge-audit.log`）。
密码只从环境变量读取（`passwordEnv`），**不落盘**。

```bash
# 业务接口（GET）
curl -X POST http://127.0.0.1:8900/api/call -H "Content-Type: application/json" \
  -d '{"role":"admin","path":"/v1/customer/getCustomerByPhone","query":{"phone":"137xxxx9999"}}'
# 运营报表（POST，带 body 自动用 POST）
curl -X POST http://127.0.0.1:8900/api/call -H "Content-Type: application/json" \
  -d '{"role":"admin","path":"/report/v1/wym/celebrateCustomer/getCustomerWaistRate","body":{"year":"2026"}}'
```

**实测结果**（2026-09-23）：`/whoami` → permList 1721；`/api/call` 取客户总数 → 3428；
按手机号搜索客户 → 命中；`/api/normalize` 正确还原类型。

---

## 3. 通用调用规范

### 3.1 响应信封与业务码

```json
{ "code": 10001, "msg": "成功获取数据，数据非空", "data": { } }
```

| code | 含义 | Agent 处理 |
|---|---|---|
| `10000` | 操作成功 | ✅ 成功 |
| `10001` | 成功获取数据，数据非空 | ✅ 成功（有数据） |
| `10002` | 操作成功，数据为空 | ✅ **成功但空集**（不是错误！） |
| `20001` | 密码不能为空 | ❌ 补密码 |
| `20002` | 版本/参数/方法错误（msg 含具体原因） | ❌ 修正参数或换方法 |
| `20004` | 缺少必要请求参数（msg：`您不是最新版本，请更新你的系统(缺少必要请求参数)`） | ❌ 补参数 |
| `20007` | 用户不存在（登录时账号在本租户下不存在） | ❌ 检查账号/机构 |
| `20009` | 密码错误（账号存在但密码不对；密文损坏同样返回此码） | ❌ 检查密码 |
| `401` (body, HTTP 200) | 路由不存在 **或** 未登录 | ❌ 检查路径/鉴权 |
| HTTP `401` | token 过期/无效 | 🔄 重新登录 |
| `403` / 其他 | 无权限 / 业务校验失败 | ❌ 记录 msg |

> **踩坑提示**：`{"msg":"没有找到您要的资源","code":401}` 在 HTTP 200 下返回，**既表示未登录也表示路由不存在**——排查时先确认路由是否存在于本租户网关。
> `20002` 的 msg 常直接给出原因，例如：`"Source must not be null"`（缺参数）、`"您不是最新版本，请更新你的系统 Request method 'POST' not supported"`（方法用错）。

### 3.2 分页规范（两套并存）

**A. MyBatis-Plus IPage**（`/api/v2/reception/receptionList`、`/api/v2/bespeak/bespeakList`）

```json
// 请求：{"page":1,"limit":20}   或   {"current":1,"size":20}
// 响应 data:
{
  "records": [ ... ], "total": 6, "size": 20, "current": 1, "pages": 1,
  "orders": [], "optimizeCountSql": true, "searchCount": true,
  "maxLimit": null, "countId": ""
}
```

**B. 简化分页**（`/api/v1/scrm/customer/scrmCustomerList`）

```json
// 请求：{"current":1,"size":20}      响应 data: { "total": 0, "list": [] }
```

> 注意：同一系统内两种风格混用；`current`/`size` 与 `page`/`limit` 不可混搭（混搭会返回 `20002 系统开小差了，请重试！` 或 `size:0`）。
> 建议 `size` ≤ 100，避免超时（前端对大数据量有 `timeout` 兜底提示"数据量过大"）。

### 3.3 CORS 限制（**关键约束**）

实测预检响应：

```
access-control-allow-origin: *
access-control-allow-headers: authorization, tenant, lang
access-control-allow-methods: GET          ← 只有 GET！
```

- ✅ **浏览器直连**：仅 `GET` 接口可用（可做纯前端看板）
- ❌ **浏览器发 POST/PUT/DELETE**：预检失败 → 必须经**服务端代理**转发
- 🔒 **安全建议**：不要在浏览器暴露 token，统一走自建 Bridge 服务（见 §6.1）

### 3.4 其他约定

- **⚠️ 字段值「字符串化」**：大量空值/空数组被后端序列化成字符串 —— `"age": "null"`、`"departmentConsumeList": "[]"`、`"links": "[]"`。
  这会让 `if (list.length)` 对 `"[]"` 恒真、`Number("null")` = `NaN`。**必须逐字段规范化**，详见 §5.0（本次字段级采样最重要的发现）
- **金额**：`number`（元，非分），可能为 `null` 或字符串 `"null"` → 前端展示为 `¥0`，Agent 需按 `?? 0` 处理
- **时间**：毫秒时间戳（如 `createDate: 1548245000000`）或 `YYYY-MM-DD HH:mm:ss` 字符串，混用
- **ID**：19 位雪花 ID，**字符串**传递（JS 数字精度会丢位！）
- **布尔**：`true/false` 与 `1/0` 混用（如 `jobStatus`）
- **导出类接口**：多为 `POST /.../export`，返回文件流或异步任务 ID
- **文件上传**：`POST /api/v1/aws/tempUploadUrl` → 取临时上传地址 → 直传 OSS；另有 `/api/v1/file_upload/upload_file`

---

## 4. 接口清单

### 4.1 ✅ 已实测验证接口（可直接开发使用）

| # | 接口 | 方法 | 说明 | 实测结果 |
|---|---|---|---|---|
| 1 | `/api/v1/getPublicKey` | GET | RSA 公钥 | `code:10000` |
| 2 | `/api/v1/login` | POST | 登录换 token | `code:10000` |
| 3 | `/api/v1/refreshLogin` | GET | 续期 | 静态确认 |
| 4 | `/api/v1/afterLoginLoadData?tenantId=1` | GET | 登录后聚合（菜单/权限/配置） | permList 1018 项 |
| 5 | `/api/v1/channel/getCustomerNumber` | GET | **客户总数** | `3428` |
| 6 | `/api/v1/channel/getAllChannel?flag=true` | GET | 渠道列表 | 13 条 |
| 7 | `/api/v1/customerPool/customerPools` | GET | **公海池统计+池列表**（实测 6 个池） | 个人池 2321 / 非个人池 1135 |
| 8 | `/api/v1/customer/getCustomerByPhone?phone=` | GET | **★客户搜索（手机号，支持模糊）** | 命中客户卡片数组 |
| 9 | `/api/v1/customer/detail?customerId=` | GET | **★客户完整档案（base 41 字段）** | 7141 字节 |
| 10 | `/api/v1/customer/getCustomerPhoneNumbers?customerId=` | GET | 客户电话列表 | `["137…"]` |
| 11 | `/api/v1/customer/getCustomerPhoneJson?customerId=` | GET | 客户电话（JSON 形式） | 成功 |
| 12 | `/api/v1/customerOverView/consumeStatistical?customerId=` | GET | **消费统计** | 余额/累计消费/赠送 |
| 13 | `/api/v1/customerOverView/getRfmScore?customerId=&isGroup=false` | GET | **RFM 评分** | score + 3 指标 |
| 14 | `/api/v1/customerOverView/cusRelations?id=` | GET | **客户关系图谱** | 节点+统计 |
| 15 | `/api/v1/customerOverView/arriveDetail?customerId=` | GET | 到店明细 | 空集 |
| 16 | `/api/v1/customerOverView/recentAppointment?customerId=` | GET | 近期预约 | 字符串 `"null"` |
| 17 | `/api/v1/customerOverView/consumptionBehaviorTrack?customerId=&startTime=` | GET | 消费行为轨迹 | 空集 |
| 18 | `/api/v1/customer/getCoordinate?customerId=` | GET | 客户坐标 | 空集 |
| 19 | `/api/v1/member/level/getHCustomerMemberLevel?customerId=` | GET | 会员等级 | 空集 |
| 20 | `/api/v1/customer/initListV2` | GET | **★客户分布树（池→用户→客户数）** | `extra` 字段=客户数 |
| 21 | `/api/v2/customer/cube/template/get-user-all-cube-config` | GET | **客户数据集定义（去重后 25 个）** | 74 条记录 |
| 22 | `/api/v2/customer/cube/template/get-user-cube-config` | GET | 用户自建数据集 | 空 |
| 23 | `/api/v1/scrm/customer/scrmCustomerList` | POST | SCRM 客户分页列表 | `{total:0,list:[]}` |
| 24 | `/api/v2/reception/receptionList` | POST | **接诊分页列表** | IPage |
| 25 | `/api/v2/bespeak/bespeakList` | POST | **预约分页列表** | IPage |
| 26 | `/api/v1/msg/todayTotal` | GET | 今日消息/任务汇总 | `{msgNum:12,tskNum:0,sumNum:0}` |
| 27 | `/api/v1/user/userAll` | GET | 员工列表 | 52 条 / 13 字段 |
| 28 | `/api/v1/user/userAllEnable` | GET | 在职员工（**字段语义不同**） | 49 条 / 16 字段 |
| 29 | `/api/v1/user/getAllDoctors` | GET | 医生列表 | 11 条 `{value,label}` |
| 30 | `/api/v1/dept/tree` | GET | 科室/部门树 | 含父子关系 |
| 31 | `/api/v1/role/tree/` | GET | 角色树 | 16 条 |
| 32 | `/api/v1/menu/allCollect` | GET | 收藏菜单（含前端路由映射） | 成功 |
| 33 | `/api/v1/dict?codes=channelLevel` | GET | 数据字典（支持多 code） | 成功 |
| 34 | `/api/v1/visitPlan/init` | GET | 回访计划初始化配置 | 52KB |
| 35 | `/api/v1/customer/oldNew` | GET | 新老客统计 | 本租户空 |

> **⚠️ 计数口径提醒**：`channel/getCustomerNumber` 返回 `3428`，而 `customer/initListV2` 里「全部」节点的 `extra` 是 `3456`。
> 两者口径不同（后者可能含已删除/跨院客户），**对外汇报请统一用 `getCustomerNumber`**。
>
> **不可用**：`GET /api/v1/user/dataRange` → `20004 您不是最新版本，请更新你的系统(缺少必要请求参数)`（需额外参数，本会话未确认）。

### 4.2 ❌ 前端存在但网关未放行（本租户）

| 接口 | 状态 | 说明 |
|---|---|---|
| `POST /api/v1/customer/customerCube` | 路由不存在 | **客户数据集（cube）查询主接口**，前端 `getResultData` 调用，74 个数据集的实际数据入口 |
| `POST /api/v1/customer/customerCube/userCount` | 路由不存在 | 数据集计数 |
| `POST /api/v1/customer/customerCube/export` | 路由不存在 | 数据集导出 |
| `POST /api/v2/customer/cube/export` | 未测 | V2 导出 |
| `GET /api/v1/customer/customer?customerId=` | 参数不足 | 返回 `20002 Source must not be null`，需附加 `source` 参数 |

> **结论**：cube 数据集（如"今日未成交客户""30 天未回访"）的**定义**可读取（接口 20），但**执行查询**需厂商开通该路由。替代方案：用 `/api/v2/reception/receptionList`、`/api/v2/bespeak/bespeakList`、`/api/v1/customer/getCustomerByPhone` 组合实现同类业务查询。

### 4.3 模块总览（429 个业务模块，Top 30）

| 模块 | 端点数 | 模块 | 端点数 |
|---|---:|---|---:|
| 报表统计 (`/report/v1/*`, `/v1/report/*`) | 330 | 员工与账号 | 32 |
| 客户主数据 (`/v1/customer/*`, `/v2/customer/*`) | 145 | 渠道与来源 | 32 |
| SCRM/私域 (`/v1/scrm/*`) | 99 | 物料 | 32 |
| 咨询详情 (`/v1/consultationInfo/*`) | 82 | 处方 | 32 |
| 收费/结算 (`/v1/billing/*`, `/v2/billing/*`) | 66 | 客户流转 (`flowbrandinfo`) | 31 |
| 回访/随访计划 (`/v1/visitPlan/*`) | 51 | 推荐成交 | 31 |
| 病历 (`/v1/medicalRecord/*`) | 45 | 治疗记录 | 30 |
| 工作授权 (`/v1/workPermit/*`) | 42 | 有赞美业 | 29 |
| 企业微信 (`/v1/qyWechat/*`) | 40 | 收费 | 28 |
| 预约 (`/v2/bespeak/*`, `/v2/appoint/*`) | 39 | 照片/影像 | 27 |
| 消费线索 (`/v1/consumptionclue/*`) | 39 | 微盟 | 27 |
| 接诊准备 (`/v1/preparation/*`) | 39 | 线上视频面诊 | 26 |
| 会员/权益 (`/v1/member/*`) | 38 | 有赞 | 25 |
| 支付 (`/v1/payment/*`) | 36 | 会员卡 | 24 |
| 来源素材 (`source-material`) | 36 | 治疗排期 | 24 |
| 集团/连锁 (`/v1/group/*`) | 34 | 商城 | 23 |
| 项目/商品 (`/v1/project/*`) | 34 | 我的驾驶舱 | 23 |
| 接诊 (`/v2/reception/*`) | 37 | 审批流 | 22 |

> 完整 4229 条清单（含每条的方法、来源、验证状态）见 **`api-endpoints.json`**：
> - `kind=core-api` 3786 条 → `/api/v1|v2/*`
> - `kind=report-api` 184 条 → `/report/v1/*`
> - `kind=spa-route` 256 条 → 前端页面路由（可用于反查"某页面调了哪些接口"）
> - `kind=middle-platform-api` 2 条 → 中台

### 4.4 重点业务域端点示例

**客户域（145 + 99 SCRM）**

```
/v1/customer/getCustomerByPhone          客户搜索（手机号）
/v1/customer/detail                      客户完整档案
/v1/customer/customer                    客户详情（需 source 参数）
/v1/customer/initList / initListV2        列表页配置
/v1/customer/oldNew                      新老客统计
/v1/customer/selectionByChannelId         按渠道筛客
/v1/customer/applicantList               申请人列表
/v1/customer/changeRecordsList           变更记录
/v1/customer/getUserByPoolConfig          池规则关联员工
/v1/customerPool/customerPools           公海池统计
/v1/customerPool/...                     池配置/分配/回收
/v1/customerOverView/consumeStatistical   消费统计
/v1/customerOverView/getRfmScore          RFM 评分
/v1/customerOverView/cusRelations         关系图谱
/v1/customerOverView/arriveDetail         到店明细
/v1/scrm/customer/scrmCustomerList        SCRM 客户列表
/v1/scrm/sharedAcrossHospitals/*          跨院共享审批
/v1/tags/getAllTags /v1/smartLabel/*      标签体系
```

**预约 / 接诊（39 + 37）**

```
/v2/bespeak/bespeakList / bespeakListInit        预约列表/初始化
/v2/bespeak/changeDateRecordList                 改期记录
/v2/appoint/customer-pool-notification/*         预约通知配置
/v2/reception/receptionList                      接诊列表
/v1/reception/receptionListInit                  接诊初始化
/v2/reception/getTriageToUserList                分诊人员
/v2/reception/approvalCrossReception             跨院接诊审批
/v1/preparation/*  (39)                          接诊准备（计划/内容/病史）
```

**回访 / 随访（51）**

```
/v1/visitPlan/init / planList / planDetail       计划
/v1/visitPlan/planContentList / contentDetail    计划内容
/v1/visitPlan/executeBatchVisit                  批量执行
/v1/visitPlan/visitedRecords                     已访记录
/v1/visitPlan/exportPlan / exportRecord          导出
/v1/visit/allType / getProjectsOrPackages        项目类型/套餐
```

**收费 / 支付 / 会员（66 + 36 + 38）**

```
/v1/billing/*  /v2/billing/*                     收费单、结算、退款
/v1/payment/*                                    支付流水
/v1/billing/getValidCardWithCustomerList         客户有效卡
/v1/hc-member-card/*                             会员卡
/v1/member/*                                     会员权益、等级
/v1/couponExpireNoticeConfig/*                   优惠券到期提醒
```

**报表（330）**

```
/report/v1/salesPerformanceDetail/report                 销售业绩明细
/report/v1/executivePerformanceDetailOptimal/report/list  经营业绩
/report/v1/wym/teamStatistics/*                          团队统计（含流失分析）
/report/v1/wym/marketingStatistics/*                     营销统计
/report/v1/channel/*                                     渠道业绩/导出
/report/v1/payment/*                                     收银/存款账龄
/v1/report/paymentFlow/*                                 支付流水报表
```

**系统 / 配置**

```
/v1/user/*            员工账号（userAll/userAllEnable/getAllDoctors/dataRange/exclusive-servers）
/v1/dept/tree         科室树
/v1/role/tree         角色树
/v1/author/*          权限配置（setAuthority/fieldInfo/userList/opLogPage）
/v1/menu/*            菜单
/v1/dict              数据字典（codes=xxx 批量取）
/v1/gconfig/*         全局配置（定金/权益卡跨院设置等）
/v1/sysTemplate/*     系统模板
/v1/loginPasswordRuleConfiguration/*  登录密码策略
/v1/aws/tempUploadUrl 文件上传（OSS 临时地址）
/v2/ws                WebSocket 通道
```

---

## 5. 实测响应结构（Schema 附录）

> **采集方式**：2026-09-10 使用真实租户 Token 实时调用捕获，33 个接口 / 32 个成功。
> 完整机器可读版本见 `api-schemas.json`（数组字段仅保留前 2 个元素作为样例）；PII 已脱敏（`<MASKED>` / `<ID>` / `<EMAIL>` / 手机号前3后4）。

### 5.0 ⚠️ 头号实现坑：字段值是「字符串化的 null / JSON」

后端把**大量空值和空数组序列化成了字符串**，而不是 JSON 的 `null` / `[]`：

| 实际返回 | 真实含义 | Agent 正确处理 |
|---|---|---|
| `"age": "null"` | 空 | `v === "null" ? null : v` |
| `"departmentConsumeList": "[]"` | 空数组 | `v === "[]" ? [] : JSON.parse(v)` |
| `"children": "[]"` | 空子树 | 同上 |
| `"depositAmount": "null"` | 空金额 | 按 `0` 处理 |
| `"type": "null"` / `"value": "null"` | 空枚举 | 判空 |
| `"links": "[]"` | 空关系边 | 同上 |

**后果**：`if (list.length)` 对字符串 `"[]"` 恒为真；`Number("null")` = `NaN`；`arr.map()` 会直接抛错。
**建议**：在 Bridge 层统一规范化一次 ——

```js
const norm = v => v === 'null' ? null : v === '[]' ? [] : (typeof v === 'string' && /^[\[{]/.test(v) ? tryParse(v) : v);
```

⚠️ **不能一刀切**：同一响应里既有 `"balance": 0`（真数字）也有 `"depositAmount": "null"`（字符串）；`jobStatus` 在 `userAll` 里是 `1`、在 `userAllEnable` 里是 `false`。必须逐字段处理。

### 5.1 客户搜索 `GET /api/v1/customer/getCustomerByPhone?phone={手机号}`

```json
{ "code": 10001, "msg": "成功获取数据，数据非空", "data": [{
  "customerId": "<ID>",                    // 19 位雪花 ID，字符串
  "customerName": "<MASKED>",
  "mainPhoneNumber": "137****9799",
  "phoneNumber": ["137****9799"],          // 纯字符串数组
  "vipNum": "003217",
  "gender": 1,                             // 1=男 2=女
  "age": "null",                           // ← 字符串化 null
  "birthday": "null",
  "customerType": "空", "cusType": "-1", "type": "-1",
  "customerSource": "市场渠道/公司/公司业绩",
  "sourcePathName": "<来源全路径>",
  "createTenant": "贵州北科生物",           // 所属机构
  "tenantId": "1",
  "documentId": "<ID>",                    // 客户档案号
  "latestArriveDate": "null", "latestArriveSort": "<32位排序键>",
  "latestTreatDoctorName": "null", "firstTreatDoctorName": "null",
  "consultantName": "null", "sysUserName": "null",
  "customerWx": "null", "activeStatus": "null",
  "range": 1, "isShared": true, "selfTenantFlag": true, "filedType": 0
}]}
```

> 实测：`phone` 支持**模糊匹配**（传 `1371` 也能命中），一次可能返回多位客户 → 让 Agent 用姓名/VIP 号做二次确认。

### 5.2 客户完整档案 `GET /api/v1/customer/detail?customerId={id}`

**顶层**：`selfTenantFlag, tenantName, fixFlag, circleAccount, subBtn, fixBtn, detail, isShared, fixStatusName`
**`detail` 下**：`base, customerId, customerName, isShared, locate, mainPhone, other, related, selfTenantFlag, value, version`

**`detail.base`（41 个字段，完整清单）**

```
address, age, area, birthday, brushingHabitList, brushingHabits, brushingMinutesPerTime,
brushingTimesPerDay, career, country, customerDocNumber, dataWarehouseID, email,
fertilityFlag, guardianIdCard, guardianName, guardianPhone, idCardNumber, income,
latestArriveDate, mainCustomerId, marriedFlag, name, nickName, passportNum, passportType,
perResidence, phoneNumber[], relationCode, relationCodeName, sex, smokingFlag,
smokingTimesPerDay, sureType, tenant{}, urgentContactCall, urgentContactName,
urgentContactRelation, weiXin, wxName, wxPhotoUrl
```

**`base.phoneNumber` 是对象数组（带号码归属地解析，很实用）**

```json
"phoneNumber": [
  { "phoneNumber": "137****9799", "city": "深圳", "prov": "广东", "isp": "中国移动", "ismain": true }
]
```

**`base.tenant`（机构对象）**：`label` = 机构名（"贵州北科生物"）、`value` = tenantId、`allTopPath`、`sourcePathName`、`typeId` 等 30 项

**`detail.other`（健康/画像，16 项）**

```
allergyFlag, allergyLabels, allergyRemark, bedNo, channelType, confirmFlag, diagnosis,
personalityLabels, plasticFlag, plasticRemark, propensity, propensityFriend,
rebatesLimitMonths, sickHistory, valueLabels, workState
```

**`detail.related`（归属/关系，约 50 项，节选）**

```json
{
  "poolId": "dddddddddddddddddddddddddddddddd", "poolName": "<公海池名>",
  "customerPoolType": 2,
  "consultant": "", "crossConsultant": "", "crossFlag": false,
  "firstTreatDoctorId": "", "firstTreatDoctorName": "", "doctorNameLastest": "",
  "exclusiveServerId": "", "exclusiveServerName": "",
  "documentId": "<ID>", "medicalRecordNo": "[]", "createBy": "超级管理员",
  "currentTransInDate": 1782400530000,          // 转入时间（毫秒时间戳）
  "latestVisitedDate": "null", "preDate": "null", "preEndDate": "null",
  "sourcePathName": "<来源>", "sourcePathNameSecond": "", "sourcePathNameThird": "",
  "relatedConsultants": "[]", "relatedDoctors": "[]", "relatedServices": "[]", "relatedOthers": "[]",
  "associatedDoctors": "[]", "allowDonationCustomerList": "[]",
  "shareholderAssistant": "", "directorRuiXiu": "", "remark": "<备注>",
  "customerRoleManageInfoList": "[]", "expandInfo": "[]"
}
```

> 实测 `detail` 总体积 7141 字节。**注意**：`customerName`、`mainPhone` 在 `detail` 层常为空字符串，真实姓名在 `base.name`、电话在 `base.phoneNumber`。

### 5.3 消费统计 `GET /api/v1/customerOverView/consumeStatistical?customerId={id}`

```json
{ "code": 10001, "data": {
  "balance": 0,                     // 账户余额（元，数字）
  "givenBalance": 0,                // 赠送余额
  "totalCostAmount": 0,             // 累计消费
  "depositAmount": "null",          // 寄存金额 ← 字符串化 null
  "topProjectPrice": 0,             // 最高单项目金额
  "departmentConsumeList": "[]",    // 科室消费明细 ← 字符串化数组
  "noDeductProjectCount": {
    "noTreatmentTotalCount": 0, "noTreatmentTotalPoint": 0,
    "treatmentTotalCount": 0, "treatmentTotalPoint": "null",
    "count": "[]"
  }
}}
```

### 5.4 RFM 评分 `GET /api/v1/customerOverView/getRfmScore?customerId={id}&isGroup=false`

```json
{ "code": 10001, "data": {
  "name": "用户评分", "score": "0.00", "typeName": "null",
  "indicator": [
    { "text": "距今未消费天数", "value": "未到院", "max": 1.5 },
    { "text": "最近一年消费次数", "value": "0次",    "max": 1.5 },
    { "text": "最近一年消费总额", "value": "￥0",   "max": 2 }
  ],
  "value": [0, 0, 0]                 // [R, F, M] 三维得分
}}
```
> `api-schemas.json` 中数组只保留前 2 个元素，此处为完整观测（3 个指标）。

### 5.5 客户关系图谱 `GET /api/v1/customerOverView/cusRelations?id={id}`

```json
{ "code": 10001, "data": {
  "links": "[]",                                     // ← 字符串化数组
  "categories": [{ "name": "第0层级" }],
  "data": [{ "name": "<客户名>", "id": "<ID>", "customerId": "<ID>",
             "category": 0, "value": 0, "symbolSize": 12, "draggable": "true" }],
  "statistics": { "num": 0, "costFriendNum": 0, "money": 0 }   // 好友数 / 消费好友数 / 转介绍金额
}}
```

### 5.6 公海池 `GET /api/v1/customerPool/customerPools`

```json
{ "code": 10001, "data": {
  "personalPoolCount": 2321,
  "nonPersonalPoolCount": 1135,
  "customerPoolVoList": [{
    "id": "<ID>", "name": "默认非个人池", "currentCount": 1111,
    "type": 2, "typeName": "", "specialType": "defaultNonePersonal",
    "nonPersonalDefaultFlag": true,
    "activePeriod": 0, "activePeriodRemind": 7,      // 回收周期(天) / 提醒(天)
    "autoPerformanceFlag": false, "existRuleFlag": false, "ruleCount": 0,
    "disabledFlag": false, "delFlag": false, "tenantId": "1", "groupInfoId": "",
    "createBy": "11", "createDate": 1548245000000, "updateBy": "1", "updateDate": 1548245000000
  }]
}}
```

**实测池明细（6 个池，2026-09-10）**

| 池名称 | 客户数 | specialType | type | 说明 |
|---|---:|---|---:|---|
| 客服部新客池 | 2321 | `defaultPersonal` | — | 个人池（默认） |
| 默认非个人池 | 1111 | `defaultNonePersonal` | 2 | 非个人池（默认） |
| 报备池 | 14 | `preparation` | — | 报备客户 |
| 中康奇经诊所 | 10 | `common` | — | 自定义池 |
| 黑名单客户池 | 0 | `black_list_pool` | — | 黑名单（两条同名，不同 ID） |

> `specialType` 取值：`defaultPersonal` / `defaultNonePersonal` / `preparation` / `black_list_pool` / `common`

### 5.7 员工列表 `GET /api/v1/user/userAll` 与 `userAllEnable`

**⚠️ 两个接口字段语义不同，不能混用！**

```json
// GET /api/v1/user/userAll  → 52 条（实测字段 13 个）
[{ "id": "<ID>", "userNo": "<数字>", "name": "<姓名>", "phone": "<手机号>",
   "position": "<职位>", "depart": "<科室>", "label": "<标签>",
   "jobStatus": 1, "status": 1, "isDisabled": false, "greyFlag": false,
   "perm": "<权限标识>", "value": "<显示值>" }]

// GET /api/v1/user/userAllEnable  → 49 条（字段完全不同！）
[{ "value": "<用户ID>", "userNo": "<姓名！>", "label": "<姓名>", "depart": ["总经办"],
   "position": "[]", "jobStatus": false, "status": false, "perm": false,
   "disabled": false, "greyFlag": false,
   "loginApp": false, "loginPc": false,
   "appWhiteList": "[]", "appWhiteListJson": "", "pcWhiteList": "[]", "pcWhiteListJson": "" }]
```

> - `userAll`：`name`/`phone` 是真人信息，`userNo` 是数字工号
> - `userAllEnable`：`label` 才是姓名、`userNo` 竟然是姓名、`value` 是用户 ID；`depart` 是数组、`jobStatus` 是布尔
> - 选医生用 `GET /api/v1/user/getAllDoctors` → `[{ value: "<医生ID>", label: "<姓名>" }]`（实测 11 条，最省事）

### 5.8 分页列表（IPage）`POST /api/v2/reception/receptionList`、`/api/v2/bespeak/bespeakList`

```json
// 请求：{"page":1,"limit":3}
{ "code": 10002, "msg": "操作成功,数据为空",
  "data": { "records": [], "total": 0, "size": 0, "current": 0, "pages": 0,
            "orders": [], "optimizeCountSql": true, "searchCount": true,
            "maxLimit": null, "countId": "" } }
```

> 参数必须是 `page` + `limit`；传 `current`/`size` 会得到 `20002 系统开小差了，请重试！`。
> 无筛选条件时 `records` 为空但 `total` 可能非 0（实测接诊曾返回 `total:6`），**不要只看 `records`**。

### 5.9 客户数据集（cube）`GET /api/v2/customer/cube/template/get-user-all-cube-config`

**单条结构（真实字段名）**

```json
{ "id": "372fa296a03411efba960242ac110005",
  "systemConfigEnum": "TODAY_NOT_DEAL",
  "title": "今日未成交客户",          // ← 显示名在 title，不在 name
  "type": "system", "permType": "common", "remark": "系统默认",
  "contentList": "[]", "jsonObject": "", "conditionLabel": "", "conditionLabelName": "",
  "showFlag": false, "orderNum": "null", "orderNumber": "null",
  "createBy": "", "createById": "", "userId": "", "delFlag": false }
```

> 接口返回 74 条，但**去重后只有 25 个不同数据集**（同一数据集按模块/权限重复注册）。

**25 个预置数据集完整清单**（`systemConfigEnum` → 中文名）

| systemConfigEnum | 名称 | 分类 |
|---|---|---|
| `TODAY_NOT_DEAL` | 今日未成交客户 | 成交 |
| `DAY_7_NOT_ARRIVAL_AND_DEAL` | 最近7日到院未成交客户 | 成交 |
| `DAY_30_NOT_ARRIVAL_AND_DEAL` | 最近30日到院未成交客户 | 成交 |
| `DAY_90_NOT_ARRIVAL_AND_DEAL` | 最近90日到院未成交客户 | 成交 |
| `TODAY_ARRIVAL_NOT_VISIT_PLAN` | 今日到院无回访计划客户 | 回访 |
| `DAY_3_ARRIVAL_NOT_VISIT_PLAN` | 最近3日到院无回访计划客户 | 回访 |
| `DAY_7_ARRIVAL_NOT_VISIT_PLAN` | 最近7日到院无回访计划客户 | 回访 |
| `DAY_30_NOT_VISITED` | 最近30天未回访客户 | 回访 |
| `HALF_YEAR_NOT_VISITED` | 最近半年未回访客户 | 回访 |
| `ONE_YEAR_NOT_VISITED` | 最近一年未回访客户 | 回访 |
| `HALF_YEAR_NOT_ARRIVAL` | 最近半年未到院客户 | 到院 |
| `ONE_YEAR_NOT_ARRIVAL` | 最近一年未到院客户 | 到院 |
| `COST_LESS_1000` | 消费金额小于1千的客户 | 消费分层 |
| `COST_1000_TO_10000` | 消费金额1千到1万的客户 | 消费分层 |
| `COST_10000_TO_50000` | 消费金额1万到5万的客户 | 消费分层 |
| `COST_GREATER_50000` | 消费金额大于5万的客户 | 消费分层 |
| `ARREARAGE` | 欠费的客户 | 财务 |
| `HAD_DEPOSIT` | 有抵扣金客户 | 财务 |
| `TREAT_NOT_FINISH` | 治疗未完成客户 | 治疗 |
| `OLD_NEW_CUSTOMER` | 老带新客户 | 转介绍 |
| `OLD_NEW_GREATER_2_CUSTOMER` | 老带新2位以上客户 | 转介绍 |
| `OLD_NEW_GREATER_5_CUSTOMER` | 老带新5位以上客户 | 转介绍 |
| `BIND_SCRM_CUSTOMER` | 已绑定小程序客户 | 私域 |
| `NOT_BIND_SCRM_CUSTOMER` | 未绑定小程序客户 | 私域 |
| `DAY_7_BIRTHDAY_CUSTOMER` | 最近七天过生日客户 | 关怀 |

> ⚠️ 数据集**定义**可读，但**执行查询**的 `/v1/customer/customerCube` 在本租户网关未放行（见 §4.2）。
> 这 25 条可当作**业务规则参考库**：让 Agent 理解机构关注哪些客户群体，再用其他接口自行实现等价筛选。

### 5.10 客户列表页配置 `GET /api/v1/customer/initListV2`（**意外好用**）

它不只是 tab 配置，而是**带客户数量的三层树**（池 → 用户 → 计数）：

```json
[{ "title": "全部", "value": "null", "type": "null", "extra": 3456, "order": 0, "share": false },
 { "title": "个人池", "typeChildren": { "池维度": [
     { "title": "客服部新客池", "value": "cccccccccccccccccccccccccccccccc", "extra": 2321,
       "children": [
         { "title": "丁云",   "value": "<用户ID>", "extra": 12, "order": 30 },
         { "title": "梁映华", "value": "<用户ID>", "extra": 29, "order": 31 }
       ] } ] } }]
```

> `extra` = **该节点下的客户数量**。这是**不依赖 cube 接口就能拿到"每个池/每个人有多少客户"** 的最佳数据源，
> 非常适合做 Agent 的客户分布分析（示例值：全部 3456、客服部新客池 2321）。

### 5.11 其他实测结构

```json
// GET /api/v1/channel/getCustomerNumber → 客户总数
{ "code": 10000, "msg": "操作成功", "data": 3456 }        // 注意：code 是 10000（也是成功）

// GET /api/v1/channel/getAllChannel?flag=true → 13 条渠道
[{ "label": "公司业绩", "value": "15fc972467b64464a5c2cf611809aLJ", "type": "公司",
   "contact": "null", "phoneList": "null" },
 { "label": "高学彬团队", "value": "272ab86f571f44fba2e83fbc3f14bLJ", "type": "代理来源" }]

// GET /api/v1/msg/todayTotal
{ "code": 10001, "data": { "msgNum": 12, "tskNum": 0, "sumNum": 0 } }

// GET /api/v1/customer/getCustomerPhoneNumbers?customerId={id}
{ "code": 10001, "data": ["137****9799"] }                 // 纯字符串数组

// GET /api/v1/dict?codes=channelLevel
{ "code": 10001, "data": { "channelLevel": [
    { "id": "d109b3db8f716c0f402426e653f490ea", "label": "1", "value": "1",
      "ext": "", "tenantId": "1", "tenantName": "贵州北科生物", "dataScope": "null" } ] } }
// 多字典批量：codes=a,b,c → data 下按 code 分组

// GET /api/v1/role/tree/ → [{ "label": "子管理员", "value": "<角色ID>" }, ...]（实测 16 条）

// GET /api/v1/menu/allCollect → 收藏菜单（含前端路由映射，可用于反查页面）
[{ "menuId": "productDynamics", "menuName": "<菜单名>", "menuUrl": "/portal/productDynamics",
   "permissionKey": "productDynamics", "parentId": "148", "num": -1, "sysMenuId": "<ID>",
   "createDate": 1779097111000, "tenantId": "1", "userId": "<ID>" }]

// GET /api/v1/dept/tree → 科室/部门树（3KB，含父子关系）
[{ "title": "贵州北科生物", "value": "<部门ID>", "pid": "0", "pids": "[0],", "key": "0-0",
   "children": [{ "title": "总经办", "value": "<部门ID>", "pid": "<父ID>",
                  "pids": "[0],[481045951302074374],", "key": "0-0-0", "children": "[]" }] }]
// 注意：叶子节点的 children 是字符串 "[]"，不是空数组

// GET /api/v1/customerOverView/recentAppointment → 无预约时返回字符串
{ "code": 10001, "data": "null" }
```

---

## 6. Agent 二次开发指南

### 6.1 推荐架构

```
┌──────────────┐   工具调用(JSON)   ┌────────────────────────┐   HTTPS    ┌──────────────┐
│  AI Agent    │ ─────────────────► │  Bridge 服务（自建）   │ ─────────► │ 睿美云 API   │
│ (Claude/MCP) │ ◄───────────────── │  Node/Python, 内网部署 │ ◄───────── │  {hk}.hospital│
└──────────────┘   脱敏后的结果     │  · 登录/续期/token缓存 │            └──────────────┘
                                    │  · POST 代理(CORS绕过) │
                                    │  · 限流/重试/审计日志  │
                                    │  · PII 脱敏/字段裁剪   │
                                    └────────────────────────┘
```

**为什么必须有 Bridge 层**
1. **CORS**：浏览器只能发 GET，写操作必须服务端转发
2. **凭据安全**：token/密码绝不进浏览器或模型上下文
3. **合规**：统一脱敏、审计、最小字段返回
4. **稳定性**：统一限流、重试、缓存（如客户总数缓存 5 分钟）

### 6.2 建议的 Agent 工具清单

见 **`agent-tools.json`**。核心 12 个：

| 工具名 | 用途 | 后端接口 |
|---|---|---|
| `search_customer` | 按手机号/姓名搜客户 | `GET /v1/customer/getCustomerByPhone` |
| `get_customer_profile` | 客户档案 | `GET /v1/customer/detail` |
| `get_customer_consumption` | 消费/余额 | `GET /v1/customerOverView/consumeStatistical` |
| `get_customer_rfm` | 客户价值评分 | `GET /v1/customerOverView/getRfmScore` |
| `get_customer_relations` | 转介绍关系 | `GET /v1/customerOverView/cusRelations` |
| `get_customer_overview_stats` | 客户总量/池分布 | `/v1/channel/getCustomerNumber` + `/v1/customerPool/customerPools` |
| `get_customer_distribution` | **客户分布树（池→人→数量）** | `GET /v1/customer/initListV2` |
| `list_customer_pools` | 公海池明细 | `GET /v1/customerPool/customerPools` |
| `list_receptions` | 接诊记录 | `POST /v2/reception/receptionList` |
| `list_appointments` | 预约记录 | `POST /v2/bespeak/bespeakList` |
| `list_staff` / `list_doctors` | 员工/医生 | `/v1/user/userAll` / `/v1/user/getAllDoctors` |
| `list_departments` | 科室树 | `GET /v1/dept/tree` |
| `get_today_summary` | 今日待办/消息 | `GET /v1/msg/todayTotal` |

**工具设计要点**
- 入参用**业务语义**（手机号、日期范围），不要暴露雪花 ID 给模型猜
- 出参**默认脱敏**（姓名首字+*、手机号中间四位掩码），需完整 PII 时要求显式参数 + 审计
- 每个工具声明**权限要求**（如 `customer:read`），Bridge 侧校验 `permList`
- 返回**结构化摘要 + 原始 JSON 指针**，避免把大对象塞进模型上下文

### 6.3 调用示例（Bridge 侧 Node.js）

```js
const BASE = 'https://bksw.hospital.realmerit.com.cn/api';
let token = null, tokenExp = 0;

async function api(path, { method = 'GET', body, query } = {}) {
  if (!token || Date.now() > tokenExp) await relogin();
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) v != null && url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': token,            // 裸 JWT，无 Bearer
      'tenant': '1', 'lang': 'zh-CN',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-No-Wrap': 'true'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await res.json();

  if (res.status === 401 || j.code === 401 && /过期|登陆|登录/.test(j.msg || '')) {
    await relogin();                     // 只重试一次
    return api(path, { method, body, query });
  }
  if (![10000, 10001, 10002].includes(j.code)) throw new Error(`[${j.code}] ${j.msg}`);
  return j.data;                         // 10002 = 空集，返回 null/[] 语义
}

// 示例：客户 360 聚合
async function customer360(phone) {
  const [c] = await api('/v1/customer/getCustomerByPhone', { query: { phone } }) || [];
  if (!c) return null;
  const id = c.customerId;
  const [profile, consume, rfm, rel] = await Promise.all([
    api('/v1/customer/detail',                { query: { customerId: id } }),
    api('/v1/customerOverView/consumeStatistical', { query: { customerId: id } }),
    api('/v1/customerOverView/getRfmScore',   { query: { customerId: id, isGroup: false } }),
    api('/v1/customerOverView/cusRelations',  { query: { id } })
  ]);
  return { basic: c, profile, consume, rfm, relations: rel };
}
```

### 6.4 凭据与 Token 管理

| 项 | 建议 |
|---|---|
| 账号 | 为 Agent 建**专用服务账号**，仅授予「客户查询 + 报表只读」权限 |
| 密码存储 | 环境变量 / KMS / 密钥库，**不入代码库、不入模型上下文** |
| Token 缓存 | 内存缓存 + 到期前 12h 续期；`GET /v1/refreshLogin` 优先，失败再全量登录 |
| 并发登录 | 同一账号多处登录可能互相踢下线 → 避免与人工账号共用 |
| 日志 | 记录调用时间/接口/操作人/结果码，**不记录 token 与完整 PII** |

### 6.5 稳定性与限流

- 建议 **≤ 5 req/s**，单次批量任务间隔 ≥ 200ms；报表/导出类接口并发 ≤ 2
- 超时：普通查询 15s，报表/导出 60s（前端对大数据量有 timeout 兜底）
- 重试：仅对网络错误与 HTTP 5xx 重试（最多 2 次，指数退避）；**写操作不自动重试**（无幂等键）
- 缓存建议：字典/科室/员工 24h；客户总数/池统计 5min；客户档案 60s
- 分页：`size` ≤ 100，深分页用时间范围过滤而非 `page` 递增

### 6.6 不能做的事 / 未开放能力

| 项 | 状态 |
|---|---|
| 官方开放平台 / API 文档 | ❌ 无（本文档来自逆向 + 实测） |
| 客户数据集(cube) 查询 | ❌ 本租户路由未放行（需厂商开通） |
| 写操作（新增客户/预约） | ⚠️ 接口存在但**未经实测**，且无幂等保护，生产慎用 |
| 数据导出 | ⚠️ `export` 类接口存在，返回文件流；需遵守数据出域合规 |
| 消息推送订阅 | ⚠️ `wss://{hk}.hospital.realmerit.com.cn` + `/api/v2/ws`，需实测握手鉴权 |
| 批量数据同步（全量客户） | ❌ 无公开全量导出接口；`getCustomerByPhone` 是**按条件查询**，不支持无条件全表分页 |

---

## 7. 已知限制与风险

1. **无版本兼容承诺**：接口来自客户端 `4.128.8` 静态提取，厂商升级（如 4.128.x → 5.x）可能变更路径或字段；建议 Bridge 层做**契约测试**（每次升级跑一遍 §4.1 的 32 个接口）
2. **路径名可能含拼写错误**：如 `getCustomerNumByCounselor`、`cluetag`（应为 cluetag/clueTag）——按原样调用，不要"纠正"
3. **两套分页风格混用**（`current/size` vs `page/limit`）——按接口逐一确认
4. **`401` 语义重叠**（未登录 / 路由不存在）——排障时先验证 token 再怀疑路径
5. **响应可能被 WASM 包装**：需 `X-No-Wrap: true` 或按前端解密逻辑处理
6. **字段类型不稳定**：布尔 `1/0` 与 `true/false`、ID 为字符串、金额可为 null
7. **权限裁剪静默**：无权限时常返回空数组而非 403，Agent 需避免把"无权限"误判为"无数据"
8. **token 有效期短**（~3.4 天）且服务端可能主动失效（改密/踢下线）

---

## 8. 合规与安全要求（**必读**）

本系统处理**医疗健康数据 + 个人敏感信息**（姓名、手机号、住址、就诊记录、消费记录），受《个人信息保护法》《数据安全法》《医疗机构管理条例》及行业规范约束：

1. **授权前提**：仅限医院/机构自身数据，须获得机构书面授权；不得用于向第三方提供或商业化
2. **最小必要**：只取业务必需的字段；能脱敏就脱敏（姓名/电话/证件/住址）
3. **访问控制**：Bridge 服务部署在**内网**，鉴权后再暴露给 Agent；不对外网开放
4. **不得落库**：Agent 侧建议**不持久化 PII**；确需缓存时加密存储 + 设置 TTL + 可删除
5. **审计留痕**：所有 PII 访问记录操作人、时间、目的、结果
6. **禁止外传**：不得将客户数据发送至境外或未经授权的第三方模型/服务；使用云端 LLM 时须做脱敏或本地化部署
7. **厂商合规路径**：正式商用集成应向厂商（realmerit.com.cn）申请开放平台/授权接入，避免逆向接口带来的合规与稳定性风险

---

## 9. 附录

### 9.1 分析产物文件清单

| 文件 | 内容 |
|---|---|
| `睿美云-SaaS-二次开发技术文档.md` | **本文档** |
| `api-endpoints.json` | 4229 条接口/路由全量清单（分类、模块、方法、验证状态、来源） |
| `接口全量清单.md` | 3973 个 API 端点按 429 个模块分组的可读版 |
| `agent-tools.json` | Agent 工具清单（18 个工具：业务意图 → 接口映射 + 安全约束） |
| `api-schemas.json` | 33 个接口的实测响应结构（字段级，PII 已脱敏） |
| `reference-data.json` | 参考数据：25 个数据集定义 / 6 个公海池 / 字典 / 科室树 |
| `睿美云-API分析报告.md` | 首轮完整分析报告（架构/安全评估/域名地图） |
| `all-cache-urls.txt` | 客户端真实 HTTP 流量提取的 267 个 URL（含真实参数形态） |
| `dashboard/index.html` | 可运行的数据看板（KPI/公海池/客户搜索/360视图） |
| `dashboard/server.js` | 本地代理服务（127.0.0.1:8899，解决 CORS） |
| `dashboard/login.js` | 本地登录换 token 工具（RSA 加密，密码不回显） |
| `浏览器提取token.js` | 浏览器控制台脚本：从已登录网页版提取 Token |
| `harvest-schemas.js` | 结构采样脚本（换新 token 重新生成 schema） |
| `dump-reference.js` | 参考数据导出脚本（数据集/公海池/字典/科室） |
| `extract-all-endpoints.js` + `refine-endpoints.js` | 全量接口提取脚本（可对新版本客户端重跑） |
| `chunks/` | 73 个前端懒加载 chunk（接口定义来源） |

### 9.2 复现与更新方法

```bash
# 1) 换新 token 后重新采样接口结构（token 有效期约 3.5 天）
node harvest-schemas.js "<JWT>" "<手机号或customerId>"   # 传手机号会自动发现 customerId

# 2) 导出参考数据（数据集定义/公海池/字典/科室树）
node dump-reference.js "<JWT>"

# 3) 客户端升级后重新提取接口清单
#    先下载新版本 bundle 到 ./chunks/，再执行：
node extract-all-endpoints.js && node refine-endpoints.js && node gen-catalog-md.js

# 4) 本地起看板 + 代理
node dashboard/server.js          # → http://localhost:8899
```

### 9.3 快速自检清单（交付 Claude 后建议先跑）

```text
[ ] 用服务账号登录拿到 token（§2.1）
[ ] 调 /v1/channel/getCustomerNumber 确认租户正确（客户总数非 0）
[ ] 调 /v1/afterLoginLoadData 拉取权限清单，确认 Agent 账号权限足够
[ ] 用真实手机号调 /v1/customer/getCustomerByPhone 验证客户搜索
[ ] 用返回的 customerId 跑一遍 360 聚合（§6.3 示例）
[ ] 调 /v2/reception/receptionList 与 /v2/bespeak/bespeakList 验证分页参数
[ ] 确认 POST 全部走 Bridge 服务（不要从浏览器直发）
[ ] 确认日志中无 token、无完整 PII
```

---

## 10. 业务域全景地图（3973 个接口 → 20 个业务域）

> 3973 个 API 端点按 429 个模块聚类为 **20 个业务域**，完整版见 `domains/业务域地图.md`（每个域含模块清单与入口接口）。
> 「实测可用」= 无需业务参数即可调用（仅作连通性验证；绝大多数接口带参数后同样可用）。

| 业务域 | 模块数 | 端点数 | 实测可用 | 主要职责 |
|---|---:|---:|---:|---|
| 治疗与病历 | 61 | 486 | 30 | 治疗记录/排期、病历、处方、影像、正畸、手术、电子签 |
| 报表与数据分析 | 9 | 396 | 5 | 报表引擎（§9）、驾驶舱、目标考核、数据字典 |
| 客户主数据与生命周期 | 41 | 383 | 14 | 建档、公海池、流转、标签、RFM、360 视图、合并 |
| 咨询与接诊 | 21 | 304 | 9 | 咨询单、接诊准备、分诊、面诊、消费线索 |
| 会员/资产/卡券 | 38 | 273 | 9 | 会员卡/权益卡/储值/余额/积分/返利/套餐 |
| 收费/支付/结算 | 27 | 260 | 4 | 收费单、支付流水、聚合支付、发票、退款 |
| 进销存/供应链 | 30 | 253 | 15 | 仓库、采购、出入库、盘点、领料、供应商、加工件 |
| 组织/员工/权限 | 30 | 240 | 21 | 员工、科室、角色权限、集团连锁、排班班次 |
| 第三方平台集成 | 13 | 218 | 12 | 美团/有赞/微盟/企微/呼叫中心/tpos 等 |
| 系统配置/平台能力 | 55 | 203 | 13 | 全局配置、模板、审批流、文件、打印、灾备 |
| 回访/随访/触达 | 21 | 181 | 15 | 回访计划、邀约、短信、微信群发、呼叫 |
| 渠道与获客 | 13 | 167 | 9 | 渠道层级、来源素材、推荐成交、海报、市场活动 |
| 预约与到院 | 15 | 160 | 7 | 预约单、预约卡、到院目的、取消原因 |
| SCRM/私域/商城 | 2 | 122 | 2 | SCRM 卡券、小程序商城 |
| 商品/项目 | 6 | 69 | 5 | 项目/商品/类型/标签/项目圈 |
| 营销与活动 | 11 | 60 | 6 | 活动管理、抽奖、问卷、日记、直播 |
| 排班/专家/资源 | 7 | 37 | 1 | 专家排班、休息设置、设备、手术室 |
| 运营目标与考核 | 5 | 34 | 1 | 年度运营、考核评估、大模型分析、客户关注 |
| 财务关账与对账 | 7 | 25 | 1 | 关账、订单复制、兑换、同步、修复申请 |
| 其他（未归类） | 17 | 102 | 3 | 电子签、采购(旧)、录音、受理结果等 |

**给 Agent 的导航建议**：先按 §9 报表体系取数（运营分析最快路径），需要明细时再回到对应业务域的列表接口（如 `/v2/bespeak/bespeakList`、`/v1/consumptionclue/*`），需要单客详情时用 §5 的客户 360 系列。

## 11. 页面地图（256 个 SPA 路由 → 业务域）

> 完整版见 `domains/页面地图.md`（每个业务域列出页面路由与关联接口入口）。前端是单一 SPA（`/portal/*`），256 个路由即 256 个功能页面。

| 功能组 | 页面数 | 代表页面 |
|---|---:|---|
| 治疗/病历 | 32 | 治疗记录、治疗排期、病历、处方、正畸、手术室、电子签 |
| 客户管理 | 25 | 客户列表、客户 360、公海池、标签、流失定义、客户合并 |
| 进销存 | 24 | 仓库、采购、入库、出库、盘点、领料、寄存、加工件 |
| 报表/分析 | 21 | 驾驶舱、敏捷报表、目标管理、六环目标 |
| 组织/权限 | 17 | 员工账号、角色权限、科室、集团、排班 |
| 收费/结算 | 14 | 收银台、收费单、退款、聚合支付、发票 |
| 系统/配置 | 12 | 全局配置、模板、字典、审批流、打印 |
| 渠道/获客 | 12 | 渠道管理、来源素材、推荐成交、海报、市场 |
| 会员/资产 | 12 | 会员卡、权益卡、储值、余额、积分、套餐 |
| 回访/触达 | 11 | 回访计划、短信群发、微信群发、呼叫中心 |
| 预约/到院 | 8 | 预约日历、预约列表、预约卡、到院明细 |
| 商品/项目 | 7 | 项目管理、套餐、商城商品 |
| 咨询/接诊 | 6 | 咨询列表、接诊准备、分诊、面诊 |
| 营销/活动 | 5 | 活动管理、抽奖、问卷 |
| 第三方/SCRM | 3 | 企微、SCRM、平台绑定 |
| 其他页面 | 47 | 各模块内的抽屉/子页面 |

## 12. 运营报表体系（`/report/v1/wym/*`，69/77 实测可用）★

**这是做运营分析最快的取数路径**。报表走独立前缀 `/report/`，鉴权与业务 API 完全一致（裸 JWT + `tenant` 头），响应信封相同。

### 9.1 调用规范（实测）

```http
POST /api/report/v1/wym/{类目}/{报表名}
Authorization: <裸JWT>
tenant: 1
Content-Type: application/json

{ "year": "2026" }                    // ← 核心参数！不带会报 20002 请选择查询年份
```

- 分页报表可加 `{ page: 1, limit: 5 }`；趋势类返回按 12 个月的横表（`january…december`）+ `yearStr`（含"2026/2025/同比去年"三行）
- `list*` 是数据表，`clickPage*` 是页面下钻（多数返回空或需额外上下文），**优先用 `list*`/`get*`**
- 导出类 `export*` 未测试（涉及文件生成，谨慎调用）

### 9.2 六大类目实测可用性（77 个只读报表，69 可用）

| 类目 | 可用/总数 | 内容 |
|---|---|---|
| 客户经营分析 `celebrateCustomer` | **12/12** | 活跃率、复购率、腰率、综合画像、沉睡流失、到院频次、消费区间/频次、区域城市 |
| 划扣/耗卡统计 `deductStatistics` | **11/11** | 划扣分析、项目业绩排行、未划扣排行、科室划扣人数、往年划扣 |
| 渠道营销统计 `marketingStatistics` | 13/16 | 渠道业绩排行、精准画像、新增客户、流失趋势、贡献区间、渠道 RFM、老客合作减少 |
| 品项/项目统计 `productItemStatistics` | 9/10 | 付费分析、复付费、核心爆品、科室业绩、咨询分析、咨询成交明细 |
| 团队业绩统计 `teamStatistics` | 14/15 | 医生/咨询师业绩、电子咨询、未成交原因、客户立方体、月度业绩 |
| 时间维度统计 `timeStatistics` | 10/13 | 新/老客到院、首诊数、预约分析、回访分析、付费划扣业绩、谷值配置 |

> 失败的 8 个：3 个 `getChannelCusLossConfig`/`getValleyConfig` 型是 **GET-only 接口误用 POST**（配置读取，改 GET 即可）；
> 其余 5 个返回 `20002 系统开小差了` 需要更完整的上下文参数（如咨询师 id、数据类型）。

### 9.3 实测真实数据（2026 年，贵州北科生物 bksw9854）

> 以下为 2026-09-23 实测返回的真实运营数据，可作为 Agent 输出的样例格式参考。

| 报表 | 实测数据 |
|---|---|
| 客户综合画像 | 期初顾客 3404 → 期末 3456（+52，去年同期 +97）；消费顾客 **10** 人，消费占比 0.29% |
| 客户腰率 | 平均消费 2041.2 元，消费总额 20412 元，超均值客户 1 人，腰率 10% |
| 首诊数 | 2026 全年 10 人（7 月 1 人、9 月 9 人），月均 1.11 |
| 付费划扣业绩 | 成交业绩 **84812 元**（6 月 64400、7 月 19800、9 月 612）；实耗业绩 263.67 元；实耗/成交占比 0.31% |
| 科室业绩 | 脐带血造血干细胞 37600 元、脐带间充质干细胞 26800 元（北科类，贵州北科生物科室） |
| 划扣项目排行 | 单部位体验（生命方舟）：9 客户、36 次、划扣 263.67 元、均价 29.3 元 |
| 未划扣项目 | 人人存基础版：1 客户、**19800 元未划扣**；中医拔罐等 |
| 科室划扣人数 | 医疗中心 9 人划扣 263.67（100%）；本部 1 人未划扣 19800 |
| 医生业绩 | 李贵芳：操作 9 例、划扣 263.67 元 |
| 咨询业绩 | 总实收 20412 元、客单价 2041.2 元、付费客户 10 人、退款 0 |
| 付费分析 | 单部位体验：36 次、9 客户、客单价 62.04 元、实收 558.36 元 |
| 渠道新增分析 | 14 个渠道，付费渠道 0 个，付费金额 0 |

> ⚠️ **口径提醒**：报表统计的是「当年消费客户」=10 人，而客户总数 3428 —— 因为该租户 2026 年才开始正式运营（历史数据陆续导入）。
> 2026-06 之前无成交。做同比/趋势分析时要意识到基数极小。

### 9.4 ⚠️ 报表服务的限流行为（重要）

实测发现：**短时间内连续调用报表接口会触发服务端限流**，表现为：
- 返回 `401 没有找到您要的资源`（并非路由不存在，是限流后的伪装响应）
- 或返回 **HTML 错误页**（`content-type: text/html`），JSON 解析失败

实测同一请求在空闲期 12/12 成功，但批量 150 次/分钟（420ms 间隔）后全部失败，约 20~60 秒后自行恢复。
**Agent 必须遵守**：报表调用间隔 ≥1.5 秒；收到 401 或非 JSON 时等待 4 秒重试一次；单次分析会话报表调用 ≤50 次。

### 9.5 报表体系之外的 `/report/*` 类目（实测）

| 接口 | 状态 | 说明 |
|---|---|---|
| `POST /report/v1/payment/billingCashiering` | ✅ | 收银汇总 |
| `POST /report/v1/treatment/deptDeduct` / `doctorDeduct` | ✅ | 科室/医生划扣 |
| `POST /report/v1/daySettlement/report` | ✅ | 日结报表 |
| `POST /report/v1/CollectAndConfirm/report`（需时间参数） | ✅ | 收款确认 |
| `POST /report/v1/treatmentNotDeductReport/report`（需时间参数） | ✅ | 治疗未划扣 |
| `POST /report/v1/aggregateRecord/report` / `initData` | ✅ | 聚合记录（当前空） |
| `POST /report/v1/cockpit/autoFreshTime` | ✅ | 驾驶舱自动刷新配置 |
| `POST /report/v1/channel/newCustomerChannelAchievement` | 需参 | 报 `客户来源不能为空`，需传 `customerSource` |
| `POST /report/v1/consultation/allHospitalDayOrMonth` 等 | 需参 | 报 `系统开小差`，需日期+医院上下文 |
| `POST /report/v1/wym/*` 的 `export*` 系列 | 未测 | 文件导出，谨慎 |

## 13. 只读接口系统性探测（508 个候选，182 个无参可用）

> 完整结果见 `probe-results.json`（含每个接口的 `shape` 返回结构与脱敏 `sample`）——**这是判断"哪个接口现在就能调"的权威依据**。

**探测方法**：从 3973 个端点中筛出 805 个只读候选（排除 add/update/delete/save/export/approval 等 30+ 关键词），
每模块限 4 个（报表 8 个）得到 508 个目标，逐一实测（GET 直调；POST 依次尝试 `{page,limit}` → `{current,size}`），记录业务码、返回结构与样本。

**结论**：
- **182/508** 无需业务参数即可返回数据 —— 主要是 `getAll`/`tree`/`getConfig`/`list`/`statistics` 类
- 其余 326 个返回 `20002`（缺业务参数，如 customerId/startDate）或 `401 没有找到您要的资源`（本租户未部署该路由）
- 报 `20002 系统开小差了，请重试！` 通常意味着**参数不完整**（服务端把空指针转成了这句话）
- 报 `401 没有找到您要的资源` = 路由不存在（与 token 无关）——可与 `401 身份信息已经过期`（token 失效）区分

**给 Agent 的实践**：调用陌生接口时先无参探测一次，用报错信息反推必填参数（服务端的参数校验提示通常直接点名，如 `客户来源不能为空`、`请选择查询年份`、`咨询师id不能为空`）。

## 14. 分域深度解析（专题文档）

> 以下 5 份专题文档在 `domains/` 目录，每份含：业务逻辑、核心实体与数据模型（含实测字段）、状态机与流程、关键接口表（含实测状态）、Agent 可实现的运营场景、二开注意事项。

| 专题 | 文件 | 覆盖模块 | 核心要点 |
|---|---|---|---|
| 客户管理 | `domains/客户管理.md`（219 行） | 客户主数据/公海池/流转/标签/RFM/360视图/合并/流失 | 客户生命周期全链路（来源→建档→分配→跟进→到院→成交→复购→沉睡→回收）、公海池流转与审批、客户类型自动判定 |
| 临床业务流 | `domains/临床流程.md`（399 行） | 咨询→预约→接诊→治疗→病历→回访 | 端到端就诊链路（实测接口 + i18n 佐证）、咨询单/预约单/接诊准备单/接诊单/治疗记录/病历六类单据模型 |
| 渠道营销 | `domains/渠道营销.md`（432 行） | 渠道/来源/推荐成交/活动/第三方平台/SCRM | 市场渠道与来源层级、渠道结算与分账、客户来源与推荐关系、消费线索/项目圈/种草、第三方平台统一接入模式 |
| 收费资产 | `domains/收费资产.md`（346 行） | 收费/支付/会员卡/权益/储值/积分/项目商品 | 钱的主线（开单→收银→流水→清分→分账）、资产账户体系（360 视图下的钱包）、会员体系（hc=HCustomer） |
| 进销存 | `domains/进销存.md`（300 行） | 仓库/采购/出入库/盘点/领料/供应商/加工件 | 采购申请→采购单→入库→领料核销→出库→退料闭环、库存驾驶舱 19 字段、四类预警（实测临期 4/异常消耗 1） |

**配套索引**：`domains/业务域地图.md`（20 域 × 429 模块 × 入口接口）、`domains/页面地图.md`（256 页面 → 接口）、
`domains/报表体系.md`（184 个报表接口分类）、`probe-results.json`（508 接口实测 shape/sample）。

**运营场景速查（Agent 可直接实现）**：
1. 客户经营：活跃/复购/腰率三件套 + 沉睡流失名单（§12 celebrateCustomer）
2. 渠道 ROI：渠道业绩排行 × 新增客户 × 流失趋势（marketingStatistics）
3. 划扣管理：未划扣项目排行 = **已售未耗**名单，是回访/复购的最强抓手（deductStatistics）
4. 人员效能：医生/咨询师业绩 + 未成交原因（teamStatistics）
5. 节奏监控：新客到院/首诊/预约的月度趋势 + 回访有效率（timeStatistics）
6. 品项分析：付费分析 + 复付费率 + 核心爆品（productItemStatistics）
7. 库存运营：驾驶舱四评分四预警四待办 + 临期清单 + 「领了没用」回收（`domains/进销存.md` §五）

---

*本文档基于对客户端 4.128.8 的静态分析与本地实测生成；所有"已验证"接口均在真实租户环境返回成功。接口路径随厂商版本可能变化，正式集成前请以实测为准，并优先走厂商授权接入路径。*
