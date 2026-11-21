// 用真实交易回执校准 gas limit：私钥只在进程内存中生成与使用，不落盘、不打印。
// 运行：node scripts/calibrate_receipts.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  encodeFunctionData,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(
  readFileSync(resolve(root, "contracts/out/PageWriter.sol/PageWriter.json"), "utf8"),
);

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

const account = privateKeyToAccount(generatePrivateKey());
const transport = http("https://testnet-rpc.monad.xyz");
const publicClient = createPublicClient({ chain: monadTestnet, transport });
const walletClient = createWalletClient({ account, chain: monadTestnet, transport });

console.log(`address: ${account.address}`);

const faucet = await fetch("https://agents.devnads.com/v1/faucet", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chainId: 10143, address: account.address }),
}).then((r) => r.json());
console.log(`faucet: ${JSON.stringify(faucet)}`);

let balance = 0n;
for (let i = 0; i < 40; i++) {
  balance = await publicClient.getBalance({ address: account.address });
  if (balance > 0n) break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(`balance: ${balance}`);
if (balance === 0n) {
  console.log("没有到账，停止");
  process.exit(1);
}

const deployHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [],
});
const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
const contract = deployReceipt.contractAddress;
console.log(`deployed: ${contract} gasUsed=${deployReceipt.gasUsed}`);

const cases = [
  { name: "writeContiguous", count: 32 },
  { name: "writeScattered", count: 32 },
];
const rows = [];

for (const c of cases) {
  const data = encodeFunctionData({ abi: artifact.abi, functionName: c.name, args: [BigInt(c.count)] });
  const estimate = await publicClient.estimateGas({ account, to: contract, data });
  console.log(`${c.name} estimate=${estimate}`);

  for (const factor of [0.97, 1.0, 1.03]) {
    const limit = BigInt(Math.round(Number(estimate) * factor));
    let status = "send-failed";
    let gasUsed = 0n;
    try {
      const hash = await walletClient.sendTransaction({
        account,
        to: contract,
        data,
        gas: limit,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      status = receipt.status;
      gasUsed = receipt.gasUsed;
    } catch (err) {
      status = `error: ${String(err).slice(0, 80)}`;
    }
    rows.push({ fn: c.name, count: c.count, estimate: Number(estimate), limit: Number(limit), status, gasUsed: Number(gasUsed) });
    console.log(`${c.name} limit=${limit} status=${status} gasUsed=${gasUsed}`);
  }
}

const out = resolve(root, "contracts/reports/monad_receipt_calibration.json");
writeFileSync(out, JSON.stringify({ address: account.address, contract, rows }, null, 2));
console.log(`written: ${out}`);
