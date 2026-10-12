// 出厂默认人格（全球长寿医学超级专家）测试。
// 纯 prompt 组装检查 —— 无数据库、无 LLM、无网络。
// 复用 test-prompt-split 的 ESM loader，stub 掉 agents/registry.js 的 SQLite 依赖。
//
// Run: node src/test-persona-default.js
import { register } from 'node:module'
register('./test-prompt-split-loader.mjs', import.meta.url)

const { buildSystemPrompt } = await import('./prompt.js')
const { DEFAULT_PERSONA } = await import('./persona-default.js')

let failed = 0
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; process.exitCode = 1 }
  else console.log(`PASS: ${label}`)
}

// 1) 默认人格文本本身
assert(DEFAULT_PERSONA.includes('长寿医学专家'), '默认人格点明长寿医学专家身份')
assert(DEFAULT_PERSONA.includes('证据等级'), '默认人格要求标注证据等级')
assert(DEFAULT_PERSONA.includes('不替代执业医师'), '默认人格含医疗边界（不替代面诊）')
assert(DEFAULT_PERSONA.includes('论文、文献与临床数据'), '默认人格点明通读论文/文献/临床数据')
assert(!DEFAULT_PERSONA.includes('[UPDATE_PERSONA'), '默认人格不含 marker 文本')

// 2) buildSystemPrompt 注入
{
  const p = buildSystemPrompt({
    agentName: '方舟大脑',
    persona: DEFAULT_PERSONA,
    birthTime: '2026-01-01',
    userMessage: '',
  })
  assert(p.includes('## Self Information'), '默认人格走 Self Information 段注入')
  assert(p.includes('长寿医学专家'), 'system prompt 含长寿医学专家身份')
  assert(p.includes('## Current Name'), 'system prompt 仍含 Current Name 段')
}

// 3) 空 persona 不注入 Self Information 段（保持向后兼容）
{
  const p = buildSystemPrompt({
    agentName: '方舟大脑',
    persona: '',
    birthTime: '2026-01-01',
    userMessage: '',
  })
  assert(!p.includes('## Self Information'), '空 persona 不注入 Self Information 段')
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
