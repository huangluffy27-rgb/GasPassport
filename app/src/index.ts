#!/usr/bin/env node
/**
 * Contend 入口（脚手架）。
 *
 * 后续要接的三步：
 *   1. 读取 contracts/out 的编译产物
 *   2. 本地 EVM 步进执行交易，采集 SLOAD / SSTORE 访问集合
 *   3. 构建冲突图，输出并行度报告
 */

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log("contend 0.1.0");
    return;
  }

  console.log("contend 0.1.0 —— 并行执行冲突诊断器（脚手架）");
  console.log("");
  console.log("用法：");
  console.log("  contend analyze <合约或场景>   分析存储访问冲突并输出并行度报告");
  console.log("");
  console.log("当前状态：分析器尚未实现，先用 contracts/ 下的 NaiveToken / ShardedToken 做对照。");
}

main();
