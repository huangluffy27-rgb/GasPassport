// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ShardedToken
/// @notice 对照用的「分片」实现：资金池拆成 8 个槽位，领取按分片分散，用户余额仍在同一张表。
/// @dev 与 NaiveToken 的对外行为一致（同样的领取语义），差别只在资金池状态的布局。
contract ShardedToken {
    string public constant name = "Sharded Token";
    string public constant symbol = "SHARD";
    uint8 public constant decimals = 18;

    uint8 public constant SHARD_COUNT = 8;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    /// @notice 资金池按分片保存：poolBalance[shard]
    mapping(uint8 => uint256) public poolBalance;

    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @param initialSupply 平均铸到 8 个分片，每个分片 initialSupply / 8
    constructor(uint256 initialSupply) {
        require(initialSupply % SHARD_COUNT == 0, "supply not divisible");
        uint256 perShard = initialSupply / SHARD_COUNT;
        for (uint8 i = 0; i < SHARD_COUNT; ++i) {
            poolBalance[i] = perShard;
        }
        totalSupply = initialSupply;
        emit Transfer(address(0), address(this), initialSupply);
    }

    /// @notice 从指定分片领取；不同分片的领取不再互相冲突
    function claim(uint8 shard, uint256 amount) external {
        require(shard < SHARD_COUNT, "invalid shard");
        uint256 shardBalance = poolBalance[shard];
        require(shardBalance >= amount, "insufficient shard pool");
        unchecked {
            poolBalance[shard] = shardBalance - amount;
        }
        balanceOf[msg.sender] += amount;

        emit Transfer(address(this), msg.sender, amount);
    }

    /// @notice 普通转账，与 NaiveToken 相同
    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 fromBalance = balanceOf[msg.sender];
        require(fromBalance >= amount, "insufficient balance");
        unchecked {
            balanceOf[msg.sender] = fromBalance - amount;
        }
        balanceOf[to] += amount;

        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice 全部资金池余额之和，便于测试与展示
    function totalPoolBalance() external view returns (uint256 total) {
        for (uint8 i = 0; i < SHARD_COUNT; ++i) {
            total += poolBalance[i];
        }
    }
}
