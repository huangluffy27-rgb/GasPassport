/**
 * 条件共形预测 + 极值理论尾部外推。
 *
 * 共形分位数：在可交换样本下，取第 ceil((n+1)(1-α)) 小的分数，即可得到
 * 有限样本、分布无关的 1-α 覆盖保证（Vovk et al.）。
 * 分桶是为了条件覆盖：不同输入规模不该共用一个上限。
 *
 * 极值外推：对超过 80% 分位的尾部拟合广义帕累托分布（矩估计），
 * 外推 99.9% 分位并用 bootstrap 给区间。样本量撑不起 99.9% 时，这是唯一诚实的做法。
 */

export type Row = {
  target: string;
  sampler: string;
  iter: number;
  count: number;
  pages: number;
  gas: number;
};

export type Bucket = { label: string; min: number; max: number };

export type BucketResult = {
  label: string;
  nCal: number;
  nTest: number;
  limit: number;
  coverage: number;
  oracleMax: number;
  buffer3x: number;
  bufferCoverage: number;
  evt999: number;
  evtLow: number;
  evtHigh: number;
};

export type TargetReport = {
  target: string;
  global: BucketResult;
  buckets: BucketResult[];
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** 共形分位数：第 ceil((n+1)(1-α)) 小的分数 */
export function conformalLimit(cal: number[], alpha: number): number {
  const sorted = [...cal].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length + 1) * (1 - alpha)) - 1));
  return sorted[idx];
}

/** 广义帕累托（矩估计）分位数外推 */
export function evtQuantile(cal: number[], p: number, bootstrap = 200): { q: number; low: number; high: number } {
  const sorted = [...cal].sort((a, b) => a - b);
  const u = quantile(sorted, 0.8);
  const excess = sorted.filter((x) => x > u).map((x) => x - u);
  if (excess.length < 8) return { q: sorted[sorted.length - 1], low: sorted[sorted.length - 1], high: sorted[sorted.length - 1] };

  const fit = (xs: number[]) => {
    const m = mean(xs);
    const v = mean(xs.map((x) => (x - m) ** 2));
    if (v <= 0 || m <= 0) return { q: u + m * Math.log(excess.length / (sorted.length * (1 - p))) };
    const xi = 0.5 * (1 - (m * m) / v);
    const beta = 0.5 * m * ((m * m) / v + 1);
    const n = sorted.length;
    const ratio = (excess.length / n) * (1 - p);
    const q = Math.abs(xi) < 1e-6 ? u + beta * Math.log(1 / ratio) : u + (beta / xi) * (Math.pow(ratio, -xi) - 1);
    return { q };
  };

  const base = fit(excess).q;
  const samples: number[] = [];
  for (let b = 0; b < bootstrap; b++) {
    const resample = Array.from({ length: excess.length }, () => excess[Math.floor(Math.random() * excess.length)]);
    samples.push(fit(resample).q);
  }
  samples.sort((a, b) => a - b);
  const q = Math.max(base, sorted[sorted.length - 1]);
  return {
    q,
    low: Math.min(q, Math.max(samples[Math.floor(bootstrap * 0.05)], sorted[sorted.length - 1])),
    high: Math.max(q, samples[Math.floor(bootstrap * 0.95)]),
  };
}

function evaluateBucket(label: string, rows: Row[], alpha: number): BucketResult {
  // 按 iter 奇偶切分校准/测试，保证三个采样器均衡
  const cal = rows.filter((r) => r.iter % 2 === 0).map((r) => r.gas);
  const test = rows.filter((r) => r.iter % 2 === 1).map((r) => r.gas);
  const limit = conformalLimit(cal, alpha);
  const coverage = test.filter((g) => g <= limit).length / Math.max(1, test.length);
  const buffer3x = Math.ceil(mean(cal) * 3);
  const evt = evtQuantile(cal, 0.999);

  return {
    label,
    nCal: cal.length,
    nTest: test.length,
    limit,
    coverage,
    oracleMax: Math.max(...test),
    buffer3x,
    bufferCoverage: test.filter((g) => g <= buffer3x).length / Math.max(1, test.length),
    evt999: Math.ceil(evt.q),
    evtLow: Math.ceil(evt.low),
    evtHigh: Math.ceil(evt.high),
  };
}

const BUCKETS: Record<string, Bucket[]> = {
  PageWriter: [
    { label: "1–8", min: 1, max: 8 },
    { label: "9–16", min: 9, max: 16 },
    { label: "17–32", min: 17, max: 32 },
    { label: "33–64", min: 33, max: 64 },
  ],
  BatchAirdrop: [
    { label: "1–8", min: 1, max: 8 },
    { label: "9–16", min: 9, max: 16 },
    { label: "17–32", min: 17, max: 32 },
  ],
};

export function evaluateTarget(target: string, rows: Row[], alpha = 0.01): TargetReport {
  const scoped = rows.filter((r) => r.target === target);
  const buckets = BUCKETS[target] ?? [{ label: "all", min: 1, max: 64 }];
  return {
    target,
    global: evaluateBucket("all", scoped, alpha),
    buckets: buckets.map((b) =>
      evaluateBucket(b.label, scoped.filter((r) => r.count >= b.min && r.count <= b.max), alpha),
    ),
  };
}
