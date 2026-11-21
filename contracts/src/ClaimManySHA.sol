// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ClaimManySHA
/// @notice 探索分支：SHA-256 Merkle + 领取位图 + 批量领取。
/// @dev Monad 上 keccak 约 5 千 gas/次，SHA-256 预编译约 4 百，故用 SHA-256 建树。
contract ClaimManySHA {
    bytes32 public root;
    mapping(uint256 => uint256) public claimedWords;

    event Claimed(uint256 indexed index, address indexed account, uint96 amount);

    constructor(bytes32 _root) {
        root = _root;
    }

    function isClaimed(uint256 index) public view returns (bool) {
        return (claimedWords[index >> 8] >> (index & 0xff)) & 1 == 1;
    }

    function claim(uint256 index, address account, uint96 amount, bytes32[] calldata proof) external {
        _claim(index, account, amount, proof);
    }

    function claimMany(
        uint256[] calldata indexes,
        address[] calldata accounts,
        uint96[] calldata amounts,
        bytes32[][] calldata proofs
    ) external {
        uint256 len = indexes.length;
        require(len == accounts.length && len == amounts.length && len == proofs.length, "len");
        for (uint256 i = 0; i < len; ++i) {
            _claim(indexes[i], accounts[i], amounts[i], proofs[i]);
        }
    }

    function _claim(uint256 index, address account, uint96 amount, bytes32[] calldata proof) internal {
        require(!isClaimed(index), "claimed");
        bytes32 leaf = sha256(abi.encodePacked(index, account, amount));
        require(_verify(proof, leaf), "proof");
        claimedWords[index >> 8] |= 1 << (index & 0xff);
        emit Claimed(index, account, amount);
    }

    function _verify(bytes32[] calldata proof, bytes32 leaf) internal view returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h <= p ? sha256(abi.encodePacked(h, p)) : sha256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
