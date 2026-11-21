// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AlignedAirdrop
/// @notice 页对齐版本：用追加式 packed 记录替代散列映射，写入落在连续槽（同一 4KB 页）。
/// @dev Entry = address(20B) + uint96(12B) = 32B，恰好 1 槽；push 顺序写，32 条记录 = 32 槽。
///      代价：按用户查余额需要额外索引或链下扫描，适合空投队列、事件式记录，不适合随机读写余额。
contract AlignedAirdrop {
    struct Entry {
        address user;
        uint96 amount;
    }

    Entry[] public entries;

    event Airdropped(address indexed user, uint96 amount);

    function airdrop(address[] calldata users, uint96 amount) external {
        for (uint256 i = 0; i < users.length; ++i) {
            entries.push(Entry(users[i], amount));
            emit Airdropped(users[i], amount);
        }
    }

    function count() external view returns (uint256) {
        return entries.length;
    }
}
