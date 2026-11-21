// GasPassport 预算核心：部署预算 + 函数预算（state override，不发交易）。
// 供本地 API 与 CLI 共用；只依赖 viem。
import { encodeFunctionData, keccak256, concat, toHex, stringToHex } from "viem";

const DEFAULT_RPC = "https://testnet-rpc.monad.xyz";
const FROM = "0x00000000000000000000000000000000000000aa";
const TO = "0x00000000000000000000000000000000000000bb";

const BUCKETS = [
  [1, 8],
  [9, 16],
  [17, 32],
  [33, 64],
  [65, 128],
  [129, 256],
  [257, 512],
  [513, 1000],
];

async function rpc(method, params, rpcUrl = DEFAULT_RPC) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());
  if (res.error) throw new Error(`${method}: ${res.error.message}`);
  return res.result;
}

function normalizeArtifact(artifact) {
  const abi = artifact.abi;
  const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
  const deployed = artifact.deployedBytecode?.object ?? artifact.deployedBytecode;
  if (!abi || !deployed) throw new Error("artifact 需要包含 abi 与 deployedBytecode");
  return { abi, bytecode, deployed };
}

const defaultArg = (type) => {
  if (type.endsWith("[]")) return [];
  if (type === "address") return `0x${"0".repeat(40)}`;
  if (type === "bool") return true;
  if (type.startsWith("uint") || type.startsWith("int")) return 1n;
  if (type.startsWith("bytes")) return "0x";
  if (type === "string") return "";
  return 0n;
};

/** 共形分位数：第 ceil((n+1)(1-alpha)) 小 */
function conformalLimit(values, alpha) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length + 1) * (1 - alpha)) - 1));
  return sorted[idx];
}

export async function deployBudget({ bytecode, constructorArgs = "0x" }, { rpcUrl = DEFAULT_RPC } = {}) {
  const data = `0x${bytecode.replace(/^0x/, "")}${constructorArgs.replace(/^0x/, "")}`;
  const estimate = Number(
    BigInt(await rpc("eth_estimateGas", [{ from: FROM, data, gasPrice: "0x0", value: "0x0" }], rpcUrl)),
  );
  return {
    schemaVersion: "1.0",
    kind: "deploy",
    chainId: 10143,
    estimate,
    recommendLimit: Math.ceil(estimate * 1.02),
    note: "Monad 按 gas_limit 计费、未用不退；部署建议用 estimate × 1.02，不要硬编码。",
  };
}

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 拆笔：给定总量与每人成本，按单笔 cap 输出笔数与总预算 */
export function batchPlan({ totalUsers, perUserGas, txGasCap = 30_000_000, txOverhead = 21_000 }) {
  if (!(totalUsers > 0) || !(perUserGas > 0)) throw new Error("totalUsers 与 perUserGas 必须为正数");
  const capacity = Math.max(1, Math.floor((txGasCap - txOverhead) / perUserGas));
  const chunks = Math.ceil(totalUsers / capacity);
  const totalGas = chunks * txOverhead + totalUsers * perUserGas;
  return {
    schemaVersion: "1.0",
    kind: "batch-plan",
    totalUsers,
    perUserGas,
    txGasCap,
    txOverhead,
    capacityPerTx: capacity,
    chunks,
    totalGas,
    note: "按最坏情况每人一份预算；实际每笔仍应按该笔输入量查预算表。",
  };
}

export async function functionBudget(
  { artifact, functionName, min = 1, max = 64, step = 1, samplesPerInput = 1, alpha = 0.01 },
  { rpcUrl = DEFAULT_RPC, cache: useCache = true } = {},
) {
  const { abi, deployed } = normalizeArtifact(artifact);
  const codeHash = keccak256(deployed);
  const cacheKey = JSON.stringify({ functionName, min, max, step, samplesPerInput, alpha, codeHash });
  const hit = cache.get(cacheKey);
  if (useCache && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true };
  }
  const fn = abi.find((x) => x.type === "function" && x.name === functionName);
  if (!fn) throw new Error(`找不到函数 ${functionName}`);
  const arrayIndex = fn.inputs.findIndex((i) => i.type === "address[]");
  if (arrayIndex < 0) throw new Error("当前实现只支持长度可变的 address[] 参数");

  const samples = [];
  for (let n = min; n <= max; n += step) {
    const users = Array.from({ length: n }, (_, i) =>
      `0x${keccak256(concat([stringToHex("prebudget"), toHex(BigInt(i), { size: 32 })])).slice(-40)}`,
    );
    const args = fn.inputs.map((input, i) => (i === arrayIndex ? users : defaultArg(input.type)));
    const data = encodeFunctionData({ abi, functionName, args });
    for (let r = 0; r < samplesPerInput; r++) {
      const gas = Number(
        BigInt(
          await rpc(
            "eth_estimateGas",
            [
              { from: FROM, to: TO, data, gasPrice: "0x0", value: "0x0" },
              "latest",
              { [TO]: { code: deployed } },
            ],
            rpcUrl,
          ),
        ),
      );
      samples.push({ n, gas });
    }
  }

  const buckets = BUCKETS.filter(([lo, hi]) => hi >= min && lo <= max).map(([lo, hi]) => {
    const values = samples.filter((s) => s.n >= lo && s.n <= hi).map((s) => s.gas);
    const limit = values.length ? conformalLimit(values, alpha) : null;
    return { label: `${lo}–${hi}`, min: lo, max: hi, limit, samples: values.length };
  });

  const result = {
    schemaVersion: "1.0",
    kind: "function",
    target: functionName,
    chainId: 10143,
    method: "conditional-conformal + fixed-buckets",
    coverage: 1 - alpha,
    support: { min, max },
    certified: step === 1 && samplesPerInput >= 6,
    note:
      step !== 1 || samplesPerInput < 6
        ? "样例模式：采样密度不足，结果仅作演示；生产版需每桶 ≥60 个校准样本。"
        : "认证仅覆盖 support 区间。",
    samples: samples.length,
    codeHash,
    buckets,
  };
  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
