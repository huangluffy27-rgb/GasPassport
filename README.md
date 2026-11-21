# ChaosGas

给 Monad 合约的每个函数算一张**有覆盖保证的 gas 预算表**：按输入规模分桶，每桶一个认证上限。

它不跟 `eth_estimateGas` 抢「单笔预估」——我们自己的真实交易校准证明 `estimateGas` 就是最小可行 limit。它补的是 `estimateGas` 覆盖不到的场景：

| 场景 | 每次调 `eth_estimateGas` | ChaosGas 预算表 |
|---|---|---|
| 部署前 / CI 审计 | 合约还没上链，调不了 | 给定函数与输入族，部署前产出上限 |
| 批量 / 代付 / AA | 逐笔模拟，延迟叠加 | 一次认证，运行时查表 0 次 RPC |
| 输入在签名后才确定 | 不知道参数，估不了 | 按输入规模分桶，每桶一个上限 |
| 状态漂移与并发 | 只反映当前状态 | 分布上的覆盖保证，不是单点估值 |

单笔、状态确定、能立即模拟的场景，直接 `eth_estimateGas` 更简单，这个工具不适用。

## 方法

1. **测试网原生采样**：把目标合约的运行时字节码通过 `eth_estimateGas` 的 state override 挂到 Monad 测试网地址上模拟调用，不发交易、不需要私钥。共 1,536 条样本，gas 全部来自节点，不混用本地 EVM 口径。
2. **条件共形预测**：按输入规模分桶，偶数 iter 做校准、奇数 iter 做留出测试。上限取共形分位数（第 ⌈(n+1)×0.99⌉ 小），得到有限样本、分布无关的 99% 覆盖保证。
3. **极值理论外推**：对超过 80% 分位的尾部拟合广义帕累托分布（矩估计），外推 99.9% 分位并给 bootstrap 90% 区间——样本量撑不起 99.9% 时，这是唯一诚实的外推方式。
4. **页成本测量**：用 `vm.record` / `vm.accesses` 从真实写入轨迹统计 128 槽页数，再看同页与跨页的 gas 差。

## 实测结果

### 条件认证上限（99% 覆盖）

`PageWriter.writeScattered`：

| 输入规模 | 认证上限 | 留出覆盖 | 3x buffer | 3x 覆盖 | EVT 99.9%（90% CI） |
|---|---|---|---|---|---|
| 1–8 | 266,946 | 100% | 479,670 | 100% | 266,946 |
| 9–16 | 493,837 | 100% | 1,144,447 | 100% | 493,837 |
| 17–32 | 947,618 | 100% | 2,213,437 | 100% | 947,618 |
| 33–64 | 1,855,180 | 100% | 4,378,193 | 100% | 1,855,180 |

`BatchAirdrop.airdrop`：

| 输入规模 | 认证上限 | 留出覆盖 | 3x buffer | 3x 覆盖 | EVT 99.9%（90% CI） |
|---|---|---|---|---|---|
| 1–8 | 255,576 | 100% | 451,305 | 100% | 428,223 [311,505, 464,273] |
| 9–16 | 487,821 | 100% | 1,161,230 | 100% | 511,618 [492,638, 582,623] |
| 17–32 | 952,311 | 100% | 2,272,478 | 100% | 955,132 [952,311, 962,748] |

小输入如果用全局上限（1,855,180），会比自己的认证上限多付约 85%；固定 3x buffer 在 1–8 桶多付约 80%。这就是「条件覆盖」的价值：不同输入规模不该共用一个上限。

### 页成本（Monad 测试网实测）

| 写入次数 | 同页 estimateGas | 跨页 estimateGas | 差额 | 每页增量 |
|---|---|---|---|---|
| 1 | 67,501 | 67,568 | +67 | — |
| 8 | 190,059 | 266,946 | +76,887 | 10,983 |
| 16 | 329,154 | 493,837 | +164,683 | 10,979 |
| 32 | 607,344 | 947,618 | +340,274 | 10,976 |
| 64 | 1,163,725 | 1,855,180 | +691,455 | 10,975 |

### 真实交易校准

部署 `PageWriter` 后发了 6 笔真实交易：

- `0.97× estimateGas` 全部回滚，`1.00×` 全部成功 → **estimateGas 就是最小可行 limit**
- 回执 `gasUsed` 恒等于 `gasLimit`（Monad 按 limit 扣费），所以真实成本只能二分试探，不能直接读回执

完整报告：[docs/index.html](docs/index.html)（GitHub Pages），预览图 [docs/report-preview.png](docs/report-preview.png)。

## 快速开始

```bash
# 1. 编译与本地对照实验（首次需 forge install foundry-rs/forge-std）
cd contracts
forge test --match-path test/ChaosGas.t.sol

# 2. 测试网原生采样（需要 viem）
cd ..
npm i viem --no-save
node scripts/sample_testnet.mjs

# 3. 生成报告
cd app
npm install
npm run build
node dist/index.js
```

## 仓库结构

```
contracts/
├── src/PageWriter.sol      # 同页连续写 vs 跨页散布写
├── src/BatchAirdrop.sol    # 批量空投，散列余额槽
├── src/Chaos.sol           # uniform / IET / logistic 三种采样器
├── test/ChaosGas.t.sol     # 本地 campaign，输出 CSV
└── reports/                # 测试网采样、页成本、校准数据
app/
├── src/analyze.ts          # 分位数、收敛、页成本
├── src/conformal.ts        # 条件共形预测 + EVT 外推
├── src/report.ts           # 自包含 HTML 报告
└── src/index.ts            # CLI
scripts/
├── sample_testnet.mjs      # 测试网原生采样（state override）
├── measure_monad_page_cost.ps1
└── calibrate_receipts.mjs  # 真实交易校准
```

## 口径与限制

- 认证上限是 99% 覆盖，不是 100%；极端输入仍可能超出，超出即整笔失败且照扣 limit。
- 分桶边界是人为选的（1–8 / 9–16 / 17–32 / 33–64），换合约需要重新定义桶。
- 页数来自当前交易的写入轨迹，跨交易的状态预热不在统计范围内。
- EVT 外推在样本尾部不够重时会退化到观测最大值，这是有意的保守处理。

## 许可

[MIT](LICENSE)
