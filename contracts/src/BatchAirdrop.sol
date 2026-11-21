// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BatchAirdrop
/// @notice 更具现实感的采样目标：一次给 N 个地址发钱，N 由输入决定。
/// @dev 每个地址的余额槽是 keccak 散列，天然落在不同页，页数随 N 增长。
contract BatchAirdrop {
    mapping(address => uint256) public balanceOf;

    function airdrop(address[] calldata users, uint256 amount) external {
        for (uint256 i = 0; i < users.length; ++i) {
            balanceOf[users[i]] += amount;
        }
    }
}
