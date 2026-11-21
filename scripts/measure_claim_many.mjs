// 探索分支：SHA-256 Merkle + 位图 + 批量领取的 Monad gas 测量。
// 运行：node scripts/measure_claim_many.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeFunctionData, encodePacked, toHex, stringToHex, keccak256, concat } from "viem";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "https://testnet-rpc.monad.xyz";
const FROM = "0x00000000000000000000000000000000000000aa";
const TO = "0x00000000000000000000000000000000000000bb";
const N = 64;
const AMOUNT = 10n ** 15n;

const artifact = JSON.parse(readFileSync(resolve(root, "contracts/out/ClaimManySHA.sol/ClaimManySHA.json"), "utf8"));

const sha256Hex = (hex) => `0x${createHash("sha256").update(Buffer.from(hex.slice(2), "hex")).digest("hex")}`;
const userAddress = (i) =>
  `0x${keccak256(concat([stringToHex("claim-many"), toHex(BigInt(i), { size: 32 })])).slice(-40)}`;

const leafFor = (i) =>
  sha256Hex(encodePacked(["uint256", "address", "uint96"], [BigInt(i), userAddress(i), AMOUNT]));

const leaves = Array.from({ length: N }, (_, i) => leafFor(i));

function hashPair(a, b) {
  const left = a.toLowerCase() <= b.toLowerCase() ? a : b;
  const right = left === a ? b : a;
  return sha256Hex(`${left}${right.slice(2)}`);
}

const levels = [leaves];
while (levels[levels.length - 1].length > 1) {
  const cur = levels[levels.length - 1];
  const next = [];
  for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
  levels.push(next);
}
const merkleRoot = levels[levels.length - 1][0];

function proofFor(index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < levels.length - 1; l++) {
    const sib = idx ^ 1;
    if (sib < levels[l].length) proof.push(levels[l][sib]);
    idx >>= 1;
  }
  return proof;
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());
  if (res.error) throw new Error(`${method}: ${res.error.message}`);
  return res.result;
}

async function estimate(data, override) {
  const params = [{ from: FROM, to: TO, data, gasPrice: "0x0", value: "0x0" }, "latest"];
  if (override) params.push({ [TO]: override });
  return BigInt(await rpc("eth_estimateGas", params));
}

const SLOT0 = `0x${"0".repeat(64)}`;
const override = { code: artifact.deployedBytecode.object, state: { [SLOT0]: merkleRoot } };

const deployData = `${artifact.bytecode.object}${encodeAbiParameters([{ type: "bytes32" }], [merkleRoot]).slice(2)}`;
const deployGas = BigInt(await rpc("eth_estimateGas", [{ from: FROM, data: deployData, gasPrice: "0x0", value: "0x0" }]));

const singleData = encodeFunctionData({
  abi: artifact.abi,
  functionName: "claim",
  args: [0n, userAddress(0), AMOUNT, proofFor(0)],
});
const singleGas = await estimate(singleData, override);

const rows = ["item,gas,calldata_bytes"];
rows.push(`deploy,${deployGas},${(deployData.length - 2) / 2}`);
rows.push(`claim_single,${singleGas},${(singleData.length - 2) / 2}`);

for (const batch of [8, 16, 32, 64]) {
  const indexes = Array.from({ length: batch }, (_, i) => BigInt(i));
  const accounts = Array.from({ length: batch }, (_, i) => userAddress(i));
  const amounts = Array.from({ length: batch }, () => AMOUNT);
  const proofs = Array.from({ length: batch }, (_, i) => proofFor(i));
  const data = encodeFunctionData({
    abi: artifact.abi,
    functionName: "claimMany",
    args: [indexes, accounts, amounts, proofs],
  });
  const gas = await estimate(data, override);
  rows.push(`claim_many_${batch},${gas},${(data.length - 2) / 2}`);
  console.log(`claim_many_${batch}: ${Number(gas)} gas, ${(data.length - 2) / 2} B calldata`);
}

writeFileSync(resolve(root, "contracts/reports/claim_many_sha256.csv"), rows.join("\n") + "\n");
console.log(JSON.stringify({ merkleRoot, deployGas: Number(deployGas), singleGas: Number(singleGas), rows }, null, 2));
