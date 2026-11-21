# ChaosGas

给 Monad 合约的每个函数算一个**有统计依据的 gas limit**。面向高频合约、全链游戏、Agent 支付这类一天几十万笔调用的项目：limit 设高每一笔都在漏钱，设低整笔失败还照扣。

> 一句话：用确定性混沌、区间交换变换、蒙特卡洛与大数定律，把「gas 该设多少」从拍脑袋变成可复现的统计结论。

## 问题

Monad 上有两条和以太坊不同的成本规则：

1. **按 `gas_limit` 扣费，不退多余 gas**。limit 写 3,000,000、实际用 200,000，差额照扣。
2. **存储按 128 个连续槽一页预热**（MIP-8）：一页首次访问 8,100 gas，同页后续 100 gas，跨页再付一次。状态布局直接决定账单。

开发者通常按「均值 × 3」拍一个固定 buffer，既没有覆盖保证，也不区分输入结构和存储布局。

## 做法

1. **采样**：三种可复现的输入生成器，同一个种子在任何机器上跑出同一组序列
   - `uniform`：keccak PRNG 均匀随机（基线）
   - `iet`：黄金比例低差异序列 + 区间交换变换（IET），小样本下更快铺满区间
   - `logistic`：`x ← 3.99·x·(1−x)` 确定性混沌映射
2. **实测**：在 Foundry 里对每个输入真实调用目标函数，用 `gasleft()` 记录 EVM 执行 gas
3. **建模**：按 MIP-8 参数补上页成本（每多一页 +8,000 gas）
4. **统计**：蒙特卡洛估计分布，用 N 个样本的最大值作为经验分位数上界（覆盖约 `1 − 1/(N+1)`），再留 5% 余量给出推荐 limit
5. **报告**：输出分位数、收敛曲线、页成本对照、推荐值与朴素 3x buffer 的差额

## 本仓库的实测结果

样本 512 / 采样器，目标合约 `PageWriter`：

| 指标 | 数值 |
|---|---|
| 最坏情况（64 次写）同页 | 1,467,985 gas |
| 最坏情况（64 次写）跨页 | 1,977,595 gas |
| 跨页额外成本 | +509,610 gas（+34.7%） |
| 推荐 gas limit | 2,076,475（经验覆盖 99.8%） |
| 朴素 3x buffer | 3,119,766（多付 50.2%） |
| N=16 收敛误差 | IET 1.76% vs 均匀随机 16.93% |

完整报告：[contracts/reports/report.html](contracts/reports/report.html)，预览图 [docs/report-preview.png](docs/report-preview.png)。

## 快速开始

```bash
# 1. 合约与采样 campaign（首次需 forge install foundry-rs/forge-std）
cd contracts
forge test --match-path test/ChaosGas.t.sol

# 2. 分析与报告
cd ../app
npm install
npm run build
node dist/index.js
```

报告输出到 `contracts/reports/report.html`。

## 仓库结构

```
contracts/
├── src/PageWriter.sol      # 同页连续写 vs 跨页散布写
├── src/Chaos.sol           # uniform / IET / logistic 三种采样器
├── test/ChaosGas.t.sol     # 采样 campaign，输出 CSV
└── reports/                # 采样数据与 HTML 报告
app/
├── src/analyze.ts          # 分位数、收敛、页成本建模
├── src/report.ts           # 自包含 HTML 报告
└── src/index.ts            # CLI
```

## 口径与限制

- EVM 执行 gas 由 Foundry 实测；**Monad 页成本是按 MIP-8 参数建模**，不是链上实测值，正式使用前应在 Monad 测试网复核。
- 当前 demo 的目标函数是 `PageWriter.writeScattered`，页数随写入次数线性增长；接入真实合约时，页数应从存储访问轨迹里统计，而不是按公式推断。
- 经验分位数依赖样本量：N=512 时 max 只覆盖约 99.8%，不要把它当成 99.99% 的保证。

## 许可

[MIT](LICENSE)
