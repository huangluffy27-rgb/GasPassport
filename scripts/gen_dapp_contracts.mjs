// 从 Foundry 产物生成 dApp 需要的 ABI 与部署字节码。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pick = (name) => {
  const a = JSON.parse(readFileSync(resolve(root, `contracts/out/${name}.sol/${name}.json`), "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object, deployedBytecode: a.deployedBytecode.object };
};

const batch = pick("BatchAirdrop");
const aligned = pick("AlignedAirdrop");

const out = `// 由 scripts/gen_dapp_contracts.mjs 生成，勿手改
export const BATCH_AIRDROP = ${JSON.stringify(batch)} as const;
export const ALIGNED_AIRDROP = ${JSON.stringify(aligned)} as const;
`;
writeFileSync(resolve(root, "dapp/src/contracts.ts"), out);
console.log("written dapp/src/contracts.ts");
