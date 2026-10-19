'use strict'

/**
 * commands —— CLI 命令实现（init / create / help）
 */

const fs = require('node:fs')
const path = require('node:path')

const workspace = require('./workspace.js')
const pkg = require('../package.json')

const STATE_DIR = workspace.STATE_DIR

const USAGE = `FreedomAgents CLI v${pkg.version}

用法: fa <命令> [选项]

命令:
  init      初始化当前项目（创建 ${STATE_DIR}/，并写入 .gitignore）
  create    创建 agent
              必需: --name <名字>（不可重复）、--harness <name>
              可选: --role <role>（默认 worker）
  help      显示本帮助

选项:
  --json      输出机器可读的 JSON
  --version   显示版本号
`

const COMMON_FLAGS = new Set(['json', 'help', 'version'])
const CREATE_FLAGS = new Set(['name', 'role', 'harness'])

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--json') {
      args.json = true
    } else if (item === '--help' || item === '-h') {
      args.help = true
    } else if (item === '--version' || item === '-v') {
      args.version = true
    } else if (item.startsWith('--')) {
      const eq = item.indexOf('=')
      if (eq !== -1) {
        args[item.slice(2, eq)] = item.slice(eq + 1)
      } else {
        const key = item.slice(2)
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) {
          args[key] = true
        } else {
          args[key] = next
          i += 1
        }
      }
    } else {
      args._.push(item)
    }
  }
  return args
}

function usageError(message) {
  const err = new Error(message)
  err.exitCode = 1
  return err
}

function emit(args, humanLines, payload) {
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  for (const line of humanLines) console.log(line)
}

function validateFlags(args, allowed) {
  for (const key of Object.keys(args)) {
    if (key === '_') continue
    if (!COMMON_FLAGS.has(key) && !allowed.has(key)) {
      throw usageError(`未知参数: --${key}`)
    }
  }
}

function normalizeName(value) {
  if (typeof value !== 'string') {
    throw usageError('缺少 --name，例如: fa create --name 前端小助手 --harness dsh')
  }
  const name = value.trim()
  if (!name) throw usageError('--name 不能为空')
  if (name.length > 60) throw usageError('--name 最长 60 个字符')
  return name
}

function normalizeHarness(value) {
  if (typeof value !== 'string') {
    throw usageError('缺少 --harness，例如: fa create --name 前端小助手 --harness dsh')
  }
  const harness = value.trim().toLowerCase()
  if (!harness) throw usageError('--harness 不能为空')
  return harness
}

function normalizeRole(value) {
  if (value === undefined) return 'worker'
  if (typeof value !== 'string') throw usageError('--role 需要一个值')
  const role = value.trim().toLowerCase()
  if (!role) throw usageError('--role 不能为空')
  return role
}

function cmdInit(args) {
  validateFlags(args, new Set())

  const root = path.resolve(process.cwd())
  const statePath = workspace.stateDir(root)
  let created = false

  let exists = false
  try {
    exists = fs.statSync(statePath).isDirectory()
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  if (!exists) {
    let stat = null
    try {
      stat = fs.statSync(statePath)
    } catch {
      stat = null
    }
    if (stat) {
      const err = new Error(`已存在同名文件，无法创建目录: ${STATE_DIR}`)
      err.exitCode = 2
      throw err
    }
    fs.mkdirSync(statePath, { recursive: true })
    created = true
  }

  const gitignoreUpdated = workspace.ensureGitignore(root)

  const human = [
    created
      ? `initialized ${STATE_DIR}/ in ${root}`
      : `已初始化过 ${STATE_DIR}/，跳过创建`,
    ...(gitignoreUpdated ? [`  .gitignore: 已加入 ${STATE_DIR}/`] : []),
    'next: fa create --name <名字> --harness <name>',
  ]
  emit(args, human, { ok: true, root, stateDir: STATE_DIR, created, gitignoreUpdated })
  return 0
}

function cmdCreate(args) {
  validateFlags(args, CREATE_FLAGS)

  const name = normalizeName(args.name)
  const harness = normalizeHarness(args.harness)
  const role = normalizeRole(args.role)

  const cwd = path.resolve(process.cwd())
  let root = workspace.findRoot(cwd)
  let initialized = false

  // 首次 create：自动初始化当前目录
  if (!root) {
    root = cwd
    fs.mkdirSync(workspace.stateDir(root), { recursive: true })
    initialized = true
  }

  const created = workspace.withCreateLock(root, () => {
    if (initialized) workspace.ensureGitignore(root)

    const existing = workspace.listAgents(root)
    const lowerName = name.toLowerCase()
    const duplicate = existing.find(
      (agent) => String(agent.name || '').trim().toLowerCase() === lowerName,
    )
    if (duplicate) {
      const err = new Error(`已存在名为 "${duplicate.name}" 的 agent，请换一个名字`)
      err.exitCode = 2
      throw err
    }

    return workspace.writeAgent(root, { name, role, harness })
  })

  const relativeFile = path.relative(root, created.file).split(path.sep).join('/')
  const human = [
    ...(initialized ? [`initialized ${STATE_DIR}/ in ${root}`] : []),
    `created agent "${name}"`,
    `  id: ${created.id}`,
    `  role: ${role} | harness: ${harness}`,
    `  定义: ${relativeFile}`,
    'next: fa whoami',
  ]
  emit(args, human, {
    ok: true,
    root,
    initialized,
    id: created.id,
    name,
    role,
    harness,
    file: relativeFile,
  })
  return 0
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const command = args._[0]

  if (args.version) {
    console.log(pkg.version)
    return 0
  }
  if (args.help || !command || command === 'help') {
    console.log(USAGE)
    return 0
  }

  try {
    switch (command) {
      case 'init':
        return cmdInit(args)
      case 'create':
        return cmdCreate(args)
      default:
        throw usageError(`未知命令: ${command}（运行 fa help 查看用法）`)
    }
  } catch (err) {
    const code = err.exitCode || (err.code === 'EACCES' || err.code === 'EPERM' ? 4 : 1)
    if (args.json) console.error(JSON.stringify({ ok: false, code, error: err.message }))
    else console.error(`错误: ${err.message}`)
    return code
  }
}

module.exports = { run, parseArgs, USAGE, STATE_DIR }
