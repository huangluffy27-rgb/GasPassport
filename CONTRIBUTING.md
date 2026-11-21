# Contributing

## 分支

- `main`：可提交/可演示的稳定分支
- `feat/<短描述>`：新功能
- `fix/<短描述>`：缺陷修复
- `docs/<短描述>`：文档

## 提交信息

采用 Conventional Commits：

```
<type>(<scope>): <subject>
```

常用 `type`：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`。

示例：`feat(auction): add commit-reveal batch settlement`

## 代码约定

- Solidity：跟随 Foundry 默认格式（`forge fmt`），合约与事件命名沿用 OpenZeppelin 风格
- TypeScript：ESLint + Prettier，提交前本地跑一次
- 不提交密钥：RPC、私钥、API Key 一律走 `.env`（已在 `.gitignore` 中）

## PR 检查清单

- [ ] 本地可编译、可运行
- [ ] 新增逻辑有对应测试
- [ ] 未提交 `.env`、私钥或本地日志
- [ ] README / docs 中受影响的说明已同步

## Issue

- 缺陷用 Bug report 模板，附复现步骤与环境
- 新想法用 Feature request 模板，写清要解决的问题而不是只写方案
