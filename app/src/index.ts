#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildInsight, readPageCost, readSamples, summarize } from "./analyze.js";
import { renderReport } from "./report.js";

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    console.log("chaosgas 0.1.0");
    return;
  }

  const flag = args.find((a) => a.startsWith("--reports="));
  const dir = flag
    ? resolve(flag.slice("--reports=".length))
    : resolve(fileURLToPath(new URL("../../contracts/reports", import.meta.url)));

  const samples = readSamples(dir);
  const pages = readPageCost(dir);
  const samplers = [...new Set(samples.map((s) => s.sampler))];
  const stats = samplers.map((s) => summarize(s, samples));
  const insight = buildInsight(pages, stats);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const html = renderReport(stats, pages, insight, now);
  const outPath = resolve(dir, "report.html");
  writeFileSync(outPath, html, "utf8");

  // GitHub Pages 使用的副本
  const docsPath = resolve(fileURLToPath(new URL("../../docs/index.html", import.meta.url)));
  writeFileSync(docsPath, html, "utf8");

  console.log("ChaosGas · Monad 合约 gas limit 体检");
  console.log("");
  for (const s of stats) {
    console.log(
      `${s.sampler.padEnd(9)} N=${s.n}  mean=${Math.round(s.mean)}  p99=${Math.round(s.p99)}  max=${Math.round(s.max)}`,
    );
  }
  console.log("");
  console.log(`最坏情况 count=${insight.countMax}：同页 ${Math.round(insight.contiguousModeled)} gas，跨页 ${Math.round(insight.scatteredModeled)} gas`);
  console.log(`跨页额外成本：+${Math.round(insight.pageOverhead)} gas（+${(insight.pageOverheadPct * 100).toFixed(1)}%）`);
  console.log(`推荐 gas limit：${insight.recommendedLimit}（经验覆盖 ${((insight.coverage * 100).toFixed(1))}%）`);
  console.log(`3x 固定 buffer：${insight.naiveBuffer}，多付 ${(insight.bufferOverpayPct * 100).toFixed(1)}%`);
  console.log("");
  console.log(`报告：${outPath}`);
}

main();
