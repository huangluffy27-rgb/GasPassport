// 测量领取制空投（Merkle 根 + 领取位图）的 Monad 测试网 gas：
// 部署、首位领取、同槽后续领取；不依赖私钥，全部走 eth_estimateGas + state override。
// 运行：node scripts/measure_claim.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  concat,
  toHex,
  stringToHex,
} from "viem";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "https://testnet-rpc.monad.xyz";
const FROM = "0x00000000000000000000000000000000000000aa";
const TO = "0x00000000000000000000000000000000000000bb";
const N = 64;
const AMOUNT = 10n ** 15n;

const artifact = JSON.parse(readFileSync(resolve(root, "contracts/out/ClaimAirdrop.sol/ClaimAirdrop.json"), "utf8"));

const userAddress = (i) =>
  `0x${keccak256(concat([stringToHex("claim-demo"), toHex(BigInt(i), { size: 32 })])).slice(-40)}`;

const leaves = Array.from({ length: N }, (_, i) =>
  keccak256(encodePacked(["uint256", "address", "uint96"], [BigInt(i), userAddress(i), AMOUNT])),
);

function hashPair(a, b) {
  return a.toLowerCase() <= b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

// 简易 Merkle 树：排序对哈希，奇数节点上提
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

const claimData = (index) =>
  encodeFunctionData({
    abi: artifact.abi,
    functionName: "claim",
    args: [BigInt(index), userAddress(index), AMOUNT, proofFor(index)],
  });

// 位图槽：mapping 在 slot 1，key = 字索引 0
const bitmapSlot = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, 1n]));

async function estimate(data, override) {
  const params = [{ from: FROM, to: TO, data, gasPrice: "0x0", value: "0x0" }, "latest"];
  if (override) params.push({ [TO]: override });
  return BigInt(await rpc("eth_estimateGas", params));
}

// 1) 部署（含构造函数写 root）
const deployData = `${artifact.bytecode.object}${encodeAbiParameters([{ type: "bytes32" }], [merkleRoot]).slice(2)}`;
const deployGas = BigInt(
  await rpc("eth_estimateGas", [{ from: FROM, data: deployData, gasPrice: "0x0", value: "0x0" }]),
);

// 2) 首位领取：空状态，只覆盖 root
const SLOT0 = `0x${"0".repeat(64)}`;
const first = await estimate(claimData(0), { code: artifact.deployedBytecode.object, state: { [SLOT0]: merkleRoot } });

// 3) 同槽后续领取：位图第 0 位已置 1
const second = await estimate(claimData(1), {
  code: artifact.deployedBytecode.object,
  state: { [SLOT0]: merkleRoot, [bitmapSlot]: `0x${"0".repeat(63)}1` },
});

const team = deployGas;
const users = first + second * BigInt(N - 1);
const pushTotal = 183_522n + 1_349_065n;

const rows = [
  "item,gas",
  `deploy_claim_airdrop,${deployGas}`,
  `claim_first_in_word,${first}`,
  `claim_same_word,${second}`,
  `team_total_64,${team}`,
  `users_total_64,${users}`,
  `claim_total_64,${team + users}`,
  `push_total_64,${pushTotal}`,
];
writeFileSync(resolve(root, "contracts/reports/claim_airdrop.csv"), rows.join("\n") + "\n");

console.log(
  JSON.stringify(
    {
      merkleRoot,
      deployGas: Number(deployGas),
      firstClaim: Number(first),
      sameWordClaim: Number(second),
      teamTotal64: Number(team),
      usersTotal64: Number(users),
      claimTotal64: Number(team + users),
      pushTotal64: Number(pushTotal),
      savedVsPush: Number(pushTotal - (team + users)),
    },
    null,
    2,
  ),
);
