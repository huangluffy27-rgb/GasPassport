// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PageWriter} from "../src/PageWriter.sol";
import {Chaos} from "../src/Chaos.sol";

/// @title ChaosGasCampaign
/// @notice 采样 campaign：测 EVM 执行 gas，并按 MIP-8 页模型补上页成本，落 CSV 给 TS 分析器。
/// @dev 本地 Foundry 是标准 EVM 计费，测不到 Monad 的页差异，所以页成本按参数建模：
///      每页首次访问 8,100 gas，同页后续 100 gas；相对同页基线的额外成本 = (pages - 1) * 8,000。
contract ChaosGasCampaign is Test {
    string internal constant PAGE_COST = "reports/page_cost.csv";
    string internal constant SAMPLES = "reports/gas_samples.csv";

    uint256 internal constant N = 512;
    uint256 internal constant PAGE_EXTRA = 8_000;

    function setUp() public {
        vm.writeFile(PAGE_COST, "count,pages_contiguous,pages_scattered,gas_contiguous,gas_scattered\n");
        vm.writeFile(SAMPLES, "sampler,iter,count,gas_evm,pages,gas_monad\n");
    }

    /// @notice 页成本对照：同样的写入次数，同页 vs 跨页
    function testPageCost() public {
        uint256[5] memory counts = [uint256(1), 8, 16, 32, 64];
        for (uint256 k = 0; k < counts.length; ++k) {
            uint256 c = counts[k];

            PageWriter contiguousWriter = new PageWriter();
            uint256 start = gasleft();
            contiguousWriter.writeContiguous(c);
            uint256 gasContiguous = start - gasleft();

            PageWriter scatteredWriter = new PageWriter();
            start = gasleft();
            scatteredWriter.writeScattered(c);
            uint256 gasScattered = start - gasleft();

            vm.writeLine(
                PAGE_COST,
                string.concat(
                    vm.toString(c),
                    ",1,",
                    vm.toString(c),
                    ",",
                    vm.toString(gasContiguous),
                    ",",
                    vm.toString(gasScattered)
                )
            );
        }
    }

    /// @notice 三种采样器各跑 N 次，记录跨页写的 gas 分布
    function testSamples() public {
        _sample("uniform", 0);
        _sample("iet", 1);
        _sample("logistic", 2);
    }

    function _sample(string memory label, uint8 kind) internal {
        uint256 state = 0.37e18;
        for (uint256 i = 0; i < N; ++i) {
            uint256 u;
            if (kind == 0) {
                u = Chaos.uniform(0xC0FFEE, i);
            } else if (kind == 1) {
                u = Chaos.iet(i);
            } else {
                state = Chaos.logisticStep(state);
                u = state;
            }
            uint256 count = 1 + (((u % 1e18) * 64) / 1e18);

            PageWriter writer = new PageWriter();
            uint256 start = gasleft();
            writer.writeScattered(count);
            uint256 used = start - gasleft();

            // writeScattered 每次落到新的一页，所以页数 = count
            uint256 pages = count;

            vm.writeLine(
                SAMPLES,
                string.concat(
                    label,
                    ",",
                    vm.toString(i),
                    ",",
                    vm.toString(count),
                    ",",
                    vm.toString(used),
                    ",",
                    vm.toString(pages),
                    ",",
                    vm.toString(used + (pages - 1) * PAGE_EXTRA)
                )
            );
        }
    }
}
