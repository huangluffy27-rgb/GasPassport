// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PageWriter} from "../src/PageWriter.sol";
import {BatchAirdrop} from "../src/BatchAirdrop.sol";
import {Chaos} from "../src/Chaos.sol";

/// @title ChaosGasCampaign
/// @notice 采样 campaign：实测 EVM gas + 从存储访问轨迹统计页数，按 MIP-8 补页成本后落 CSV。
/// @dev 页数来自 vm.record / vm.accesses 的真实访问集合，不再按公式推断。
contract ChaosGasCampaign is Test {
    string internal constant PAGE_COST = "reports/page_cost.csv";
    string internal constant SAMPLES = "reports/gas_samples.csv";
    string internal constant AIRDROP = "reports/airdrop_samples.csv";

    uint256 internal constant N = 512;
    uint256 internal constant N_AIRDROP = 256;
    uint256 internal constant PAGE_EXTRA = 8_000;

    function setUp() public {
        vm.writeFile(PAGE_COST, "count,pages_contiguous,pages_scattered,gas_contiguous,gas_scattered\n");
        vm.writeFile(SAMPLES, "sampler,iter,count,gas_evm,pages,gas_monad\n");
        vm.writeFile(AIRDROP, "sampler,iter,count,gas_evm,pages,gas_monad\n");
    }

    /// @notice 页成本对照：同样的写入次数，同页 vs 跨页
    function testPageCost() public {
        uint256[5] memory counts = [uint256(1), 8, 16, 32, 64];
        for (uint256 k = 0; k < counts.length; ++k) {
            uint256 c = counts[k];

            PageWriter contiguousWriter = new PageWriter();
            vm.record();
            uint256 start = gasleft();
            contiguousWriter.writeContiguous(c);
            uint256 gasContiguous = start - gasleft();
            (, bytes32[] memory contigWrites) = vm.accesses(address(contiguousWriter));

            PageWriter scatteredWriter = new PageWriter();
            vm.record();
            start = gasleft();
            scatteredWriter.writeScattered(c);
            uint256 gasScattered = start - gasleft();
            (, bytes32[] memory scatterWrites) = vm.accesses(address(scatteredWriter));

            vm.writeLine(
                PAGE_COST,
                string.concat(
                    vm.toString(c),
                    ",",
                    vm.toString(_uniquePages(contigWrites)),
                    ",",
                    vm.toString(_uniquePages(scatterWrites)),
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

    /// @notice 第二组目标：批量空投，每次写 N 个散列余额槽
    function testAirdropSamples() public {
        _airdrop("uniform", 0);
        _airdrop("iet", 1);
        _airdrop("logistic", 2);
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
            vm.record();
            uint256 start = gasleft();
            writer.writeScattered(count);
            uint256 used = start - gasleft();
            (, bytes32[] memory writes) = vm.accesses(address(writer));
            uint256 pages = _uniquePages(writes);

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

    function _airdrop(string memory label, uint8 kind) internal {
        uint256 state = 0.53e18;
        for (uint256 i = 0; i < N_AIRDROP; ++i) {
            uint256 u;
            if (kind == 0) {
                u = Chaos.uniform(0xA11D20B, i);
            } else if (kind == 1) {
                u = Chaos.iet(i);
            } else {
                state = Chaos.logisticStep(state);
                u = state;
            }
            uint256 count = 1 + (((u % 1e18) * 32) / 1e18);

            address[] memory users = new address[](count);
            for (uint256 j = 0; j < count; ++j) {
                users[j] = address(
                    uint160(uint256(keccak256(abi.encodePacked(label, i, j))))
                );
            }

            BatchAirdrop airdrop = new BatchAirdrop();
            vm.record();
            uint256 start = gasleft();
            airdrop.airdrop(users, 1e18);
            uint256 used = start - gasleft();
            (, bytes32[] memory writes) = vm.accesses(address(airdrop));
            uint256 pages = _uniquePages(writes);

            vm.writeLine(
                AIRDROP,
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

    /// @dev 每 128 个连续槽算一页，统计访问到的不同页数
    function _uniquePages(bytes32[] memory slots) internal pure returns (uint256) {
        uint256[] memory seen = new uint256[](slots.length);
        uint256 n;
        for (uint256 i = 0; i < slots.length; ++i) {
            uint256 page = uint256(slots[i]) / 128;
            bool found;
            for (uint256 j = 0; j < n; ++j) {
                if (seen[j] == page) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                seen[n++] = page;
            }
        }
        return n;
    }
}
