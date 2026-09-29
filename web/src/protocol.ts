import { parseAbi, parseAbiParameters } from 'viem'

// Protocol interfaces only. Deployment-specific ABIs are fetched from the manifest.
// This router tuple is the deployed version specified by the approved handoff.
export const poolKeyParameters = parseAbiParameters(
  '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
)
export const swapParameters = parseAbiParameters(
  '((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)',
)
export const currencyAmountParameters = parseAbiParameters('address currency, uint256 amount')
export const actionParameters = parseAbiParameters('bytes actions, bytes[] params')

export const quoterAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)',
  'error NotEnoughLiquidity(bytes32 poolId)',
  'error UnexpectedRevertBytes(bytes revertData)',
])
export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
])
export const permit2Abi = parseAbi([
  'function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  'function approve(address token,address spender,uint160 amount,uint48 expiration)',
  'error AllowanceExpired(uint256 deadline)',
  'error InsufficientAllowance(uint256 amount)',
])
export const routerAbi = parseAbi([
  'function execute(bytes commands,bytes[] inputs,uint256 deadline) payable',
  'error ExecutionFailed(uint256 commandIndex,bytes message)',
  'error TransactionDeadlinePassed()',
  'error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)',
  'error V4TooMuchRequested(uint256 maxAmountInRequested,uint256 amountRequested)',
  'error PoolNotInitialized()',
])
