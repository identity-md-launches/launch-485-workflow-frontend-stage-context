# Read-only pool validation

Checked **2026-09-29 at 22:30:17 UTC**, against the three public Sepolia RPC URLs supplied in the network handoff. All three reported chain ID **11155111** and the same results at block **11810526**. Full request outcomes, including the raw reverted quote, are preserved in [live-pool-reads.json](./live-pool-reads.json).

The pool key was derived from the handoff: native ETH / LaunchToken, fee 3000, tick spacing 60, and no hook. Its ID is `0x09a87a5790a2ad94314dd56bb254a4ea546777b554bfec359e682213d291ad1f`. The deployed source commit is `23af8cd4b30a896759c1fae5beeb7a5ca20aeea2`.

| Read | Observed result |
| --- | --- |
| `StateView.getSlot0(poolId)` | `sqrtPriceX96 = 560227709747861399187319382274582`, tick `177284`, protocol fee `0`, LP fee `3000` |
| `StateView.getLiquidity(poolId)` | `0` active liquidity |
| `V4Quoter.quoteExactInputSingle`, 0.001 ETH input | `49627.085152468411915572 GFAM` output; quoter gas estimate `87366` |
| `V4Quoter.quoteExactInputSingle`, 1 GFAM input | Reverted with `UnexpectedRevertBytes(NotEnoughLiquidity(poolId))` |

The initialized pool can quote an ETH purchase despite reporting zero liquidity at its current tick. This is consistent with a swap crossing an empty tick range to funded liquidity. The frontend therefore blocks quotes only for an uninitialized pool; the quoter determines whether each amount and direction can execute. The UI still reports the observed active-liquidity state. The quoter's nested error is decoded into “The pool does not have enough liquidity for this swap.”

Only `eth_chainId`, `eth_blockNumber`, and `eth_call` were used for this check. There were no signing requests, approvals, swaps, funding operations, or persistent state changes. The quoter gas estimate is not a wallet network-fee estimate. A successful quote does not establish that a funded wallet's router transaction will succeed; the app separately simulates the exact router call before requesting a signature. These observations describe one block and are not a promise of future price or liquidity.

The nested-error interpretation was checked against Uniswap's primary sources: [QuoterRevert.sol](https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/libraries/QuoterRevert.sol) and [BaseV4Quoter.sol](https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/base/BaseV4Quoter.sol). The live revert bytes in the evidence independently identify the matching outer and inner error selectors.

To reproduce, derive `poolId = keccak256(abi.encode(poolKey))` from `web/deployment/deployment.json`; select each RPC, state view and quoter from `web/deployment/network.json`; obtain the current block; and call the four reads above with that block tag. Decode outputs using `web/src/protocol.ts`. The buy call uses `zeroForOne=true`, `exactAmount=1000000000000000`, and empty hook data; the sell call uses `zeroForOne=false`, `exactAmount=1000000000000000000`, and empty hook data.
