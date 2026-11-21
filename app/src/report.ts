import type { AirdropInsight, Calibration, Insight, PageRow, SamplerStats, TestnetRow } from "./analyze.js";
import { PAGE_EXTRA } from "./analyze.js";
import type { TargetReport } from "./conformal.js";

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
  pwConf: TargetReport,
  airConf: TargetReport,
  generatedAt: string,
): string {
  const worstBucket = pwConf.buckets[pwConf.buckets.length - 1];
  const bucketOverpay = worstBucket.buffer3x / worstBucket.limit - 1;
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
<title>ChaosGas 报告 · Monad gas limit 体检</title>
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
  <h1>ChaosGas 报告</h1>
  <p class="sub">Monad 合约函数的 gas limit 体检 · 生成于 ${generatedAt} · 1,536 条测试网原生采样</p>

  <div class="cards">
    <div class="card">
      <div class="k">小输入认证上限（1–8 次写）</div>
      <div class="v">${fmt(pwConf.buckets[0].limit)}</div>
      <div class="n">全局上限 ${fmt(pwConf.global.limit)}，收紧 ${pct(1 - pwConf.buckets[0].limit / pwConf.global.limit)}</div>
    </div>
    <div class="card">
      <div class="k">大输入认证上限（33–64 次写）</div>
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
    <thead><tr><th>场景</th><th>每次调用 eth_estimateGas</th><th>ChaosGas 预算认证表</th></tr></thead>
    <tbody>
      <tr><td>部署前 / CI 审计</td><td>合约还没上链，调不了</td><td>给定函数与输入族，部署前产出上限</td></tr>
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
    <tbody>${pwConf.buckets
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
    <tbody>${airConf.buckets
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
  <p class="note">分桶后 33–64 次写的上限 ${fmt(worstBucket.limit)}，留出覆盖 ${pct(worstBucket.coverage)}；全局共形上限 ${fmt(pwConf.global.limit)}，覆盖 ${pct(pwConf.global.coverage)}。条件版本在小输入上明显更紧，代价是需要知道这次调用落在哪个桶。</p>

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

  <footer>ChaosGas · 条件共形预测 + 极值理论 + 低差异采样 · 输入可复现</footer>
</div>
</body>
</html>`;
}
