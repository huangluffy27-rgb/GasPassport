export type Bucket = {
  label: string;
  min: number;
  max: number;
  limit: number;
  buffer3x: number;
  coverage: number;
  evt: number;
};

export const PAGE_BUCKETS: Bucket[] = [
  { label: "1–14", min: 1, max: 14, limit: 437_114, buffer3x: 774_624, coverage: 1, evt: 437_114 },
  { label: "15–26", min: 15, max: 26, limit: 777_450, buffer3x: 1_908_325, coverage: 1, evt: 777_450 },
  { label: "27–39", min: 27, max: 39, limit: 1_146_147, buffer3x: 2_983_062, coverage: 1, evt: 1_255_119 },
  { label: "40–51", min: 40, max: 51, limit: 1_486_483, buffer3x: 4_026_052, coverage: 1, evt: 1_488_249 },
  { label: "52–64", min: 52, max: 64, limit: 1_855_180, buffer3x: 5_145_551, coverage: 1, evt: 1_972_515 },
];

export const AIR_BUCKETS: Bucket[] = [
  { label: "1–7", min: 1, max: 7, limit: 226_546, buffer3x: 427_819, coverage: 1, evt: 226_546 },
  { label: "8–13", min: 8, max: 13, limit: 400_729, buffer3x: 1_006_553, coverage: 1, evt: 400_733 },
  { label: "14–20", min: 14, max: 20, limit: 603_944, buffer3x: 1_578_788, coverage: 1, evt: 603_944 },
  { label: "21–26", min: 21, max: 26, limit: 778_127, buffer3x: 2_125_298, coverage: 1, evt: 795_458 },
  { label: "27–32", min: 27, max: 32, limit: 952_311, buffer3x: 2_671_307, coverage: 1, evt: 952_311 },
];

export type AlignedRow = { n: number; mapping: number; aligned: number; diff: number; pct: number };

export const ALIGNED: AlignedRow[] = [
  { n: 8, mapping: 255_564, aligned: 221_768, diff: 33_796, pct: 13.2 },
  { n: 16, mapping: 487_809, aligned: 381_264, diff: 106_545, pct: 21.8 },
  { n: 32, mapping: 952_298, aligned: 711_142, diff: 241_156, pct: 25.3 },
  { n: 64, mapping: 1_881_217, aligned: 1_349_065, diff: 532_152, pct: 28.3 },
];

export type PageCostRow = { n: number; contiguous: number; scattered: number };

export const PAGE_COST: PageCostRow[] = [
  { n: 1, contiguous: 67_501, scattered: 67_568 },
  { n: 8, contiguous: 190_059, scattered: 266_946 },
  { n: 16, contiguous: 329_154, scattered: 493_837 },
  { n: 32, contiguous: 607_344, scattered: 947_618 },
  { n: 64, contiguous: 1_163_725, scattered: 1_855_180 },
];

export const STATS = {
  samples: 1_536,
  pageExtra: 10_975,
  coverage: 0.99,
  alignedGain: 28.3,
};

export const MONAD_CHAIN = {
  chainId: "0x279f",
  chainName: "Monad Testnet",
  rpcUrls: ["https://testnet-rpc.monad.xyz"],
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  blockExplorerUrls: ["https://testnet.monadscan.com"],
};

export const RPC = "https://testnet-rpc.monad.xyz";

export function bucketFor(buckets: Bucket[], n: number): Bucket {
  return buckets.find((b) => n >= b.min && n <= b.max) ?? buckets[buckets.length - 1];
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
