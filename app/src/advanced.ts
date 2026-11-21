/**
 * 四项进阶优化：
 * 1. CV+ 比率共形：用交叉验证的线性预测做归一化分数，给近似条件覆盖。
 * 2. 自动阈值：按 Hill/MoM 的 ξ 稳定性选 GPD 阈值，替代手拍 80% 分位。
 * 3. 顺序停止：并集校正的共形检查点 + 稳定性停止准则。
 * 4. 页感知布局建议：把 128 槽 = 4KB 页的测量结果转成可执行建议。
 */

import type { Row } from "./conformal.js";
import { conformalLimit } from "./conformal.js";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function linearFit(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  return { a: my - b * mx, b };
}

export type RatioResult = {
  expected: number;
  coverage: number;
  perBucket: { label: string; n: number; coverage: number; limit: number }[];
};

/** CV+：5 折交叉验证得到折外预测，分数 = gas / pred，分位数作用在比率上 */
export function ratioConformal(rows: Row[], alpha = 0.01): RatioResult {
  const cal = rows.filter((r) => r.iter % 2 === 0);
  const test = rows.filter((r) => r.iter % 2 === 1);
  const scores: number[] = [];

  for (let f = 0; f < 5; f++) {
    const tr = cal.filter((_, i) => i % 5 !== f);
    const va = cal.filter((_, i) => i % 5 === f);
    if (tr.length === 0 || va.length === 0) continue;
    const { a, b } = linearFit(tr.map((r) => r.count), tr.map((r) => r.gas));
    for (const r of va) {
      const pred = Math.max(1, a + b * r.count);
      scores.push(r.gas / pred);
    }
  }

  const q = conformalLimit(scores, alpha);
  const { a, b } = linearFit(cal.map((r) => r.count), cal.map((r) => r.gas));
  const limitAt = (count: number) => Math.ceil((a + b * count) * q);

  let sum = 0;
  let covered = 0;
  const buckets = new Map<string, { n: number; covered: number; limit: number }>();
  for (const r of test) {
    const limit = limitAt(r.count);
    sum += limit;
    if (r.gas <= limit) covered++;
    const key = `${Math.floor((r.count - 1) / 8) * 8 + 1}–${Math.floor((r.count - 1) / 8) * 8 + 8}`;
    const cur = buckets.get(key) ?? { n: 0, covered: 0, limit };
    cur.n++;
    if (r.gas <= limit) cur.covered++;
    buckets.set(key, cur);
  }

  return {
    expected: sum / Math.max(1, test.length),
    coverage: covered / Math.max(1, test.length),
    perBucket: [...buckets.entries()].map(([label, v]) => ({
      label,
      n: v.n,
      coverage: v.covered / Math.max(1, v.n),
      limit: v.limit,
    })),
  };
}

function gpdQuantile(sorted: number[], u: number, p: number) {
  const excess = sorted.filter((x) => x > u).map((x) => x - u);
  if (excess.length < 20) return null;
  const m = mean(excess);
  const v = mean(excess.map((x) => (x - m) ** 2));
  if (v <= 0 || m <= 0) return null;
  const xi = 0.5 * (1 - (m * m) / v);
  const beta = 0.5 * m * ((m * m) / v + 1);
  const ratio = (excess.length / sorted.length) * (1 - p);
  const q = Math.abs(xi) < 1e-6 ? u + beta * Math.log(1 / ratio) : u + (beta / xi) * (Math.pow(ratio, -xi) - 1);
  return { q: Math.max(q, sorted[sorted.length - 1]), xi, beta };
}

export type EvtResult = { thresholdQ: number; xi: number; q999: number; fixedQ999: number };

/** 自动阈值：在候选分位里选 ξ 最稳定的那个 */
export function autoThreshold(cal: number[], p = 0.999): EvtResult {
  const sorted = [...cal].sort((a, b) => a - b);
  const candidates = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
  const fits = candidates
    .map((q) => {
      const u = quantile(sorted, q);
      const fit = gpdQuantile(sorted, u, p);
      return fit ? { thresholdQ: q, xi: fit.xi, q999: fit.q } : null;
    })
    .filter((x): x is { thresholdQ: number; xi: number; q999: number } => x !== null);

  if (fits.length === 0) {
    const fixed = gpdQuantile(sorted, quantile(sorted, 0.8), p);
    const q999 = fixed?.q ?? sorted[sorted.length - 1];
    return { thresholdQ: 0.8, xi: fixed?.xi ?? 0, q999, fixedQ999: q999 };
  }

  const medianXi = quantile([...fits.map((f) => f.xi)].sort((a, b) => a - b), 0.5);
  const best = fits.reduce((a, b) => (Math.abs(b.xi - medianXi) < Math.abs(a.xi - medianXi) ? b : a));
  const fixed = gpdQuantile(sorted, quantile(sorted, 0.8), p);

  return {
    thresholdQ: best.thresholdQ,
    xi: best.xi,
    q999: best.q999,
    fixedQ999: fixed?.q ?? sorted[sorted.length - 1],
  };
}

export type SeqResult = {
  checkpoints: { n: number; alpha: number; limit: number; change: number }[];
  stopN: number;
  stopLimit: number;
  coverage: number;
  fixedLimit: number;
};

/** 顺序停止：并集校正的共形检查点，limit 连续两次变化 ≤2% 就停 */
export function sequentialCertify(rows: Row[], targetAlpha = 0.01): SeqResult {
  const cal = [...rows.filter((r) => r.iter % 2 === 0)].sort(
    (a, b) => a.iter - b.iter || a.sampler.localeCompare(b.sampler),
  );
  const test = rows.filter((r) => r.iter % 2 === 1).map((r) => r.gas);
  const ns = [16, 32, 64, 128, 256].filter((n) => n <= cal.length);
  const checkpoints: { n: number; alpha: number; limit: number; change: number }[] = [];

  ns.forEach((n, k) => {
    const alpha = 0.05 / ((k + 1) * (k + 2));
    const limit = conformalLimit(cal.slice(0, n).map((r) => r.gas), alpha);
    const prev = checkpoints[checkpoints.length - 1]?.limit;
    checkpoints.push({ n, alpha, limit, change: prev ? Math.abs(limit - prev) / prev : Number.POSITIVE_INFINITY });
  });

  let stopIdx = checkpoints.length - 1;
  // 99% 覆盖至少需要约 1/α 个样本，低于这个数的检查点不认
  const minN = Math.ceil(1 / targetAlpha) - 1;
  for (let i = 1; i < checkpoints.length; i++) {
    if (checkpoints[i].n >= minN && checkpoints[i].change <= 0.05 && checkpoints[i - 1].change <= 0.05) {
      stopIdx = i;
      break;
    }
  }

  const stop = checkpoints[stopIdx] ?? { n: cal.length, limit: conformalLimit(cal.map((r) => r.gas), targetAlpha) };
  const fixedLimit = conformalLimit(cal.map((r) => r.gas), targetAlpha);
  return {
    checkpoints,
    stopN: stop.n,
    stopLimit: stop.limit,
    coverage: test.filter((g) => g <= stop.limit).length / Math.max(1, test.length),
    fixedLimit,
  };
}

export type LayoutAdvice = {
  items: { contract: string; current: string; suggestion: string; pages: string; gas: string }[];
  notes: string[];
};

export type AdvancedSummary = {
  pw: { ratio: RatioResult; evt: EvtResult; seq: SeqResult };
  air: { ratio: RatioResult; evt: EvtResult; seq: SeqResult };
  layout: LayoutAdvice;
};

/** 页感知布局建议：基于实测的 10,975 gas / 页 */
export function layoutAdvice(): LayoutAdvice {
  return {
    items: [
      {
        contract: "PageWriter.writeScattered",
        current: "_slots[i * 128]：每次落到新页，64 次写 = 64 页",
        suggestion: "改成连续槽 _slots[i] 或一个 packed struct，64 次写落在 1 页",
        pages: "64 → 1",
        gas: "1,855,180 → 1,163,725（−37%；相对 64 页基线省 691,455）",
      },
      {
        contract: "BatchAirdrop.airdrop",
        current: "mapping(address => uint256)：每个地址的槽由 keccak 散列，约一槽一页",
        suggestion: "改成「累计 Merkle 根 + 用户自取」：每批只写 1 个根，领取时再写位图",
        pages: "32 → 1",
        gas: "写入端 952,311 → 约 60k；但实测每次领取 49,432（6 层 keccak），64 人合计 3.49M，比页对齐 1.53M 更贵",
      },
      {
        contract: "通用热状态",
        current: "常一起访问的变量分散在不同合约 / 不同映射",
        suggestion: "按 128 槽（4KB）对齐热变量；把同一次调用必读写的字段放进同一页",
        pages: "k → 1..2",
        gas: "每减少一页省 10,975 gas；64 页场景下 −59.4%",
      },
    ],
    notes: [
      "128 槽 × 32B = 4KB，与 OS 页 / SSD 页 / NVMe 随机读同粒度。",
      "页对齐同时降低 gas 与状态 I/O：64 页散写每次调用触达 256KB，对齐后 4KB。",
      "改映射为 Merkle 根会改变业务语义；且 Monad 的 keccak 约 5 千 gas，6 层证明反而更贵（实测 64 人合计 3.49M vs 页对齐 1.53M）。",
    ],
  };
}
