/**
 * Testnet-only chain policy. There is deliberately no switch to enable other
 * chains: adding one requires a code change plus the legal/security review
 * described in planning/05-legal-review-checklist.md.
 */
export const ANVIL_CHAIN_ID = 31337;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const ALLOWED_CHAIN_IDS: readonly number[] = [ANVIL_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID];

export function isAllowedChainId(chainId: number): boolean {
  return ALLOWED_CHAIN_IDS.includes(chainId);
}
