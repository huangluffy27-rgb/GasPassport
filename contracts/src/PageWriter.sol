// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PageWriter
/// @notice 存储页局部性对照合约：同样的写入次数，放在同一页 vs 摊到不同页。
/// @dev Monad 的 MIP-8 按 128 个连续槽一页预热：首次访问一页 8,100 gas，同页后续 100 gas。
///      两个函数写同样多的槽，只有布局不同，gas 差就是页成本。
contract PageWriter {
    uint256 public lastWrite;

    /// @dev 64 页 × 128 槽 = 8192 槽，覆盖 writeScattered 的最大范围
    uint256[8192] private _slots;

    /// @notice 从槽 0 开始连续写 count 个槽：全部落在第 0 页
    function writeContiguous(uint256 count) external {
        require(count > 0 && count <= 64, "count out of range");
        for (uint256 i = 0; i < count; ++i) {
            _slots[i] = i + 1;
        }
        lastWrite = count;
    }

    /// @notice 每隔 128 槽写一个：每次落到新的一页
    function writeScattered(uint256 count) external {
        require(count > 0 && count <= 64, "count out of range");
        for (uint256 i = 0; i < count; ++i) {
            _slots[i * 128] = i + 1;
        }
        lastWrite = count;
    }
}
