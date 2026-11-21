// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShardedToken} from "../src/ShardedToken.sol";

contract ShardedTokenTest is Test {
    ShardedToken internal token;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new ShardedToken(800e18);
    }

    function testPoolSplitEvenly() public view {
        for (uint8 i = 0; i < token.SHARD_COUNT(); ++i) {
            assertEq(token.poolBalance(i), 100e18);
        }
        assertEq(token.totalPoolBalance(), 800e18);
        assertEq(token.totalSupply(), 800e18);
    }

    function testClaimFromDifferentShards() public {
        vm.prank(alice);
        token.claim(0, 10e18);
        vm.prank(bob);
        token.claim(7, 20e18);

        assertEq(token.balanceOf(alice), 10e18);
        assertEq(token.balanceOf(bob), 20e18);
        assertEq(token.poolBalance(0), 90e18);
        assertEq(token.poolBalance(7), 80e18);
        assertEq(token.totalPoolBalance(), 770e18);
    }

    function testClaimRevertsOnInvalidShard() public {
        vm.expectRevert("invalid shard");
        token.claim(8, 1e18);
    }

    function testClaimRevertsWhenShardInsufficient() public {
        vm.expectRevert("insufficient shard pool");
        token.claim(0, 101e18);
    }

    function testConstructorRejectsIndivisibleSupply() public {
        vm.expectRevert("supply not divisible");
        new ShardedToken(801);
    }
}
