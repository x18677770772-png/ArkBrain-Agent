// 额外放行的来源白名单（反向代理 / 公网隧道预览用）。
// 单独成文件：HTTP 门禁（api.js）与 WebSocket 升级门禁（websocket-security.js）
// 必须使用同一套规则，否则出现"页面能加载、WS 全 403"的割裂。
// 通过环境变量 ARKBRAIN_EXTRA_ALLOWED_ORIGINS 配置，逗号分隔，支持：
//   - 完整来源：https://foo.example.com —— scheme+host 全等才算命中
//     （http:// 条目不匹配 https:// 同主机，带端口 Origin 要连端口一起写）
//   - 主机名：foo.example.com —— 匹配该主机任意 scheme/port
//   - 通配后缀：*.trycloudflare.com —— 要求至少一个子域名；单独 "*" 无效
//
// 信任模型（重要）：白名单只放行「非敏感预览面」——页面静态资源、聊天消息、
// 语音 /voice/cloud、SSE 事件流。敏感面（/settings*、/admin/*、/memories、
// /conversations、/slice* 等）永远需要口令（#token= 带口令链接 / Bearer），
// /scene WebSocket 对非回环 Origin 亦要求口令（承载 security-confirm-* intent）。
// 即：拿到裸预览链接 ≠ 拿到设置与密钥；白名单域 ≠ 本机会话。README 有完整说明。

export function getExtraAllowedOrigins() {
  return String(globalThis.process?.env?.ARKBRAIN_EXTRA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function isExtraAllowedOrigin(origin) {
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    return getExtraAllowedOrigins().some((pattern) => {
      if (pattern.startsWith('*.')) {
        // "*.example.com" → 后缀 ".example.com"，要求至少一个子域名
        const suffix = pattern.slice(1)
        return parsed.hostname.endsWith(suffix)
      }
      return pattern === origin || pattern === parsed.hostname
    })
  } catch {
    return false
  }
}
