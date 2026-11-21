import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Sample = {
  target: string;
  sampler: string;
  iter: number;
  count: number;
  gasEvm: number;
  pages: number;
  gasMonad: number;
};

export type PageRow = {
  count: number;
  pagesContiguous: number;
  pagesScattered: number;
  gasContiguous: number;
  gasScattered: number;
};

export type SamplerStats = {
  sampler: string;
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  stdev: number;
  ci95: number;
  convergence: { n: number; error: number }[];
};

/**
 * Monad 测试网实测：每次多访问一页，eth_estimateGas 增加约 10,975 gas。
 * 测量方式：状态覆盖 + eth_estimateGas，不发交易、不消耗测试币。
 * 2026-11-21 实测：n=8/16/32/64 时分别为 76,887 / 164,683 / 340,274 / 691,455。
 */
export const PAGE_EXTRA = 10_975;

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

export function readSamples(dir: string, file = "testnet_samples.csv"): Sample[] {
  const rows = parseCsv(readFileSync(join(dir, file), "utf8"));
  return rows.map((cols) => {
    const gas = Number(cols[5]);
    return {
      target: cols[0],
      sampler: cols[1],
      iter: Number(cols[2]),
      count: Number(cols[3]),
      gasEvm: gas,
      pages: Number(cols[4]),
      // 测试网原生 estimateGas，已包含页成本，不再二次建模
      gasMonad: gas,
    };
  });
}

export type TestnetRow = { count: number; contiguous: number; scattered: number; diff: number };

export function readTestnetPageCost(dir: string): TestnetRow[] {
  const rows = parseCsv(readFileSync(join(dir, "monad_testnet_page_cost.csv"), "utf8"));
  return rows.map((cols) => ({
    count: Number(cols[0]),
    contiguous: Number(cols[1]),
    scattered: Number(cols[2]),
    diff: Number(cols[3]),
  }));
}

export type CalibrationRow = {
  fn: string;
  count: number;
  estimate: number;
  limit: number;
  status: string;
  gasUsed: number;
};

export type Calibration = { contract: string; rows: CalibrationRow[] };

export function readCalibration(dir: string): Calibration {
  const raw = JSON.parse(readFileSync(join(dir, "monad_receipt_calibration.json"), "utf8"));
  return {
    contract: raw.contract,
    rows: raw.rows.map((r: CalibrationRow) => ({
      fn: r.fn,
      count: r.count,
      estimate: r.estimate,
      limit: r.limit,
      status: r.status,
      gasUsed: r.gasUsed,
    })),
  };
}

export type AlignedRow = { count: number; mapping: number; aligned: number; diff: number; diffPct: number };

export function readAligned(dir: string): AlignedRow[] {
  const rows = parseCsv(readFileSync(join(dir, "aligned_airdrop.csv"), "utf8"));
  return rows.map((cols) => ({
    count: Number(cols[0]),
    mapping: Number(cols[1]),
    aligned: Number(cols[2]),
    diff: Number(cols[3]),
    diffPct: Number(cols[4]),
  }));
}

export function readAirdropSamples(dir: string): Sample[] {
  return readSamples(dir).filter((s) => s.target === "BatchAirdrop");
}

export function readPageCost(dir: string): PageRow[] {
  const rows = parseCsv(readFileSync(join(dir, "page_cost.csv"), "utf8"));
  return rows.map((cols) => ({
    count: Number(cols[0]),
    pagesContiguous: Number(cols[1]),
    pagesScattered: Number(cols[2]),
    gasContiguous: Number(cols[3]),
    gasScattered: Number(cols[4]),
  }));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdev(values: number[], avg = mean(values)): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const CHECKPOINTS = [16, 32, 64, 128, 256, 512];

export function summarize(sampler: string, samples: Sample[]): SamplerStats {
  // 收敛曲线必须按 iteration 顺序，分位数才排序
  const ordered = samples.filter((s) => s.sampler === sampler).map((s) => s.gasMonad);
  const monad = [...ordered].sort((a, b) => a - b);
  const avg = mean(monad);
  const sd = stdev(monad, avg);
  const full = avg;
  const convergence = CHECKPOINTS.filter((n) => n <= ordered.length).map((n) => {
    const partial = mean(ordered.slice(0, n));
    return { n, error: Math.abs(partial - full) / full };
  });

  return {
    sampler,
    n: monad.length,
    mean: avg,
    p50: quantile(monad, 0.5),
    p95: quantile(monad, 0.95),
    p99: quantile(monad, 0.99),
    max: monad[monad.length - 1],
    stdev: sd,
    // 均值的 95% 置信区间半宽（正态近似）
    ci95: 1.96 * (sd / Math.sqrt(monad.length)),
    convergence,
  };
}

export type Insight = {
  countMax: number;
  worstCase: PageRow;
  contiguousModeled: number;
  scatteredModeled: number;
  pageOverhead: number;
  pageOverheadPct: number;
  recommendedLimit: number;
  naiveBuffer: number;
  bufferOverpayPct: number;
  coverage: number;
};

export function buildInsight(pages: PageRow[], testnet: TestnetRow[], stats: SamplerStats[]): Insight {
  const worst = testnet.reduce((a, b) => (b.count > a.count ? b : a));
  const worstCase = pages.find((p) => p.count === worst.count) ?? pages[pages.length - 1];
  const contiguousModeled = worst.contiguous;
  const scatteredModeled = worst.scattered;
  const pageOverhead = worst.diff;

  const maxGas = Math.max(...stats.map((s) => s.max));
  const avgGas = mean(stats.map((s) => s.mean));
  const n = stats[0]?.n ?? 1;

  return {
    countMax: worst.count,
    worstCase,
    contiguousModeled,
    scatteredModeled,
    pageOverhead,
    pageOverheadPct: pageOverhead / contiguousModeled,
    // 经验分位数：N 个样本的最大值覆盖约 1 - 1/(N+1)
    recommendedLimit: Math.ceil(maxGas * 1.05),
    naiveBuffer: Math.ceil(avgGas * 3),
    bufferOverpayPct: (avgGas * 3 - maxGas * 1.05) / (maxGas * 1.05),
    coverage: 1 - 1 / (n + 1),
  };
}

export type AirdropInsight = {
  maxPages: number;
  maxGas: number;
  recommendedLimit: number;
  naiveBuffer: number;
  bufferOverpayPct: number;
  pageOverhead: number;
  coverage: number;
};

export function buildAirdropInsight(samples: Sample[], stats: SamplerStats[]): AirdropInsight {
  const maxPages = Math.max(...samples.map((s) => s.pages));
  const maxGas = Math.max(...stats.map((s) => s.max));
  const avgGas = mean(stats.map((s) => s.mean));
  const n = stats[0]?.n ?? 1;

  return {
    maxPages,
    maxGas,
    recommendedLimit: Math.ceil(maxGas * 1.05),
    naiveBuffer: Math.ceil(avgGas * 3),
    bufferOverpayPct: (avgGas * 3 - maxGas * 1.05) / (maxGas * 1.05),
    pageOverhead: (maxPages - 1) * PAGE_EXTRA,
    coverage: 1 - 1 / (n + 1),
  };
}
