import fs from 'fs'
import path from 'path'
import { execSync, execFileSync } from 'child_process'
import { paths } from '../../paths.js'
import { BUILTIN_TOOL_NAMES } from '../builtin-tools.js'

const IS_WIN = process.platform === 'win32'

const TOOLS_DIR = path.join(paths.sandboxDir, 'installed_tools')
const DEFAULT_PERMISSIONS = Object.freeze({
  network: false,
  exec: false,
})

// 运行时注册表：name → { schema, execute }
const registry = new Map()

function ensureToolsDir() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true })
}

function buildSchema(name, description, parameters) {
  return {
    type: 'function',
    function: { name, description, parameters },
  }
}

export function normalizeToolPermissions(permissions = {}, { legacy = false } = {}) {
  const base = legacy
    ? { network: true, exec: true }
    : { ...DEFAULT_PERMISSIONS }
  if (!permissions || typeof permissions !== 'object') return base
  return {
    network: permissions.network === true,
    exec: permissions.exec === true,
  }
}

const CODE_DENY_RULES = [
  { re: /\b(?:eval|Function)\s*\(/, reason: 'dynamic JavaScript evaluation is not allowed' },
  { re: /\bnew\s+Function\b/, reason: 'dynamic JavaScript evaluation is not allowed' },
  // Bare identifiers: catches indirect eval like (0, eval)(...) and Function
  // references retrieved without an immediately visible call.
  { re: /\beval\b/, reason: 'dynamic JavaScript evaluation is not allowed' },
  { re: /\bFunction\b/, reason: 'dynamic JavaScript evaluation is not allowed' },
  { re: /\b(?:require|import)\s*(?:\(|["'])/, reason: 'module loading is not allowed' },
  { re: /\b(?:process|globalThis|global|window|document)\b/, reason: 'global runtime access is not allowed' },
  { re: /\b(?:fs|child_process|worker_threads|vm)\b/, reason: 'Node system modules are not allowed' },
  { re: /\b(?:execSync|execFileSync|spawn|spawnSync|fork)\b/, reason: 'process execution APIs are not allowed' },
  { re: /constructor\s*\.\s*constructor/, reason: 'constructor escape is not allowed' },
  // (function(){}).constructor / (async function(){}).constructor / (function*(){}).constructor
  // retrieve Function/AsyncFunction/GeneratorFunction and bypass Function\s*\( checks.
  { re: /\.\s*constructor\b/, reason: 'constructor escape is not allowed' },
  { re: /\[\s*(['"`])constructor\1\s*\]/, reason: 'constructor escape is not allowed' },
  { re: /\[\s*(['"`])con\1\s*,\s*(['"`])structor\2\s*\]/, reason: 'constructor escape is not allowed' },
  { re: /__proto__|prototype\s*\[/, reason: 'prototype manipulation is not allowed' },
  // Reflect.get(fn,'constructor') / Object.getOwnPropertyDescriptor bypass dotted
  // `.constructor` deny rules and the shadowed Function parameter.
  { re: /\bReflect\s*\.\s*get\b/, reason: 'Reflect.get constructor escape is not allowed' },
  { re: /\bObject\s*\.\s*getOwnPropertyDescriptor\b/, reason: 'descriptor constructor escape is not allowed' },
  { re: /\bObject\s*\.\s*getPrototypeOf\b/, reason: 'prototype escape is not allowed' },
]

// Collect string-literal concatenation chains ("'a' + 'b' + ...") and return
// each fully joined value. Raw deny rules only see source text, so reassembled
// identifiers like 'pro' + 'cess' never match them contiguously.
function collectStringLiteralConcatenations(text) {
  // Non-capturing group around each alternative: without it, `'a'|'b'+` binds as
  // `'a' | ('b'+)` and multi-literal chains never match as one joined value.
  const strPattern = `'(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"`
  const chainRe = new RegExp(`(?:${strPattern})(?:\\s*\\+\\s*(?:${strPattern}))+`, 'g')
  const literalRe = new RegExp(strPattern, 'g')
  const joinedValues = []
  let chain
  while ((chain = chainRe.exec(text)) !== null) {
    const literals = chain[0].match(literalRe) || []
    joinedValues.push(literals.map(l => l.slice(1, -1)).join(''))
  }
  return joinedValues
}

function permissionIssuesFor(text, normalized) {
  const issues = []
  if (!normalized.exec && /\bhelpers\s*\.\s*exec\b/.test(text)) {
    issues.push('helpers.exec requires permissions.exec=true')
  }
  if (!normalized.network && (/\bhelpers\s*\.\s*fetch\b/.test(text) || /\bfetch\s*\(/.test(text))) {
    issues.push('network access requires permissions.network=true')
  }
  return issues
}

export function analyzeToolCode(code = '', permissions = {}) {
  const text = String(code || '')
  const normalized = normalizeToolPermissions(permissions)
  const issues = []
  for (const rule of CODE_DENY_RULES) {
    if (rule.re.test(text)) issues.push(rule.reason)
  }
  issues.push(...permissionIssuesFor(text, normalized))
  // Re-run every deny rule against identifiers reassembled by string concat.
  for (const joined of collectStringLiteralConcatenations(text)) {
    for (const rule of CODE_DENY_RULES) {
      if (rule.re.test(joined)) issues.push(rule.reason)
    }
    issues.push(...permissionIssuesFor(joined, normalized))
  }
  return [...new Set(issues)]
}

// helpers 暴露给已安装工具代码使用的受控能力
function buildHelpers(permissions = {}) {
  const normalized = normalizeToolPermissions(permissions)
  return {
    fetch: (...args) => {
      if (!normalized.network) throw new Error('network permission is not granted for this tool')
      return globalThis.fetch(...args)
    },

    exec: (command, opts = {}) => {
      if (!normalized.exec) throw new Error('exec permission is not granted for this tool')
      try {
        const execOpts = {
          encoding: 'utf-8',
          timeout: opts.timeout ?? 30_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        }
        if (IS_WIN) {
          // 走 PowerShell 显式调用，并三层同步 UTF-8 编码（chcp + OutputEncoding + InputEncoding），
          // 避免中文 Windows 默认 GBK 代码页让原生命令输出被按 UTF-8 解码成乱码。
          const wrapped =
            `chcp 65001 > $null; ` +
            `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ` +
            `[Console]::InputEncoding=[System.Text.Encoding]::UTF8; ` +
            `$OutputEncoding=[System.Text.Encoding]::UTF8; ` +
            command
          return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', wrapped], execOpts)
        }
        return execSync(command, execOpts)
      } catch (err) {
        return `Error: ${err.message}`
      }
    },

    log: (msg) => console.log('[installed_tool]', msg),
  }
}

// 把工具代码字符串编译为可调用的 async 函数
// 代码是函数体（不含 function 声明），可用变量：args, helpers
// 说明：eval 不能作为参数名（严格模式 SyntaxError），由 analyzeToolCode 的
// 裸 eval deny 规则拦截；Function/constructor 通过参数遮蔽为 undefined。
function compileExecute(name, code, permissions = {}, { legacyUnsafeGlobals = false } = {}) {
  let fn
  try {
    // AsyncFunction 构造器接受参数名列表 + 函数体
    // eslint-disable-next-line no-new-func
    fn = legacyUnsafeGlobals
      ? new Function('args', 'helpers', `"use strict";\nreturn (async () => {\n${code}\n})()`)
      : new Function(
          'args',
          'helpers',
          'fetch',
          'process',
          'globalThis',
          'require',
          'module',
          'exports',
          'Buffer',
          'Function',
          'constructor',
          `"use strict";\nreturn (async () => {\n${code}\n})()`,
        )
  } catch (err) {
    throw new Error(`工具 "${name}" 代码语法错误：${err.message}`)
  }
  return async (args) => {
    const helpers = buildHelpers(permissions)
    return legacyUnsafeGlobals
      ? await fn(args ?? {}, helpers)
      : await fn(
          args ?? {},
          helpers,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        )
  }
}

function validateName(name) {
  if (!name || typeof name !== 'string') throw new Error('工具名称不能为空')
  if (!/^[a-z][a-z0-9_]{1,49}$/.test(name)) {
    throw new Error('工具名称只能含小写字母、数字、下划线，长度 2-50，且以字母开头')
  }
  if (BUILTIN_TOOL_NAMES.has(name)) throw new Error(`"${name}" 是保留名称，不允许覆盖`)
}

function validateParameters(parameters) {
  if (!parameters || typeof parameters !== 'object') throw new Error('parameters_schema 必须是对象')
  if (parameters.type !== 'object') throw new Error('parameters_schema.type 必须是 "object"')
  if (!parameters.properties || typeof parameters.properties !== 'object') {
    throw new Error('parameters_schema.properties 必须是对象')
  }
}

export function validateToolManifest({ name, description, parameters, code, permissions } = {}) {
  validateName(name)
  if (!description || typeof description !== 'string') throw new Error('description 不能为空')
  validateParameters(parameters)
  if (!code || typeof code !== 'string') throw new Error('code 不能为空')
  const normalizedPermissions = normalizeToolPermissions(permissions)
  const issues = analyzeToolCode(code, normalizedPermissions)
  if (issues.length > 0) {
    throw new Error(`工具代码未通过安全检查：${issues.join('; ')}`)
  }
  return {
    name,
    description,
    parameters,
    code,
    permissions: normalizedPermissions,
  }
}

// ─── 对外 API ────────────────────────────────────────────────────────────────

export async function installTool({ name, description, parameters, code, permissions }) {
  const manifest = validateToolManifest({ name, description, parameters, code, permissions })

  // 先编译，语法错误立即报告
  const executeFn = compileExecute(name, code, manifest.permissions)

  ensureToolsDir()

  const meta = {
    name: manifest.name,
    description: manifest.description,
    parameters: manifest.parameters,
    permissions: manifest.permissions,
    code: manifest.code,
    installed_at: new Date().toISOString(),
  }
  fs.writeFileSync(
    path.join(TOOLS_DIR, `${name}.json`),
    JSON.stringify(meta, null, 2),
    'utf-8',
  )

  registry.set(manifest.name, { schema: buildSchema(manifest.name, manifest.description, manifest.parameters), execute: executeFn })
  console.log(`[marketplace] 工具 "${manifest.name}" 安装完成`)
  return `工具 "${manifest.name}" 安装成功。下一轮对话起即可调用。`
}

export function uninstallTool({ name }) {
  if (!name) throw new Error('name 不能为空')
  if (!registry.has(name)) return `工具 "${name}" 未安装。`

  registry.delete(name)

  const filePath = path.join(TOOLS_DIR, `${name}.json`)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

  console.log(`[marketplace] 工具 "${name}" 已卸载`)
  return `工具 "${name}" 已卸载。`
}

export function listInstalledTools() {
  return [...registry.entries()].map(([name, { schema }]) => ({
    name,
    description: schema.function.description,
    source: 'installed',
  }))
}

export function getInstalledToolNames() {
  return [...registry.keys()]
}

export function getInstalledToolSchema(name) {
  return registry.get(name)?.schema ?? null
}

export function isInstalledTool(name) {
  return registry.has(name)
}

export async function executeInstalledTool(name, args) {
  const tool = registry.get(name)
  if (!tool) throw new Error(`已安装工具 "${name}" 不存在`)
  const result = await tool.execute(args)
  if (result === undefined || result === null) return `工具 "${name}" 执行完成（无返回值）`
  return typeof result === 'string' ? result : JSON.stringify(result)
}

// 启动时从磁盘加载所有已安装工具
export async function loadInstalledTools() {
  ensureToolsDir()
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.json'))
  const seenNames = new Set()
  let loaded = 0
  for (const file of files) {
    const filePath = path.join(TOOLS_DIR, file)
    try {
      const meta = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const { name, code } = meta
      if (!name || !code) {
        console.warn(`[marketplace] 跳过无效工具文件 ${file}`)
        continue
      }
      // 加载路径与安装路径同样过安全校验：磁盘上的改动不能绕过
      // analyzeToolCode；缺少 permissions 字段也不再等同于开启
      // legacyUnsafeGlobals——缺失时按默认安全权限 {network,exec}=false 处理。
      const manifest = validateToolManifest(meta)
      if (seenNames.has(manifest.name)) {
        console.warn(`[marketplace] 跳过重复工具名称 "${manifest.name}"（文件 ${file}）`)
        continue
      }
      seenNames.add(manifest.name)
      const executeFn = compileExecute(manifest.name, manifest.code, manifest.permissions)
      registry.set(manifest.name, {
        schema: buildSchema(manifest.name, manifest.description, manifest.parameters),
        execute: executeFn,
      })
      loaded++
    } catch (err) {
      console.warn(`[marketplace] 加载工具 ${file} 失败：${err.message}`)
    }
  }
  if (loaded > 0) console.log(`[marketplace] 已加载 ${loaded} 个已安装工具`)
}
