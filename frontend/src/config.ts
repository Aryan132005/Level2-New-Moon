// Midnight Preprod Network Configuration Endpoints
export const PREPROD_CONFIG = {
  // Public Indexer GraphQL endpoint
  indexerUrl: 'https://indexer.preprod.midnight.network/v1/graphql',
  
  // Public Indexer WebSocket endpoint
  indexerWsUrl: 'wss://indexer.preprod.midnight.network/v1/graphql',
  
  // Midnight Node RPC endpoint
  nodeUrl: 'https://rpc.preprod.midnight.network',
  
  // ZK Proof Server endpoint (local Docker or remote prover)
  proofServerUrl: 'http://localhost:6300',
  
  // Default fallback for development
  networkId: 'preprod'
};

// Storage key to save/retrieve the deployed contract address persistently
export const CONTRACT_ADDRESS_STORAGE_KEY = 'midnight_voting_contract_address';

export function getDeployedContractAddress(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CONTRACT_ADDRESS_STORAGE_KEY) || null;
}

export function setDeployedContractAddress(address: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONTRACT_ADDRESS_STORAGE_KEY, address);
}
