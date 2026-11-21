// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Chaos
/// @notice 三种可复现的输入采样器：均匀 PRNG、区间交换变换（IET）、logistic 混沌映射。
/// @dev 全部用 1e18 定点数，范围 [0, WAD)。同样的种子在任何机器上复现同样的序列。
library Chaos {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant R = 3.99e18;
    uint256 internal constant PHI = 618033988749894848; // 0.618... 黄金比例小数部分
    uint256 internal constant ALPHA = 0.4e18;           // IET 的切分点

    /// @notice 均匀伪随机：keccak(seed, i) 取模
    function uniform(uint256 seed, uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(seed, i))) % WAD;
    }

    /// @notice 区间交换变换：把 [0,1) 按 ALPHA 切成两段后交换位置
    function ietStep(uint256 x) internal pure returns (uint256) {
        if (x < ALPHA) {
            return x + (WAD - ALPHA);
        }
        unchecked {
            return x - ALPHA;
        }
    }

    /// @notice 先取黄金比例低差异序列，再过 IET：保留均匀性，同时打散相邻样本
    function iet(uint256 i) internal pure returns (uint256) {
        uint256 x = mulmod(i + 1, PHI, WAD);
        return ietStep(ietStep(ietStep(x)));
    }

    /// @notice logistic 映射 x <- r * x * (1 - x)，r = 3.99，确定性混沌
    function logisticStep(uint256 x) internal pure returns (uint256) {
        return (((R * x) / WAD) * (WAD - x)) / WAD;
    }
}
