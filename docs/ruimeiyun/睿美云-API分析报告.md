# 睿美云（Realmerit）SaaS 系统 — 数据 API 全解析报告

> 分析对象：`E:\Program Files (x86)\ruimeiyun`（睿美云客户端 v5.0.0，四川纽睿科技有限公司）
> 分析方法：Electron asar 解包 + 前端 SPA bundle 静态分析 + 本地存储/HTTP 缓存取证 + 公开接口实测
> 分析日期：本机实测（客户端处于登录态时抓取）

---

## 1. 应用架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  睿美云.exe (Electron 壳, 内部代号 Neuron)                    │
│  ├─ resources/app.asar → main.js (359KB, 主进程)             │
│  ├─ 启动时加载 → https://web.realmerit.com.cn/login (登录页)  │
│  └─ 登录成功后加载 → {CDN}/static/{版本}/app.html#/main      │
│      当前版本: 4.128.8 (orgCode=bksw9854 动态下发)            │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  Web SPA「智能管理系统」(React + axios + mobx)                │
│  所有数据请求 → https://bksw.hospital.realmerit.com.cn/api   │
│  WebSocket 长连接 → wss://bksw.hospital.realmerit.com.cn     │
└─────────────────────────────────────────────────────────────┘
```

**核心机制**：SaaS 多租户架构。每个医院（租户）有唯一 `hospitalKey`（机构码），
登录响应中动态下发该租户专属的 `api_url`、`websocket_url`、`file_url` 等全套地址。

---

## 2. 域名地图（本机实测全部主机）

| 主机 | IP | 用途 |
|---|---|---|
| `bksw.hospital.realmerit.com.cn` | 14.103.23.67 | **★ 数据 API 主战场**（`/api/*` + WebSocket），按租户分配子域 |
| `gateway.system.realmerit.com.cn` | 124.223.147.76 / .145.105 / 175.24.161.166 | 全局网关：按医院查询网关配置、官方接口 |
| `gatewaybackup.system.realmerit.com.cn` | 106.14.228.162 | 网关灾备（`{hospitalKey}.json`） |
| `client.realmerit.com.cn` | 14.103.135.17 | 客户端版本服务（appversion） |
| `web.realmerit.com.cn` | — | CDN：登录页 + 应用静态资源（阿里 OSS: realmerit-web-release） |
| `static.web.realmerit.com.cn` | — | 静态资源：pdf.js、iconfont、i18n、图片 |
| `middleplatform.realmerit.com.cn` | 8.156.66.100 | 中台（组织/广告/海报） |
| `testmiddleplatform.realmerit.com.cn` | — | 中台测试环境 |
| `poster.realmerit.com.cn` | 36.25.242.173/.174 | 海报图片存储 |
| `realmerit-client-static.oss-cn-shanghai.aliyuncs.com` | — | 阿里 OSS 客户端静态资源 |
| `test.hospital.realmerit.com.cn` | 192.168.2.115 | 内网测试环境（bundle 中泄露的开发配置） |

**内部情报**（来自打包配置模块）：
- 产品内部代号 **Neuron**（win32: `Neuron.exe`），文件服务开发域名 `dev.file.neurongenius.com`
- 产品序列号 `serial: 0b3f8c1b325e4c6b9e3b1c541f0d2008`，build_version 4.128.8，branch master
- 环境体系：`system`(生产) / `uat.system` / `test.system`

---

## 3. 认证与调用协议

### 3.1 登录流程（四步）

```
① GET  https://bksw.hospital.realmerit.com.cn/api/v1/getPublicKey
   → {"code":10000, "data":"MIGfMA0GCSqGSIb3..."(RSA 公钥, Base64 DER)}   [实测 200 OK]

② GET  https://gateway.system.realmerit.com.cn/release/api/hospital/{hospitalKey}/{host}
   → 返回该医院专属网关配置（WASM 加密的 JSON，含 api_url 等）             [实测 200 OK]
   备用: https://gatewaybackup.system.realmerit.com.cn/{hospitalKey}.json

③ POST https://{api_url}/v1/login
   Body: { 账号信息, password: RSA公钥加密(密码), mac: 网卡地址, hospitalKey, tenantId... }

④ 登录响应 = 全套运行时配置 + 凭证：
   { user: { token }, api_url, websocket_url, file_url, updater_url,
     cdn_url, dashboard_url, help_url, scrm_file_url, hospital_key,
     hospitalName, phoneNumber, address, identifier, environment,
     systemPrintingConfig, permList(权限列表) }
```

### 3.2 业务请求规范（axios 实例配置，来自 bundle 反编译）

```js
axios.create({
  baseURL: loginInfo.api_url,        // https://bksw.hospital.realmerit.com.cn/api
  timeout: 60000,
  headers: { lang: 'zh-CN' }
})
```

| 项目 | 值 |
|---|---|
| 认证头 | `Authorization: {token}`（原始 token，无 Bearer 前缀） |
| 租户头 | `tenant: {tenantId}`（部分接口） |
| 语言头 | `lang: zh-CN` |
| 响应格式 | `{"code":10000, "msg":"操作成功", "data":...}`（10000=成功；登录系接口用 0/10001） |
| 错误处理 | 401→强制登出；400→参数错误；500→服务器错误 |
| 防重 | 相同 `method-url` 请求去重 |
| 传输加密 | 自研 WASM 模块（encrypt/decrypt/james/curry），部分接口响应走加密包装（`X-No-Wrap` 头控制明文 JSON） |

### 3.3 你这台机器的实际租户参数

- hospitalKey（机构码）：`bksw9854`
- API 子域前缀：`bksw`
- tenantId：`1`
- 应用版本缓存：`4.128.84`（服务端当前下发 `4.128.8`）

---

## 4. 数据 API 端点全清单（从真实流量缓存提取，共 267 个 URL / 78 类端点）

Base：`https://bksw.hospital.realmerit.com.cn/api`

### 4.1 认证 / 账号 / 租户
```
GET  /v1/getPublicKey                                   RSA 公钥（无需登录）
GET  /v1/refreshLogin?tenant={id}&loginType=PC          刷新登录
GET  /v1/afterLoginLoadData?tenantId={id}               登录后首屏聚合数据
GET  /v1/getAllTenantTree?phone={手机号}&hospitalKey={hk} 租户树（按手机号）
GET  /v1/getUserTenantTree?userId={id}&hospitalKey={hk}  用户租户树
GET  /v1/tenant/getMyTenant                             我的租户
GET  /v1/user/userAll / userAllEnable                   全部员工
GET  /v1/user/getAllDoctors                             全部医生
GET  /v1/user/exclusive-servers?ignoredGrey=true        专属客服/服务器
GET  /v1/user/selectForgetPassInfo?accountInfo=&tenantId=  找回密码信息
GET  /v1/role/tree/                                     角色树
```

### 4.2 客户管理（CRM 核心）
```
GET  /v1/customer/initListV2                            客户列表 V2
GET  /v1/customer/detail?customerId={id}                客户详情
GET  /v1/customer/getCustomerByPhone?phone={手机号}      按手机号查客户
GET  /v1/customer/getCoordinate?customerId={id}         客户坐标
GET  /v1/customerOverView/arriveDetail                  到店明细
GET  /v1/customerOverView/consumeStatistical            消费统计
GET  /v1/customerOverView/consumptionBehaviorTrack      消费行为轨迹
GET  /v1/customerOverView/cusRelations                  客户关系
GET  /v1/customerOverView/getRfmScore?isGroup=false     RFM 分值
GET  /v1/customerOverView/recentAppointment             近期预约
GET  /v1/customerFriend/treeList?customerId={id}        客户亲友树
GET  /v1/customerPool/customerPools                     公海池
GET  /api/customerHealthHistory/getCustomerHealthHistoryById  既往健康史（注意无 /v1 前缀）
```

### 4.3 咨询 / 接诊
```
GET  /v1/consultation/getConUsers                       咨询人员
GET  /v1/consultationInfo/getCusForm?customerId=        咨询表单
GET  /v1/consultationInfo/getSmartLabelForTop?id=       智能标签(顶部)
GET  /v1/consultationInfo/iniCus                        咨询初始化
GET  /v1/toConsultation/getUniqueForm?customerId=&type=1 转接咨询表单
GET  /v1/reception/receptionListInit                    接诊列表初始化
GET  /v2/reception/getManagerConfig / getTriageToUserList  分诊配置
GET  /v1/arrivePurpose/allData                          到店目的
```

### 4.4 渠道管理
```
GET  /v1/channel/getAllChannel?name=&flag=true&type=1   全部渠道
GET  /v1/channel/allDept / allMaintainers               渠道科室/维护人
GET  /v1/channel/getCustomerNumber                      渠道客户数
GET  /v1/channelType/allChannelTypeNew?category=1|2     渠道类型
GET  /v1/channelType/channelTypeDetails?id={id}         渠道类型详情
GET  /v1/channelVisit/page?page=1&limit=20              渠道回访分页
```

### 4.5 预约 / 开发计划 / 回访
```
GET  /v2/bespeak/bespeakListInit                        预约列表初始化
GET  /v1/devPlan/getPlans?customerId=&isAll=true&sort=4 开发计划
GET  /v1/visitPlan/init / get-visit-priority / get-visit-way-list  回访计划
GET  /v1/visit/closeSysCheck                            回访系统检查
GET  /v1/expertRestSetting/getAllExperts                专家排休
GET  /api/menuBaseInfo/get-dev-plan-visit-result-config 开发计划回访结果配置
```

### 4.6 消费 / 账单 / 划扣
```
GET  /v1/billing/getMedicalDepts                        医疗科室
GET  /v1/deposit/getAllProject                          寄存项目
GET  /v1/report/cashierRecord/init                      收银记录
GET  /v1/consumptionclue/getcolorconfig                 消费线索颜色配置
```

### 4.7 会员 / 标签 / 企微
```
GET  /v1/member/level/getHCustomerMemberLevel           会员等级
GET  /v1/mirageskinlabelcustomer/customerLabel?customerId=  皮肤检测标签
GET  /v1/onlinecFaceConsultation/getMemberLevel         面诊会员等级
GET  /v1/qyWechat/customer/customerTags?customerId=     企业微信客户标签
```

### 4.8 基础数据 / 字典
```
GET  /v1/dict?codes=anesthesia|channelLevel|clinicType|injectionSite  数据字典
GET  /v1/dept/depts / dept/tree                         科室
GET  /v1/projectType/tree?name=                         项目类型树
GET  /v1/flowbrand/ini                                  流程品牌初始化
GET  /v1/flowbrandinfo/getCustomerFlow / bespeakStatic / getFlowBrandStatus  客流/预约统计
GET  /v1/preparation/ini                                备皮/准备初始化
```

### 4.9 消息 / 菜单 / 收藏
```
GET  /v1/msg/todayTotal                                 今日消息统计
PUT  /v1/msg/readMsgNotification                        消息已读
GET  /v1/menu/allCollect                                收藏菜单
POST /v1/menu/addCollect / delCollect                   添加/删除收藏
POST /v1/menu/order                                     收藏排序
```

### 4.10 其他业务
```
GET  /v1/photo/applyList / listNew?limit=20&page=1&isCurrentDay=1   相册/案例照
GET  /v1/smsMass/getUserListTypeList?queryShareTenant=true          短信群组
GET  /v1/approval/baseInfoV2?isGroup=false / getNum4?card=1         审批
GET  /v1/cpConfig/getSysUser                                        CP配置
GET  /v1/treatmentCenterConfig/getTreatmentConfig                   治疗中心配置
GET  /v1/timerconfig/remindTime                                     定时提醒配置
GET  /v1/results/resultsAllotSort?type=1                            结果分配排序
GET  /v1/workPermit/getBigModelFieldCheckValue?customerId=          AI大模型字段校验
GET  /v1/serial/getBySerial?serial=                                 序列号校验
PUT  /v1/gconfig/update / GET /v1/gconfig/visitModValid             全局配置
GET  /v1/report/annualReport/record/getUserAppointYearLogin?reportYear=2025  年度报告
```

### 4.11 云呼叫（电话外呼）
```
POST /v1/call-cloud/call                                发起呼叫
POST /v1/call-cloud/uniteCloudCall                      统一云呼
POST /v1/call-cloud/smartCloudCall                      智能云呼
POST /v1/skylink/cloud/call                             Skylink 外呼 + 通话记录上报
GET  https://gateway.system.realmerit.com.cn/release/api/live/get_live_info  直播信息
```

### 4.12 平台级接口（非租户 API）
```
# 网关（gateway.system.realmerit.com.cn）
GET /release/api/hospital/{hospitalKey}/{host}          医院网关配置（WASM 加密响应）
GET /release/official/api/news/list?list_type=9&page=1  官方公告

# 版本服务（client.realmerit.com.cn）
GET /appversion/v1/appVersionInfo/pass/getByOrgCode?orgCode={hospitalKey}
    → {"code":0,"data":{"currentVersion":"4.128.8","orgCode":"bksw9854"}}  [实测 200 OK]

# 中台（middleplatform.realmerit.com.cn）
GET /organization/v1/orgAdvert/pass/currentInfo?terminal=pc&type=realmerit
    → 广告海报配置 → 图片在 poster.realmerit.com.cn                      [实测 200 OK]

# 登录页专用（gateway）
GET /v1/login                POST 登录
GET /v1/loginPasswordRuleConfiguration/getPasswordRule?phone=&tenantId=
GET /v1/loginPasswordRuleConfiguration/verifyPassword   POST
POST /v1/verifyCode/sendByTenantId                      验证码
POST /v1/user/resetPassword                             重置密码
```

### 4.13 本地接口（客户端插件桥）
```
ws://localhost:9800/plugin?type=client     本地插件 WebSocket 服务（读卡器/打印/硬件对接）
插件热更新: {updater_url}/{pluginName}.json → 下载 exe 覆盖 plugins 目录
```

---

## 5. 客户端配置注入机制（main.js 反编译）

登录信息由 Electron 主进程展开为全局变量，供打印/插件/更新等本地能力使用：

```js
global.TOKEN / USERINFO / LOGININFO          凭证与用户
global.API_URL        = t.api_url            数据 API（bksw.hospital...）
global.WEBSOCKET_URL  = t.websocket_url      消息推送长连接
global.FILE_URL / SCRM_FILE_URL              文件服务
global.GATEWAY_URL    = t.gateway_url        网关
global.UPDATER_URL    = t.updater_url        插件更新服务
global.CDN_URL / DASHBOARD_URL / HELP_URL    静态/看板/帮助
global.HOSPITAL_KEY / HOSPITAL_NAME / ...    租户信息
global.IDENTIFIER     = t.identifier         机构标识
global.ENVIRONMENT    = t.environment        环境
global.SERIAL         = t.serial             设备序列号
```

## 6. 安全机制评估

| 机制 | 实现方式 | 强度评价 |
|---|---|---|
| 密码传输 | RSA 公钥加密（每会话取公钥） | ✅ 标准 |
| 本地存储 | `__realmerit__`、`gateway_info_{hk}` 等以 WASM 自研算法加密 | ✅ 防dump，算法未公开 |
| API 响应 | 部分接口加密包装（WASM curry/james），`X-No-Wrap` 头声明明文 | ✅ |
| 权限 | 登录下发 `permList`，前端控制 + 后端校验 | — |
| 多租户隔离 | 每租户独立子域（bksw.hospital...）+ tenant 头 | ✅ |
| 值得注意 | Electron `webSecurity:false`、`nodeIntegration:true`、`devTools:true`；UA 面暴露完整前端逻辑 | ⚠️ 客户端信任边界弱 |

## 7. 如何对接这些 API（合规路径）

1. **正常渠道**：数据 API 均需登录 token（`Authorization` 头 + `tenant` 头），密码 RSA 加密后走 `/v1/login`。
2. **无需认证的公开接口**：`getPublicKey`、`appversion/pass/getByOrgCode`、中台 `orgAdvert/pass/currentInfo`、网关 hospital 配置（密文）。
3. **自助取证方法**（本次使用，可复现）：
   - Chromium 缓存取证：`%APPDATA%\client\Cache\Cache_Data` 中存有全部请求 URL 明文 key
   - 本地存储：`%APPDATA%\client\Local Storage\leveldb`（WASM 加密）
   - 版本跟踪：改 orgCode 即可查任意租户当前版本
4. **若需要开放 API/对接文档**：此类医疗 SaaS 一般不对外开放 REST API；建议直接联系四川纽睿科技（realmerit.com.cn）索取开放平台文档，勿绕过认证直接调用。

---

## 附2：第二轮实测补充（带 Token 实测验证，2026-09-05）

### 已实测打通的客户数据接口（Base: https://bksw.hospital.realmerit.com.cn/api）

| 接口 | 方法 | 说明（实测返回） |
|---|---|---|
| `/v1/customer/getCustomerByPhone?phone=` | GET | **客户搜索**：返回客户卡片数组（姓名/电话/VIP号/来源/类型/机构/最近到院） |
| `/v1/customer/detail?customerId=` | GET | **客户完整档案**（base 资料 7KB+：地址/生日/邮箱/职业等） |
| `/v1/customer/getCustomerPhoneNumbers?customerId=` | GET | 客户全部电话 |
| `/v1/customerOverView/consumeStatistical?customerId=` | GET | 消费统计（累计消费/余额/赠送/寄存） |
| `/v1/customerOverView/getRfmScore?customerId=&isGroup=false` | GET | RFM 评分（三指标+总分） |
| `/v1/customerOverView/cusRelations?id=` | GET | 客户关系图谱（ECharts 节点+统计） |
| `/v1/customerOverView/arriveDetail / consumptionBehaviorTrack / recentAppointment` | GET | 到店/消费轨迹/近期预约 |
| `/v1/customerPool/customerPools` | GET | 公海池：personalPoolCount=2321、nonPersonalPoolCount=1125、各池 currentCount |
| `/v1/channel/getCustomerNumber` | GET | 客户总数：3428 |
| `/v2/bespeak/bespeakList` | POST | 预约列表（MyBatis-Plus IPage 分页：records/total/size） |
| `/v2/reception/receptionList` | POST | 接诊列表（同分页结构，{page,limit} 参数） |
| `/v1/scrm/customer/scrmCustomerList` | POST | SCRM 跨院客户列表（本租户 total=0） |
| `/v1/user/userAll` | GET | 员工 52 人（姓名/电话/岗位/部门/jobStatus） |

### 业务码语义（实测确认）

- `10000` 操作成功 · `10001` 成功获取数据，数据非空 · `10002` 操作成功，数据为空 · `20002` 版本/参数/服务器错误 · `401`(body) 未登录或路由不存在
- HTTP 层 401 = token 缺失/过期（msg=无权访问，请登录后再操作！）

### 客户数据集（cube）体系

- `GET /v2/customer/cube/template/get-user-all-cube-config` → 74 个预置数据集（今日未成交/最近N日未回访/消费分级/欠费/生日等，`systemConfigEnum` 标识）
- `POST /v1/customer/customerCube`（getResultData）与 `/v1/customer/customerCube/userCount`、`/export` 存在于前端代码（pagesCommon chunk），但本租户网关未放行该路由（返回路由不存在兜底）
- 认证 JWT：HS256，payload 含 tenant_id/sole/userNo/id/type/exp（本例有效期至 2026-09-08）

### 看板

- `C:\Users\Public\ruimeiyun-analysis\dashboard\index.html` — 已按实测数据结构精修（KPI/公海池分布/团队概况/手机号搜客/客户360视图/接口探针）
- `C:\Users\Public\ruimeiyun-analysis\dashboard\server.js` — 本地静态+代理服务（127.0.0.1:8899）
- `C:\Users\Public\ruimeiyun-analysis\dashboard\login.js` — 本地登录换 token 工具

## 附：分析产物文件

| 文件 | 说明 |
|---|---|
| `C:\Users\Public\ruimeiyun-analysis\extracted\` | app.asar 解包结果（package.json + main.js） |
| `C:\Users\Public\ruimeiyun-analysis\all-cache-urls.txt` | HTTP 缓存中提取的全部 267 个 URL |
| `C:\Users\Public\ruimeiyun-analysis\spa-index.js` / `login-index.js` | system 加载器 + 登录页 bundle |
| `C:\Users\Public\ruimeiyun-analysis\app-main.js` / `app-common.js` | 应用主包 4.128.8（1.4MB + 722KB） |
| `C:\Users\Public\ruimeiyun-analysis\*.js`（asar-extract / find-urls / context / dump-key / scan-strings / cache-urls 等） | 本次分析使用的全部脚本工具 |
