# Monad Product Lab

面向 Monad 生态的产品原型仓库。当前方向已选定 **Contend**（并行执行冲突诊断器），正在实现诊断器内核；三个候选方向的完整论证见 [docs/方案对比.md](docs/方案对比.md)。

## 候选方向

| # | 代号 | 一句话 | 类型 |
|---|------|--------|------|
| 1 | **Contend** | 并行执行冲突诊断 + 合约改造建议 + CI 并行度门禁 | 开发者工具 |
| 2 | **StreamPay** | 面向 AI Agent / API 的按调用流式微支付 | 支付协议 |
| 3 | **FairBatch** | 加密订单流 + 亚秒批量拍卖，把 MEV 收益还给 LP | 交易基础设施 |

每个方向的「问题定义 / 方案 / 为什么必须是 Monad / 创新点 / MVP 边界 / 验证指标 / 风险」见 [docs/方案对比.md](docs/方案对比.md)。

## 仓库结构

```
.
├── contracts/        # Foundry 工程：NaiveToken / ShardedToken 对照合约
├── app/              # TypeScript：诊断器 CLI（脚手架）
├── scripts/          # 部署与运维脚本
├── docs/             # 方案与设计文档
├── .github/          # Issue / PR 模板
└── .vscode/          # 推荐的编辑器配置
```

## 对照合约

| 合约 | 状态布局 | 1000 笔领取时的冲突 |
|---|---|---|
| `NaiveToken` | 资金池余额是单个槽 `balanceOf[address(this)]` | 全部撞在同一槽，串行 |
| `ShardedToken` | 资金池拆成 8 个槽 `poolBalance[shard]` | 最多 8 路并行 |

两者对外语义一致（`claim` / `transfer` / `balanceOf`），差别只在资金池状态的布局，用来做「同一业务、不同并行度」的对照。

## 本地开发

合约：

```bash
cd contracts
forge install foundry-rs/forge-std   # 首次拉取依赖
forge build
forge test
```

诊断器 CLI：

```bash
cd app
npm install
npm run build
node dist/index.js
```

## 状态

- [x] 仓库骨架（README / LICENSE / CONTRIBUTING / Issue 模板）
- [x] 方向选型（Contend）
- [x] 技术栈初始化（Foundry + TypeScript）
- [x] 对照合约与测试（NaiveToken / ShardedToken，9 个测试通过）
- [ ] 诊断器内核：采集 SLOAD / SSTORE，构建冲突图，计算并行度
- [ ] 演示与提交材料

## 许可

[MIT](LICENSE)
