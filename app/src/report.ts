import type { AirdropInsight, AlignedRow, Calibration, Insight, PageRow, SamplerStats, TestnetRow } from "./analyze.js";
import { PAGE_EXTRA } from "./analyze.js";
import type { ConfSummary } from "./conformal.js";
import type { AdvancedSummary } from "./advanced.js";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function barChart(rows: TestnetRow[]): string {
  const width = 680;
  const height = 280;
  const padX = 56;
  const padTop = 20;
  const padBottom = 44;
  const innerW = width - padX - 24;
  const innerH = height - padTop - padBottom;

  const modeled = rows.map((r) => ({
    count: r.count,
    contiguous: r.contiguous,
    scattered: r.scattered,
  }));
  const maxY = Math.max(...modeled.map((m) => Math.max(m.contiguous, m.scattered))) * 1.12;
  const scaleY = (v: number) => padTop + innerH - (v / maxY) * innerH;

  const groupW = innerW / modeled.length;
  const barW = Math.min(26, groupW * 0.3);
  const bars = modeled
    .map((m, i) => {
      const cx = padX + groupW * (i + 0.5);
      const y1 = scaleY(m.contiguous);
      const y2 = scaleY(m.scattered);
      return [
        `<rect x="${cx - barW - 3}" y="${y1}" width="${barW}" height="${padTop + innerH - y1}" fill="#94a3b8" rx="2"/>`,
        `<rect x="${cx + 3}" y="${y2}" width="${barW}" height="${padTop + innerH - y2}" fill="#2563eb" rx="2"/>`,
        `<text x="${cx}" y="${height - 20}" text-anchor="middle" class="axis">${m.count}</text>`,
      ].join("");
    })
    .join("");

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const y = padTop + innerH - t * innerH;
      return `<line x1="${padX}" y1="${y}" x2="${width - 24}" y2="${y}" stroke="#e2e8f0"/>
      <text x="${padX - 8}" y="${y + 4}" text-anchor="end" class="axis">${fmt(maxY * t / 1000)}k</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="页成本对比">
    ${grid}${bars}
    <text x="${padX}" y="${height - 2}" class="axis">写入次数（同页 vs 跨页，单位：千 gas）</text>
  </svg>`;
}

function convergenceChart(stats: SamplerStats[]): string {
  const width = 680;
  const height = 280;
  const padX = 56;
  const padTop = 20;
  const padBottom = 44;
  const innerW = width - padX - 24;
  const innerH = height - padTop - padBottom;

  const points = stats[0]?.convergence.map((c) => c.n) ?? [];
  const maxErr = Math.max(...stats.flatMap((s) => s.convergence.map((c) => c.error))) * 1.15;
  const scaleX = (n: number) => padX + (Math.log2(n) / Math.log2(points[points.length - 1] ?? 1)) * innerW;
  const scaleY = (e: number) => padTop + innerH - (e / maxErr) * innerH;
  const colors = ["#dc2626", "#2563eb", "#059669"];

  const lines = stats
    .map((s, idx) => {
      const d = s.convergence
        .map((c, i) => `${i === 0 ? "M" : "L"} ${scaleX(c.n).toFixed(1)} ${scaleY(c.error).toFixed(1)}`)
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="2"/>`;
    })
    .join("");

  const grid = [0, 0.5, 1]
    .map((t) => {
      const y = padTop + innerH - t * innerH;
      return `<line x1="${padX}" y1="${y}" x2="${width - 24}" y2="${y}" stroke="#e2e8f0"/>
      <text x="${padX - 8}" y="${y + 4}" text-anchor="end" class="axis">${(maxErr * t * 100).toFixed(1)}%</text>`;
    })
    .join("");

  const xLabels = points
    .map((n) => `<text x="${scaleX(n)}" y="${height - 20}" text-anchor="middle" class="axis">${n}</text>`)
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="收敛曲线">
    ${grid}${lines}${xLabels}
    <text x="${padX}" y="${height - 2}" class="axis">样本数 N（对数轴）· 相对全样本均值的误差</text>
  </svg>`;
}

export function renderReport(
  stats: SamplerStats[],
  pages: PageRow[],
  testnet: TestnetRow[],
  calibration: Calibration,
  insight: Insight,
  airStats: SamplerStats[],
  airInsight: AirdropInsight,
  pwConf: ConfSummary,
  airConf: ConfSummary,
  adv: AdvancedSummary,
  aligned: AlignedRow[],
  generatedAt: string,
): string {
  const worstBucket = pwConf.auto.buckets[pwConf.auto.buckets.length - 1];
  const bucketOverpay = worstBucket.buffer3x / worstBucket.limit - 1;
  const autoGain = 1 - pwConf.autoExpected / pwConf.fixedExpected;
  const statsRows = (list: SamplerStats[]) =>
    list
      .map(
        (s) => `<tr>
        <td>${s.sampler}</td>
        <td>${s.n}</td>
        <td>${fmt(s.mean)}</td>
        <td>${fmt(s.p50)}</td>
        <td>${fmt(s.p95)}</td>
        <td>${fmt(s.p99)}</td>
        <td>${fmt(s.max)}</td>
        <td>${fmt(s.ci95)}</td>
        <td>${pct(s.convergence[2]?.error ?? 0)}</td>
      </tr>`,
      )
      .join("");

  const rows = statsRows(stats);

  const pageRows = testnet
    .map((r) => {
      const perPage = r.count > 1 ? Math.round(r.diff / (r.count - 1)) : 0;
      return `<tr>
        <td>${r.count}</td>
        <td>${fmt(r.contiguous)}</td>
        <td>${fmt(r.scattered)}</td>
        <td>+${fmt(r.diff)}</td>
        <td>${perPage ? fmt(perPage) : "—"}</td>
      </tr>`;
    })
    .join("");

  const at16 = (name: string) => {
    const s = stats.find((x) => x.sampler === name);
    return s?.convergence.find((c) => c.n === 16)?.error ?? 0;
  };
  const convLine = `N=16 时，IET 的相对误差是 ${pct(at16("iet"))}，均匀随机是 ${pct(at16("uniform"))}。`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>GasPassport 报告 · Monad gas limit 体检</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; --accent:#2563eb; }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 24px; background:var(--bg); color:var(--ink);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif; line-height:1.65; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing:-0.02em; }
  h2 { font-size: 19px; margin: 40px 0 12px; }
  .sub { color: var(--muted); margin: 0 0 28px; font-size: 14px; }
  .cards { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:16px 18px; }
  .card .k { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
  .card .v { font-size:24px; font-weight:650; margin-top:4px; font-variant-numeric:tabular-nums; }
  .card .n { font-size:12px; color:var(--muted); margin-top:4px; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { padding:10px 12px; text-align:right; font-size:13px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  th:first-child, td:first-child { text-align:left; }
  th { background:#f1f5f9; font-weight:600; color:#334155; }
  tr:last-child td { border-bottom:none; }
  .chart { width:100%; height:auto; background:#fff; border:1px solid var(--line); border-radius:10px; padding:8px; }
  .axis { font-size:11px; fill:#64748b; font-family:inherit; }
  .note { background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:14px 16px; font-size:13px; color:#78350f; }
  .ok { background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; }
  code { background:#f1f5f9; padding:2px 5px; border-radius:4px; font-size:12px; }
  footer { margin-top:48px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>GasPassport 报告</h1>
  <p class="sub">Monad 合约函数的 gas limit 体检 · 生成于 ${generatedAt} · 1,536 条测试网原生采样</p>

  <div class="cards">
    <div class="card">
      <div class="k">小输入认证上限（${pwConf.auto.buckets[0].label} 次写）</div>
      <div class="v">${fmt(pwConf.auto.buckets[0].limit)}</div>
      <div class="n">全局上限 ${fmt(pwConf.auto.global.limit)}，收紧 ${pct(1 - pwConf.auto.buckets[0].limit / pwConf.auto.global.limit)}</div>
    </div>
    <div class="card">
      <div class="k">大输入认证上限（${worstBucket.label} 次写）</div>
      <div class="v">${fmt(worstBucket.limit)}</div>
      <div class="n">共形预测 99% 覆盖 · 留出集实测 ${pct(worstBucket.coverage)}</div>
    </div>
    <div class="card">
      <div class="k">跨页额外成本</div>
      <div class="v">+${fmt(insight.pageOverhead)}</div>
      <div class="n">${insight.countMax} 次写入，占同页基线 ${pct(insight.pageOverheadPct)}</div>
    </div>
  </div>

  <h2>为什么不是直接调 eth_estimateGas？</h2>
  <p class="sub">我们自己的真实交易校准证明：<code>estimateGas</code> 就是最小可行 limit。所以这个工具不跟它抢「单笔预估」，只补它覆盖不到的四类场景。</p>
  <table>
    <thead><tr><th>场景</th><th>每次调用 eth_estimateGas</th><th>GasPassport 预算认证表</th></tr></thead>
    <tbody>
      <tr><td>部署前 / CI 审计</td><td>函数还没部署，无法逐调用估算</td><td>state override 在未部署字节码上跑函数，按输入族出预算</td></tr>
      <tr><td>批量 / 代付 / AA</td><td>要逐笔模拟，延迟叠加</td><td>一次认证，运行时查表 0 次 RPC</td></tr>
      <tr><td>输入在签名后才确定</td><td>不知道参数，估不了</td><td>按输入规模分桶，每桶一个上限</td></tr>
      <tr><td>状态漂移与并发</td><td>只反映当前状态</td><td>分布上的覆盖保证，不是单点估值</td></tr>
    </tbody>
  </table>
  <p class="note">单笔、状态确定、能立即模拟的场景，直接 <code>eth_estimateGas</code> 更简单，这个工具不适用——把边界讲清楚比夸大适用范围更有用。</p>

  <h2>页成本：同一批写入，布局决定账单（Monad 测试网实测）</h2>
  ${barChart(testnet)}
  <table>
    <thead><tr><th>写入次数</th><th>同页 estimateGas</th><th>跨页 estimateGas</th><th>差额</th><th>每页增量</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table>
  <p class="note">口径：这一节全部来自 Monad 测试网 <code>eth_estimateGas</code> 实测。测量方式是把 PageWriter 的运行时字节码通过状态覆盖放到测试网地址上，模拟调用，不发交易、不需要测试币。n=8/16/32/64 的每页增量稳定在约 10,975 gas，比我们最初按文档估的 8,000 高约 37%。</p>

  <h2>硬件层含义：128 槽 = 4KB，不是抽象数字</h2>
  <p class="sub">128 × 32 字节 = 4,096 字节，正好是 OS 页、SSD 页和一次 NVMe 随机读的粒度。所以页成本既是 gas 规则，也是内存层次与存储 I/O 的成本。</p>
  <table>
    <thead><tr><th>措施</th><th>机制</th><th>预计收益（含假设）</th></tr></thead>
    <tbody>
      <tr><td>热状态页对齐</td><td>64 次散写从 64 页压到 1 页</td><td>gas −59.4%（实测 691,455）；每次调用状态页流量 256KB → 4KB（−98%）</td></tr>
      <tr><td>写合并 / 批处理</td><td>同一页的多次写共享一次页激活</td><td>存储型函数 gas −10–40%（假设批内地址可合并）</td></tr>
      <tr><td>页感知存储布局</td><td>常一起访问的变量排进同一 4KB 页</td><td>gas −20–60%；随机读 IOPS 降一个量级</td></tr>
      <tr><td>大页 / 页预取（节点层）</td><td>减少 TLB miss 与随机 I/O</td><td>节点级 5–15%；协议层，应用不可控</td></tr>
      <tr><td>GPU / 并行 EVM 采样</td><td>本地批量模拟，不走 RPC</td><td>采样吞吐 10–100×，不影响链上 gas</td></tr>
    </tbody>
  </table>
  <p class="note">按 10k TPS、每笔都做 64 页散写估算（上限口径）：状态页流量约 2.56 GB/s、随机读约 64 万 IOPS；页对齐后约 40 MB/s、1 万 IOPS。端到端 TPS 的提升取决于节点是否卡在存储：乐观 20–50%，保守 1.5–2×。这不是“省点 gas”，而是存储型合约能否在单节点跑满吞吐的分界。</p>

  <h2>页对齐实测：散列映射 vs 追加记录</h2>
  <p class="sub"><code>AlignedAirdrop</code> 用 <code>Entry[]</code> 追加写（address 20B + uint96 12B = 1 槽），32 条记录落在同一 4KB 页；<code>BatchAirdrop</code> 用 <code>mapping(address =&gt; uint256)</code>，每个地址的槽由 keccak 散列。两者都在测试网用 estimateGas 实测。</p>
  <table>
    <thead><tr><th>人数</th><th>散列映射</th><th>页对齐</th><th>差额</th><th>降幅</th></tr></thead>
    <tbody>
      ${aligned
        .map(
          (r) => `<tr><td>${r.count}</td><td>${fmt(r.mapping)}</td><td>${fmt(r.aligned)}</td><td>${fmt(r.diff)}</td><td>${pct(r.diffPct / 100)}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <p class="note">降幅低于“页数 32 → 1”的理论值（约 59%），原因是每个槽仍要付零→非零写入，页激活只是成本的一部分；页对齐同时省下的是状态 I/O 与缓存压力。代价：追加记录按用户查询需要索引或链下扫描，不能直接替代随机读写余额。</p>

  <h2>真实交易校准：estimateGas 就是最小可行 limit</h2>
  <table>
    <thead><tr><th>函数</th><th>写入次数</th><th>试探 limit</th><th>结果</th><th>回执 gasUsed</th></tr></thead>
    <tbody>
      ${calibration.rows
        .map(
          (r) => `<tr>
        <td>${r.fn}</td>
        <td>${r.count}</td>
        <td>${fmt(r.limit)}</td>
        <td>${r.status === "success" ? "成功" : "回滚"}</td>
        <td>${fmt(r.gasUsed)}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <p class="note">在测试网真实部署 <code>${calibration.contract.slice(0, 10)}…</code> 并发起 6 笔交易：0.97× estimateGas 全部回滚，1.00× 全部成功——<strong>estimateGas 就是最小可行 limit</strong>。回执的 <code>gasUsed</code> 恒等于 <code>gasLimit</code>（Monad 按 limit 扣费），所以真实成本只能靠二分试探，不能直接从回执读。散列那组因为部署后先跑了同页调用、有两个槽已预热，303,182 的差额是下限；冷状态估计的干净差值是 340,274（约 10,976 / 页）。</p>

  <h2>条件认证上限：按输入规模分桶的共形预测</h2>
  <p class="sub">全部样本改为测试网原生 <code>eth_estimateGas</code>（状态覆盖，不发交易），共 1,536 条。按输入规模分桶，偶数 iter 做校准、奇数 iter 做留出测试；上限取共形分位数（第 ⌈(n+1)×0.99⌉ 小），极值列用 GPD 外推 99.9% 并给 bootstrap 90% 区间。</p>
  <table>
    <thead><tr><th>输入规模</th><th>校准样本</th><th>99% 认证上限</th><th>留出覆盖</th><th>留出最大 gas</th><th>3x buffer</th><th>3x 覆盖</th><th>EVT 99.9%（90% CI）</th></tr></thead>
    <tbody>${pwConf.auto.buckets
      .map(
        (b) => `<tr>
        <td>${b.label}</td>
        <td>${b.nCal}</td>
        <td>${fmt(b.limit)}</td>
        <td>${pct(b.coverage)}</td>
        <td>${fmt(b.oracleMax)}</td>
        <td>${fmt(b.buffer3x)}</td>
        <td>${pct(b.bufferCoverage)}</td>
        <td>${fmt(b.evt999)} <span class="sub">[${fmt(b.evtLow)}, ${fmt(b.evtHigh)}]</span></td>
      </tr>`,
      )
      .join("")}</tbody>
  </table>
  <p class="sub">BatchAirdrop（写 N 个散列余额槽）</p>
  <table>
    <thead><tr><th>输入规模</th><th>校准样本</th><th>99% 认证上限</th><th>留出覆盖</th><th>留出最大 gas</th><th>3x buffer</th><th>3x 覆盖</th><th>EVT 99.9%（90% CI）</th></tr></thead>
    <tbody>${airConf.auto.buckets
      .map(
        (b) => `<tr>
        <td>${b.label}</td>
        <td>${b.nCal}</td>
        <td>${fmt(b.limit)}</td>
        <td>${pct(b.coverage)}</td>
        <td>${fmt(b.oracleMax)}</td>
        <td>${fmt(b.buffer3x)}</td>
        <td>${pct(b.bufferCoverage)}</td>
        <td>${fmt(b.evt999)} <span class="sub">[${fmt(b.evtLow)}, ${fmt(b.evtHigh)}]</span></td>
      </tr>`,
      )
      .join("")}</tbody>
  </table>
  <p class="note">分桶后大输入桶的上限 ${fmt(worstBucket.limit)}，留出覆盖 ${pct(worstBucket.coverage)}；全局共形上限 ${fmt(pwConf.auto.global.limit)}，覆盖 ${pct(pwConf.auto.global.coverage)}。条件版本在小输入上明显更紧，代价是需要知道这次调用落在哪个桶。</p>

  <h2>数据驱动桶边界</h2>
  <p class="sub">固定桶是手拍的（1–8 / 9–16 / …）。这里在<strong>校准半集</strong>上用动态规划选边界，目标是最小化期望超付 (limit − 均值) × 样本数，每桶至少 60 个校准样本；留出集只用于评估。</p>
  <table>
    <thead><tr><th>目标</th><th>固定桶期望上限</th><th>数据驱动期望上限</th><th>改善</th><th>固定覆盖</th><th>自动覆盖</th><th>选出的边界</th></tr></thead>
    <tbody>
      <tr>
        <td>PageWriter</td>
        <td>${fmt(pwConf.fixedExpected)}</td>
        <td>${fmt(pwConf.autoExpected)}</td>
        <td>${pct(autoGain)}</td>
        <td>${pct(pwConf.fixedCoverage)}</td>
        <td>${pct(pwConf.autoCoverage)}</td>
        <td>${pwConf.buckets.map((b) => b.label).join(" / ")}</td>
      </tr>
      <tr>
        <td>BatchAirdrop</td>
        <td>${fmt(airConf.fixedExpected)}</td>
        <td>${fmt(airConf.autoExpected)}</td>
        <td>${pct(1 - airConf.autoExpected / airConf.fixedExpected)}</td>
        <td>${pct(airConf.fixedCoverage)}</td>
        <td>${pct(airConf.autoCoverage)}</td>
        <td>${airConf.buckets.map((b) => b.label).join(" / ")}</td>
      </tr>
    </tbody>
  </table>
  <p class="note">边界只在校准集上选，避免用测试集调参；两个方案的留出覆盖率都在 99% 附近。改善来自把桶宽按 gas 曲线分配，而不是按 2 的幂手切。</p>

  <h2>进阶实验：条件覆盖、自动阈值、顺序停止、布局建议</h2>

  <h3>CV+ 比率共形</h3>
  <p class="sub">5 折交叉验证得到折外预测，分数取 <code>gas / pred</code>，再把共形分位数作用在比率上。相比分桶常数上限，它随输入规模平滑变化，更接近“给定输入特征”的条件覆盖。</p>
  <table>
    <thead><tr><th>目标</th><th>分桶期望上限</th><th>CV+ 期望上限</th><th>留出覆盖</th><th>最差桶内覆盖</th></tr></thead>
    <tbody>
      <tr><td>PageWriter</td><td>${fmt(pwConf.autoExpected)}</td><td>${fmt(adv.pw.ratio.expected)}</td><td>${pct(adv.pw.ratio.coverage)}</td><td>${pct(Math.min(...adv.pw.ratio.perBucket.map((b) => b.coverage)))}</td></tr>
      <tr><td>BatchAirdrop</td><td>${fmt(airConf.autoExpected)}</td><td>${fmt(adv.air.ratio.expected)}</td><td>${pct(adv.air.ratio.coverage)}</td><td>${pct(Math.min(...adv.air.ratio.perBucket.map((b) => b.coverage)))}</td></tr>
    </tbody>
  </table>

  <h3>自动阈值（GPD 的 ξ 稳定性）</h3>
  <p class="sub">在 50%–90% 分位里选 ξ 最接近中位数的阈值，替代手拍 80%。本次两个目标的 ξ 都为负（有界尾），自动阈值与固定 80% 的 99.9% 估计相差不到 1%——结论是：尾部不重时，阈值选择不敏感，外推本身会退化到观测最大值。</p>
  <table>
    <thead><tr><th>目标</th><th>选中阈值</th><th>ξ</th><th>99.9%（自动）</th><th>99.9%（固定 80%）</th></tr></thead>
    <tbody>
      <tr><td>PageWriter</td><td>${pct(adv.pw.evt.thresholdQ)}</td><td>${adv.pw.evt.xi.toFixed(3)}</td><td>${fmt(adv.pw.evt.q999)}</td><td>${fmt(adv.pw.evt.fixedQ999)}</td></tr>
      <tr><td>BatchAirdrop</td><td>${pct(adv.air.evt.thresholdQ)}</td><td>${adv.air.evt.xi.toFixed(3)}</td><td>${fmt(adv.air.evt.q999)}</td><td>${fmt(adv.air.evt.fixedQ999)}</td></tr>
    </tbody>
  </table>

  <h3>顺序停止</h3>
  <p class="sub">检查点 16/32/64/128/256，并集校正 α_k = 0.05/((k+1)(k+2))；上限连续两次变化 ≤5% 就停。</p>
  <table>
    <thead><tr><th>目标</th><th>停止样本数</th><th>停止时上限</th><th>留出覆盖</th><th>固定 256 上限</th><th>省下的样本</th></tr></thead>
    <tbody>
      <tr><td>PageWriter</td><td>${adv.pw.seq.stopN}</td><td>${fmt(adv.pw.seq.stopLimit)}</td><td>${pct(adv.pw.seq.coverage)}</td><td>${fmt(adv.pw.seq.fixedLimit)}</td><td>${pct(1 - adv.pw.seq.stopN / 256)}</td></tr>
      <tr><td>BatchAirdrop</td><td>${adv.air.seq.stopN}</td><td>${fmt(adv.air.seq.stopLimit)}</td><td>${pct(adv.air.seq.coverage)}</td><td>${fmt(adv.air.seq.fixedLimit)}</td><td>${pct(1 - adv.air.seq.stopN / 256)}</td></tr>
    </tbody>
  </table>
  <p class="note">停止点依赖数据，覆盖保证按“检查点并集”成立；同时要求样本数不少于 1/α−1（99% 时约 99 个），否则 max 的边际覆盖撑不起 99%。这是工程早停准则，不是逐时刻有效的置信序列。</p>

  <h3>页感知布局建议</h3>
  <table>
    <thead><tr><th>位置</th><th>现状</th><th>建议</th><th>页数</th><th>gas 变化</th></tr></thead>
    <tbody>
      ${adv.layout.items
        .map(
          (i) => `<tr><td>${i.contract}</td><td>${i.current}</td><td>${i.suggestion}</td><td>${i.pages}</td><td>${i.gas}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <ul class="sub">
    ${adv.layout.notes.map((n) => `<li>${n}</li>`).join("")}
  </ul>

  <h2>采样收敛：IET 比均匀随机更快贴近真值</h2>
  <p class="sub">灰=同页，蓝=跨页；线色：<span style="color:#dc2626">uniform</span> / <span style="color:#2563eb">iet</span> / <span style="color:#059669">logistic</span></p>
  ${convergenceChart(stats)}
  <p class="sub">${convLine}</p>
  <table>
    <thead><tr><th>采样器</th><th>N</th><th>均值</th><th>p50</th><th>p95</th><th>p99</th><th>max</th><th>均值 95% CI</th><th>N=64 误差</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>第二组目标：批量空投（页数来自真实存储轨迹）</h2>
  <p class="sub">认证上限见上面的 BatchAirdrop 表；这里保留采样收敛与分位数，用来说明不同采样器的效率差异。</p>
  ${convergenceChart(airStats)}
  <table>
    <thead><tr><th>采样器</th><th>N</th><th>均值</th><th>p50</th><th>p95</th><th>p99</th><th>max</th><th>均值 95% CI</th><th>N=64 误差</th></tr></thead>
    <tbody>${statsRows(airStats)}</tbody>
  </table>
  <p class="note">第二组目标的页数不是按公式推的，而是每次调用后用 <code>vm.record</code> / <code>vm.accesses</code> 读真实写入集合，再按 128 槽一页去重统计。每个地址的余额槽由 keccak 散列决定，基本一槽一页，所以空投人数直接放大页成本。</p>

  <h2>结论</h2>
  <div class="note ok">
    <strong>给这个函数的建议：</strong>按输入规模查表，33–64 次写用 <code>${fmt(worstBucket.limit)}</code>。
    这是共形分位数，留出集实测覆盖 ${pct(worstBucket.coverage)}；朴素的 3x 均值 buffer（${fmt(worstBucket.buffer3x)}）多付 ${pct(bucketOverpay)}。
    在 Monad 上 gas 按 limit 扣费且不退，这部分就是纯损耗。
  </div>
  <p class="note">最坏情况出现在 count=${insight.countMax}：跨页写入 ${insight.worstCase.pagesScattered} 页，对比同页 ${insight.worstCase.pagesContiguous} 页。
  峰值 gas 由输入结构（写入次数）和存储布局（页内/跨页）共同决定，均匀采样不保证碰到，所以先做最坏情况搜索再谈分布。分布与认证上限全部来自测试网原生 estimateGas，不再混用本地 gas。</p>

  <footer>GasPassport · 条件共形预测 + 极值理论 + 低差异采样 · 输入可复现</footer>
</div>
</body>
</html>`;
}
