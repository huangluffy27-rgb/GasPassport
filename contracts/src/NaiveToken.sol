// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NaiveToken
/// @notice 对照用的「朴素」实现：所有余额都在一张表里，资金池余额是唯一一个热点槽。
/// @dev 仅用于并行度演示，不实现完整 ERC20（无 approve / transferFrom）。
contract NaiveToken {
    string public constant name = "Naive Token";
    string public constant symbol = "NAIVE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @param initialSupply 全部铸给合约自身，作为待领取的资金池
    constructor(uint256 initialSupply) {
        totalSupply = initialSupply;
        balanceOf[address(this)] = initialSupply;
        emit Transfer(address(0), address(this), initialSupply);
    }

    /// @notice 用户从资金池领取代币
    /// @dev 每笔领取都会读写 balanceOf[address(this)] 这一个槽，所有领取交易必然冲突
    function claim(uint256 amount) external {
        uint256 remaining = balanceOf[address(this)];
        require(remaining >= amount, "insufficient pool");
        unchecked {
            balanceOf[address(this)] = remaining - amount;
        }
        balanceOf[msg.sender] += amount;

        emit Transfer(address(this), msg.sender, amount);
    }

    /// @notice 普通转账，保留用于对照：只触碰转出方与接收方的余额槽
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

    /// @notice 资金池剩余额度
    function poolBalance() external view returns (uint256) {
        return balanceOf[address(this)];
    }
}
