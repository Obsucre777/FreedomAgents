'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const commands = require('../lib/commands.js')

function makeTemp(prefix = 'fa-init-') {
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

test('init 创建 .freedomagents/ 并写入 .gitignore', async () => {
  const root = makeTemp()
  try {
    const result = await runIn(root, ['init'])
    assert.equal(result.code, 0)
    assert.equal(fs.statSync(path.join(root, '.freedomagents')).isDirectory(), true)

    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    assert.match(gitignore, /^\.freedomagents\/$/m)
    assert.match(result.out, /initialized/)
    assert.match(result.out, /next: fa create/)
  } finally {
    cleanup(root)
  }
})

test('init 幂等：重复执行不重复写 .gitignore', async () => {
  const root = makeTemp()
  try {
    await runIn(root, ['init'])
    const second = await runIn(root, ['init'])
    assert.equal(second.code, 0)
    assert.match(second.out, /已初始化过/)

    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    const lines = gitignore.split(/\r?\n/).filter((line) => line.trim() === '.freedomagents/')
    assert.equal(lines.length, 1)
  } finally {
    cleanup(root)
  }
})

test('init 保留已有 .gitignore 内容', async () => {
  const root = makeTemp()
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n*.log')
    const result = await runIn(root, ['init'])
    assert.equal(result.code, 0)

    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    assert.match(gitignore, /^node_modules\/$/m)
    assert.match(gitignore, /^\*\.log$/m)
    assert.match(gitignore, /^\.freedomagents\/$/m)
    assert.equal(gitignore.endsWith('.freedomagents/\n'), true)
  } finally {
    cleanup(root)
  }
})

test('init --json 输出可解析的 JSON', async () => {
  const root = makeTemp()
  try {
    const result = await runIn(root, ['init', '--json'])
    assert.equal(result.code, 0)
    const payload = JSON.parse(result.out)
    assert.equal(payload.ok, true)
    assert.equal(payload.stateDir, '.freedomagents')
    assert.equal(payload.created, true)
    assert.equal(payload.gitignoreUpdated, true)
  } finally {
    cleanup(root)
  }
})

test('同名文件挡住 .freedomagents 目录时返回 2', async () => {
  const root = makeTemp()
  try {
    fs.writeFileSync(path.join(root, '.freedomagents'), 'not a directory')
    const result = await runIn(root, ['init'])
    assert.equal(result.code, 2)
    assert.match(result.err, /同名文件/)
  } finally {
    cleanup(root)
  }
})

test('未知命令返回 1', async () => {
  const root = makeTemp()
  try {
    const result = await runIn(root, ['nope'])
    assert.equal(result.code, 1)
    assert.match(result.err, /未知命令/)
  } finally {
    cleanup(root)
  }
})

test('help 与 --version 正常输出', async () => {
  const root = makeTemp()
  try {
    const help = await runIn(root, ['help'])
    assert.equal(help.code, 0)
    assert.match(help.out, /用法: fa <命令>/)

    const version = await runIn(root, ['--version'])
    assert.equal(version.code, 0)
    assert.match(version.out, /^\d+\.\d+\.\d+$/)
  } finally {
    cleanup(root)
  }
})
