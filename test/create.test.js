'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const commands = require('../lib/commands.js')
const workspace = require('../lib/workspace.js')

const BIN = path.join(__dirname, '..', 'bin', 'freedomagents.js')

function makeTemp(prefix = 'fa-create-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

/** 在指定目录内执行 CLI，捕获 console 输出 */
async function runIn(root, args) {
  const logs = []
  const errors = []
  const oldLog = console.log
  const oldError = console.error
  const oldCwd = process.cwd()
  console.log = (...items) => logs.push(items.map(String).join(' '))
  console.error = (...items) => errors.push(items.map(String).join(' '))
  process.chdir(root)
  try {
    const code = await commands.run(args)
    return { code, out: logs.join('\n'), err: errors.join('\n') }
  } finally {
    console.log = oldLog
    console.error = oldError
    process.chdir(oldCwd)
  }
}

/** 子进程执行 CLI：用文件描述符重定向，避免沙箱下的命名管道限制 */
function runChild(args, cwd, outDir) {
  return new Promise((resolve, reject) => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const outFile = path.join(outDir, `${stamp}.out.txt`)
    const errFile = path.join(outDir, `${stamp}.err.txt`)
    const outFd = fs.openSync(outFile, 'w')
    const errFd = fs.openSync(errFile, 'w')
    const child = spawn(process.execPath, [BIN, ...args], { cwd, stdio: ['ignore', outFd, errFd] })
    child.on('error', reject)
    child.on('exit', (code) => {
      fs.closeSync(outFd)
      fs.closeSync(errFd)
      resolve({ code, out: fs.readFileSync(outFile, 'utf8'), err: fs.readFileSync(errFile, 'utf8') })
    })
  })
}

function agentFiles(root) {
  const dir = path.join(root, 'agents')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith('.yaml'))
}

function readOnlyAgent(root) {
  const files = agentFiles(root)
  assert.equal(files.length, 1)
  const text = fs.readFileSync(path.join(root, 'agents', files[0]), 'utf8')
  return { fileName: files[0], meta: workspace.parseFlatYaml(text) }
}

test('create 自动初始化并写入 agents/<id>.yaml', async () => {
  const root = makeTemp()
  try {
    const result = await runIn(root, ['create', '--name', '前端小助手', '--harness', 'dsh'])
    assert.equal(result.code, 0)
    assert.match(result.out, /initialized/)
    assert.match(result.out, /created agent "前端小助手"/)

    assert.equal(fs.statSync(path.join(root, '.freedomagents')).isDirectory(), true)
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    assert.match(gitignore, /^\.freedomagents\/$/m)

    const { fileName, meta } = readOnlyAgent(root)
    assert.match(fileName, /^[0-9a-f]{8}\.yaml$/)
    assert.equal(meta.name, '前端小助手')
    assert.equal(meta.role, 'worker')
    assert.equal(meta.harness, 'dsh')
    assert.equal(`${meta.id}.yaml`, fileName)
    assert.match(meta.created_at, /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    cleanup(root)
  }
})

test('create 已初始化时不再打印 initialized', async () => {
  const root = makeTemp()
  try {
    await runIn(root, ['init'])
    const result = await runIn(root, ['create', '--name', 'a', '--harness', 'claude'])
    assert.equal(result.code, 0)
    assert.doesNotMatch(result.out, /initialized/)
  } finally {
    cleanup(root)
  }
})

test('缺少 --name / --harness 返回 1', async () => {
  const root = makeTemp()
  try {
    const missingName = await runIn(root, ['create', '--harness', 'dsh'])
    assert.equal(missingName.code, 1)
    assert.match(missingName.err, /缺少 --name/)

    const missingHarness = await runIn(root, ['create', '--name', 'x'])
    assert.equal(missingHarness.code, 1)
    assert.match(missingHarness.err, /缺少 --harness/)
  } finally {
    cleanup(root)
  }
})

test('未知参数返回 1', async () => {
  const root = makeTemp()
  try {
    const result = await runIn(root, ['create', '--agent', 'x', '--name', 'n', '--harness', 'dsh'])
    assert.equal(result.code, 1)
    assert.match(result.err, /未知参数: --agent/)
  } finally {
    cleanup(root)
  }
})

test('name 重复（大小写不敏感）返回 2', async () => {
  const root = makeTemp()
  try {
    const first = await runIn(root, ['create', '--name', 'Alice', '--harness', 'dsh'])
    assert.equal(first.code, 0)

    const second = await runIn(root, ['create', '--name', 'alice', '--harness', 'claude'])
    assert.equal(second.code, 2)
    assert.match(second.err, /已存在名为 "Alice" 的 agent/)
    assert.equal(agentFiles(root).length, 1)
  } finally {
    cleanup(root)
  }
})

test('role 默认 worker，自定义 role 规范化小写', async () => {
  const root = makeTemp()
  try {
    await runIn(root, ['create', '--name', '甲', '--harness', 'dsh'])
    const custom = await runIn(root, ['create', '--name', '乙', '--harness', 'DSH', '--role', 'Reviewer'])
    assert.equal(custom.code, 0)

    const agents = agentFiles(root).map((file) =>
      workspace.parseFlatYaml(fs.readFileSync(path.join(root, 'agents', file), 'utf8')),
    )
    const first = agents.find((agent) => agent.name === '甲')
    const second = agents.find((agent) => agent.name === '乙')
    assert.equal(first.role, 'worker')
    assert.equal(first.harness, 'dsh')
    assert.equal(second.role, 'reviewer')
    assert.equal(second.harness, 'dsh')
  } finally {
    cleanup(root)
  }
})

test('在子目录运行会使用上层仓库根', async () => {
  const root = makeTemp()
  try {
    await runIn(root, ['init'])
    const sub = path.join(root, 'src', 'utils')
    fs.mkdirSync(sub, { recursive: true })
    const result = await runIn(sub, ['create', '--name', 'sub-agent', '--harness', 'dsh'])
    assert.equal(result.code, 0)
    assert.equal(agentFiles(root).length, 1)
    assert.equal(fs.existsSync(path.join(sub, 'agents')), false)
  } finally {
    cleanup(root)
  }
})

test('--json 输出可解析且字段齐全', async () => {
  const root = makeTemp()
  try {
    const result = await runIn(root, ['create', '--name', 'json-agent', '--harness', 'dsh', '--json'])
    assert.equal(result.code, 0)
    const payload = JSON.parse(result.out)
    assert.equal(payload.ok, true)
    assert.equal(payload.name, 'json-agent')
    assert.equal(payload.role, 'worker')
    assert.equal(payload.harness, 'dsh')
    assert.match(payload.id, /^[0-9a-f]{8}$/)
    assert.match(payload.file, /^agents\/[0-9a-f]{8}\.yaml$/)
  } finally {
    cleanup(root)
  }
})

test('并发创建同名 agent：一个成功、一个冲突，最终只有一个', async () => {
  const root = makeTemp()
  const outDir = makeTemp('fa-create-out-')
  try {
    await runIn(root, ['init'])
    const [first, second] = await Promise.all([
      runChild(['create', '--name', 'dup', '--harness', 'dsh'], root, outDir),
      runChild(['create', '--name', 'dup', '--harness', 'claude'], root, outDir),
    ])
    const codes = [first.code, second.code].sort()
    assert.deepEqual(codes, [0, 2])
    assert.equal(agentFiles(root).length, 1)
  } finally {
    cleanup(root)
    cleanup(outDir)
  }
})
