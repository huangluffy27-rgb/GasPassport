// 对比「散列映射」与「页对齐追加记录」在 Monad 测试网的 estimateGas。
// 运行：node scripts/measure_aligned.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256, concat, toHex, stringToHex } from "viem";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "https://testnet-rpc.monad.xyz";
const FROM = "0x00000000000000000000000000000000000000aa";
const TO = "0x00000000000000000000000000000000000000bb";

const mapping = JSON.parse(readFileSync(resolve(root, "contracts/out/BatchAirdrop.sol/BatchAirdrop.json"), "utf8"));
const aligned = JSON.parse(readFileSync(resolve(root, "contracts/out/AlignedAirdrop.sol/AlignedAirdrop.json"), "utf8"));

const usersFor = (count) =>
  Array.from({ length: count }, (_, i) =>
    `0x${keccak256(concat([stringToHex("aligned"), toHex(BigInt(i), { size: 32 })])).slice(-40)}`,
  );

async function estimate(code, data) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_estimateGas",
    params: [
      { from: FROM, to: TO, data, gasPrice: "0x0", value: "0x0" },
      "latest",
      { [TO]: { code } },
    ],
  };
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  if (res.error) throw new Error(res.error.message);
  return Number(BigInt(res.result));
}

const rows = ["count,mapping_gas,aligned_gas,diff,diff_pct"];
for (const count of [8, 16, 32, 64]) {
  const users = usersFor(count);
  const dataMapping = encodeFunctionData({
    abi: mapping.abi,
    functionName: "airdrop",
    args: [users, 10n ** 18n],
  });
  const dataAligned = encodeFunctionData({
    abi: aligned.abi,
    functionName: "airdrop",
    args: [users, 10n ** 18n / 1000n],
  });

  const [gMapping, gAligned] = await Promise.all([
    estimate(mapping.deployedBytecode.object, dataMapping),
    estimate(aligned.deployedBytecode.object, dataAligned),
  ]);
  const diff = gMapping - gAligned;
  const pct = (diff / gMapping) * 100;
  console.log(`n=${count} mapping=${gMapping} aligned=${gAligned} diff=${diff} (${pct.toFixed(1)}%)`);
  rows.push(`${count},${gMapping},${gAligned},${diff},${pct.toFixed(2)}`);
}

const out = resolve(root, "contracts/reports/aligned_airdrop.csv");
writeFileSync(out, rows.join("\n") + "\n");
console.log(`written: ${out}`);
