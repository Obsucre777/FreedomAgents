# FreedomAgents

> 一个跨Harness的多Agents协作

**FreedomAgents — cross-harness agents that belong to you.**

一个 CLI 优先、开源、可携带的多 Agent 协作框架：agent 的身份、任务、交接和记忆放在仓库里，harness 只是运行它的地方。

## 状态

v0.0.1 · 开发中。当前已实现：

- `fa init` —— 初始化当前项目（创建 `.freedomagents/`，并写入 `.gitignore`）
- `fa create` —— 创建一个 agent（写入 `agents/<id>.yaml`）

即将支持：`fa whoami`（查看当前身份）。

## 安装（开发期）

```powershell
git clone https://github.com/Obsucre777/FreedomAgents.git
cd FreedomAgents
npm link
```

需要 Node.js >= 20。

## 使用

```powershell
cd 你的项目
fa init
fa create --name 前端小助手 --harness dsh
```

- `fa init` 在项目根目录创建 `.freedomagents/`（本机运行状态目录，已自动加入 `.gitignore`），幂等，可重复执行。
- `fa create` 也可以在没有 `fa init` 的项目里直接运行，会自动初始化。
- agent 的 id 由系统生成（8 位随机字符），用户只需要起名字，且名字不能重复。
- `--role` 可选，默认 `worker`；`--harness` 必填（claude / dsh / codex / opencode / zcode …）。

## 开发

```powershell
npm test
```
