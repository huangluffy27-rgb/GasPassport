// 在 Monad 测试网上直接采样 gas：状态覆盖 + eth_estimateGas，不发交易、不需要私钥。
// 运行：node scripts/sample_testnet.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256, concat, toHex, stringToHex } from "viem";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "https://testnet-rpc.monad.xyz";
const FROM = "0x00000000000000000000000000000000000000aa";
const TO = "0x00000000000000000000000000000000000000bb";
const WAD = 10n ** 18n;
const PHI = 618033988749894848n;
const ALPHA = 400000000000000000n;
const R = 3990000000000000000n;
const N = 256;

const artifacts = {
  PageWriter: JSON.parse(readFileSync(resolve(root, "contracts/out/PageWriter.sol/PageWriter.json"), "utf8")),
  BatchAirdrop: JSON.parse(readFileSync(resolve(root, "contracts/out/BatchAirdrop.sol/BatchAirdrop.json"), "utf8")),
};

const ietStep = (x) => (x < ALPHA ? x + (WAD - ALPHA) : x - ALPHA);
const iet = (i) => ietStep(ietStep(ietStep((((BigInt(i) + 1n) * PHI) % WAD))));
const uniform = (seed, i) =>
  BigInt(keccak256(concat([toHex(BigInt(seed), { size: 32 }), toHex(BigInt(i), { size: 32 })]))) % WAD;

function samplerValues(kind) {
  const out = [];
  let state = 370000000000000000n;
  for (let i = 0; i < N; i++) {
    let u;
    if (kind === "uniform") u = uniform(0xc0ffee, i);
    else if (kind === "iet") u = iet(i);
    else {
      state = (((R * state) / WAD) * (WAD - state)) / WAD;
      u = state;
    }
    out.push(u);
  }
  return out;
}

function userAddress(label, i, j) {
  const h = keccak256(concat([stringToHex(label), toHex(BigInt(i), { size: 32 }), toHex(BigInt(j), { size: 32 })]));
  return `0x${h.slice(-40)}`;
}

const tasks = [];
for (const kind of ["uniform", "iet", "logistic"]) {
  for (const [i, u] of samplerValues(kind).entries()) {
    const pwCount = 1 + Number((u * 64n) / WAD);
    tasks.push({
      target: "PageWriter",
      sampler: kind,
      iter: i,
      count: pwCount,
      pages: pwCount,
      code: artifacts.PageWriter.deployedBytecode.object,
      data: encodeFunctionData({ abi: artifacts.PageWriter.abi, functionName: "writeScattered", args: [BigInt(pwCount)] }),
    });

    const airCount = 1 + Number((u * 32n) / WAD);
    const users = Array.from({ length: airCount }, (_, j) => userAddress(`${kind}-${i}`, i, j));
    tasks.push({
      target: "BatchAirdrop",
      sampler: kind,
      iter: i,
      count: airCount,
      pages: airCount,
      code: artifacts.BatchAirdrop.deployedBytecode.object,
      data: encodeFunctionData({
        abi: artifacts.BatchAirdrop.abi,
        functionName: "airdrop",
        args: [users, WAD],
      }),
    });
  }
}

console.log(`tasks: ${tasks.length}`);

async function estimateBatch(chunk) {
  const body = chunk.map((t, idx) => ({
    jsonrpc: "2.0",
    id: idx,
    method: "eth_estimateGas",
    params: [
      { from: FROM, to: TO, data: t.data, gasPrice: "0x0", value: "0x0" },
      "latest",
      { [TO]: { code: t.code } },
    ],
  }));
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const out = new Array(chunk.length).fill(null);
  for (const item of res) {
    if (item.error) out[item.id] = null;
    else out[item.id] = Number(BigInt(item.result));
  }
  return out;
}

const rows = [];
const size = 25;
for (let start = 0; start < tasks.length; start += size) {
  const chunk = tasks.slice(start, start + size);
  let gases = await estimateBatch(chunk);
  if (gases.some((g) => g === null)) {
    // 出错的重试一次
    const retry = chunk.map((t, i) => (gases[i] === null ? t : null));
    const retryTasks = retry.filter(Boolean);
    if (retryTasks.length) {
      const retryGas = await estimateBatch(retryTasks);
      let k = 0;
      for (let i = 0; i < chunk.length; i++) if (retry[i]) gases[i] = retryGas[k++];
    }
  }
  chunk.forEach((t, i) => {
    if (gases[i] !== null) {
      rows.push({ target: t.target, sampler: t.sampler, iter: t.iter, count: t.count, pages: t.pages, gas: gases[i] });
    }
  });
  process.stdout.write(`\r${Math.min(start + size, tasks.length)}/${tasks.length}`);
}
console.log("");

const csv = ["target,sampler,iter,count,pages,gas"];
for (const r of rows) csv.push(`${r.target},${r.sampler},${r.iter},${r.count},${r.pages},${r.gas}`);
const out = resolve(root, "contracts/reports/testnet_samples.csv");
writeFileSync(out, csv.join("\n") + "\n");
console.log(`written: ${out} rows=${rows.length}`);
