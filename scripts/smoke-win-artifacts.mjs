#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractFile, listPackage } from '@electron/asar'
import sharp from 'sharp'
import { assertPeX64, inspectWindowsSignature } from './build-win.mjs'
import { inspectExternalBlockmap } from './publish-updates-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const unpacked = path.join(root, 'dist', 'win-unpacked')
const exe = path.join(unpacked, 'ArkBrain-Agent.exe')
const resources = path.join(unpacked, 'resources')
const appAsar = path.join(resources, 'app.asar')
const appUnpacked = `${appAsar}.unpacked`
const installer = path.join(root, 'dist', `ArkBrain-Setup-${pkg.version}.exe`)
const latestYml = path.join(root, 'dist', 'latest.yml')
const blockmap = `${installer}.blockmap`
const requireSigning = process.argv.slice(2).includes('--require-signing')
const unknownArgs = process.argv.slice(2).filter(arg => arg !== '--require-signing')
if (unknownArgs.length > 0) throw new Error(`Unknown argument(s): ${unknownArgs.join(', ')}`)

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows artifact smoke requires Windows x64, got ${process.platform}-${process.arch}`)
}

for (const [file, label] of [
  [exe, 'packaged app'],
  [appAsar, 'app.asar'],
  [installer, 'NSIS installer'],
  [blockmap, 'NSIS blockmap'],
  [latestYml, 'latest.yml'],
]) {
  assert.ok(fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0, `${label} is missing or empty: ${file}`)
}
assertPeX64(exe, 'packaged ArkBrain-Agent executable')
assertPeX64(path.join(resources, 'node-runtime', 'node.exe'), 'bundled Node runtime')
assertPeX64(path.join(appUnpacked, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'), 'packaged better-sqlite3 binding')
assertPeX64(path.join(appUnpacked, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'win32', 'x64', 'onnxruntime_binding.node'), 'packaged ONNX Runtime binding')
inspectExternalBlockmap(blockmap)

if (requireSigning) {
  const signature = inspectWindowsSignature(installer)
  assert.equal(String(signature.Status).toLowerCase(), 'valid',
    `Windows installer must have a valid Authenticode signature: ${signature.StatusMessage || signature.Status}`)
}

assert.equal(fs.existsSync(path.join(appUnpacked, 'build', 'native-speech-recognizer')), false,
  'Windows package must not contain the macOS native speech helper')

const entries = new Set(listPackage(appAsar).map(entry => entry.replaceAll('\\', '/')))
for (const forbiddenPrefix of [
  '/.dev-test',
  '/data',
  '/sandbox',
  '/images',
  '/node_modules/onnxruntime-node/bin/napi-v3/darwin',
  '/node_modules/onnxruntime-node/bin/napi-v3/linux',
  '/node_modules/onnxruntime-node/bin/napi-v3/win32/arm64',
  '/node_modules/sherpa-onnx-darwin-',
  '/node_modules/sherpa-onnx-linux-',
]) {
  assert.equal([...entries].some(entry => entry.startsWith(forbiddenPrefix)), false,
    `Windows package contains forbidden content: ${forbiddenPrefix}`)
}
for (const required of [
  '/package.json',
  '/electron/main.cjs',
  '/src/index.js',
  '/src/device-information-scanner.js',
  // src/api.js 静态引入 routes/ruimeiyun.js → bridge/*；bridge 漏打进 asar 会让
  // 安装后的应用启动即崩（beta.1 实机踩坑），这里把 bridge 列为硬性条目
  '/bridge/cockpit.js',
  '/bridge/ruimeiyun-client.js',
  '/node_modules/better-sqlite3/package.json',
  '/node_modules/sharp/package.json',
  '/node_modules/sherpa-onnx-node/package.json',
]) {
  assert.ok(entries.has(required), `required packaged entry is missing: ${required}`)
}
// 凭据文件绝不进包（gitignore 双保险：即便本地存在也不会被打进去）
for (const forbidden of ['/bridge/accounts.json', '/bridge/bridge-audit.log']) {
  assert.equal(entries.has(forbidden), false, `packaged app must not contain ${forbidden}`)
}
const packagedPkg = JSON.parse(extractFile(appAsar, 'package.json').toString('utf8'))
assert.equal(packagedPkg.version, pkg.version, 'packaged version does not match package.json')

function probeModule(label, source) {
  const result = spawnSync(exe, ['-e', source], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ARKBRAIN_SMOKE_APP_ASAR: appAsar },
  })
  assert.equal(result.status, 0, `${label} probe failed:\n${result.stdout || ''}\n${result.stderr || ''}`)
}

const requirePrelude = "const {createRequire}=require('node:module');const r=createRequire(require('node:path').join(process.env.ARKBRAIN_SMOKE_APP_ASAR,'package.json'));"
probeModule('better-sqlite3', `${requirePrelude}const D=r('better-sqlite3');const d=new D(':memory:');d.exec('select 1');d.close();`)
probeModule('sharp', `${requirePrelude}const s=r('sharp');if(!s.versions?.sharp)throw new Error('sharp version unavailable');`)
probeModule('sherpa-onnx', `${requirePrelude}const s=r('sherpa-onnx-node');if(!s)throw new Error('sherpa unavailable');`)

// ESM 模块图探针：require 探不到 ESM 依赖缺失。按打包后的真实路径 import
// 睿美云路由（连带加载 src/api/routes/ruimeiyun.js → bridge/*）—— beta.1 的
// 启动崩溃正是这条链上 bridge/ 未进 asar，这里让它在 CI 就红。
function probeEsm(label, relPath) {
  const target = pathToFileURL(path.join(appAsar, relPath)).href
  const source = `import(${JSON.stringify(target)}).catch(e=>{console.error(e && e.stack || e);process.exit(1)})`
  const result = spawnSync(exe, ['-e', source], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  assert.equal(result.status, 0, `${label} ESM probe failed:\n${result.stdout || ''}${result.stderr || ''}`)
}
probeEsm('ruimeiyun route chain', 'src/api/routes/ruimeiyun.js')

// 品牌守卫：app 图标必须是方舟大脑的暗色底 —— 防旧 BaiLongma 蓝底图标回流。
// 取 ICO 里最大的 PNG 帧，缩到 16px 后采样 4 个角落背景点。
// 圆角半径 22%×16≈3px，(2,2)/(13,·)/(·,13) 到圆角圆心距 <3 → 内容区不透明，
// 但仍是角落背景像素。别用靠内点 [5,5] 等 —— 那会落在图标中心图形上
// （ArkBrain 图形标中心是发光船体/脑网络，内点采样必然超亮 → 误报）。
function largestIcoPngFrame(buf) {
  const count = buf.readUInt16LE(4)
  let best = null
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16
    const size = buf.readUInt32LE(entry + 8)
    const offset = buf.readUInt32LE(entry + 12)
    if (buf.readUInt32LE(offset) !== 0x474e5089) continue // \x89PNG 小端
    if (!best || size > best.size) best = { size, offset }
  }
  assert.ok(best, 'packaged build/icon.ico contains no PNG frame')
  return buf.subarray(best.offset, best.offset + best.size)
}
const icoFrame = largestIcoPngFrame(extractFile(appAsar, 'build/icon.ico'))
const { data: icoPixels } = await sharp(icoFrame)
  .resize(16, 16, { fit: 'fill' })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) {
  const i = (y * 16 + x) * 4
  const rgb = [icoPixels[i], icoPixels[i + 1], icoPixels[i + 2]]
  const maxChannel = Math.max(...rgb)
  assert.ok(maxChannel < 100,
    `packaged app icon background too bright at (${x},${y}) rgb=${rgb.join(',')} — ` +
    'expected ArkBrain dark background (old Bailongma icon is bright blue)')
}

const latest = fs.readFileSync(latestYml, 'utf8')
assert.match(latest, new RegExp(`version:\\s*['\"]?${pkg.version.replaceAll('.', '\\.')}`))
assert.ok(latest.includes(path.basename(installer)), 'latest.yml does not reference this version installer')

console.log(JSON.stringify({
  ok: true,
  version: pkg.version,
  platform: process.platform,
  arch: process.arch,
  installer,
  installerBytes: fs.statSync(installer).size,
}, null, 2))
