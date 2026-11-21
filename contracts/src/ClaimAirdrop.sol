// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ClaimAirdrop
/// @notice 领取制对照：链上只存 Merkle 根与领取位图，逐用户状态由领取动作创建。
/// @dev 64 人只需 1 个位图槽（256 人/槽），团队侧不再逐地址写余额。
contract ClaimAirdrop {
    bytes32 public root;
    mapping(uint256 => uint256) public claimedWords;

    event Claimed(uint256 indexed index, address indexed account, uint96 amount);

    constructor(bytes32 _root) {
        root = _root;
    }

    function isClaimed(uint256 index) public view returns (bool) {
        uint256 word = index >> 8;
        uint256 bit = 1 << (index & 0xff);
        return (claimedWords[word] & bit) != 0;
    }

    function claim(uint256 index, address account, uint96 amount, bytes32[] calldata proof) external {
        require(!isClaimed(index), "claimed");
        bytes32 leaf = keccak256(abi.encodePacked(index, account, amount));
        require(_verify(proof, leaf), "proof");
        claimedWords[index >> 8] |= 1 << (index & 0xff);
        emit Claimed(index, account, amount);
    }

    function _verify(bytes32[] calldata proof, bytes32 leaf) internal view returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h <= p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
