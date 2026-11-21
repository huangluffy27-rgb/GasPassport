// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PageWriter} from "../src/PageWriter.sol";

/// @title GasPassportCampaign
/// @notice 页成本对照：同样的写入次数，同页 vs 跨页；页数来自 vm.record / vm.accesses。
contract GasPassportCampaign is Test {
    string internal constant PAGE_COST = "reports/page_cost.csv";

    function setUp() public {
        vm.writeFile(PAGE_COST, "count,pages_contiguous,pages_scattered,gas_contiguous,gas_scattered\n");
    }

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

