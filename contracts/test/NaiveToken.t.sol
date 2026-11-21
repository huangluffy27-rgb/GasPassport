// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NaiveToken} from "../src/NaiveToken.sol";

contract NaiveTokenTest is Test {
    NaiveToken internal token;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new NaiveToken(1_000e18);
    }

    function testInitialPoolBalance() public view {
        assertEq(token.poolBalance(), 1_000e18);
        assertEq(token.totalSupply(), 1_000e18);
    }

    function testClaim() public {
        vm.prank(alice);
        token.claim(100e18);

        assertEq(token.balanceOf(alice), 100e18);
        assertEq(token.poolBalance(), 900e18);
    }

    function testClaimRevertsWhenPoolInsufficient() public {
        vm.prank(alice);
        vm.expectRevert("insufficient pool");
        token.claim(1_001e18);
    }

    function testTransfer() public {
        vm.startPrank(alice);
        token.claim(10e18);
        token.transfer(bob, 4e18);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), 6e18);
        assertEq(token.balanceOf(bob), 4e18);
    }
}
