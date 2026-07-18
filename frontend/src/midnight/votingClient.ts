import { BehaviorSubject } from 'rxjs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract } from './managed/voting/contract/index.js';

// Types for DApp state
export interface ConsoleLog {
  id: string;
  timestamp: Date;
  type: 'info' | 'error' | 'zk' | 'success';
  message: string;
}

export interface LedgerState {
  proposalId: string;
  proposalText: string;
  yesTally: bigint;
  noTally: bigint;
  votingOpen: boolean;
  adminCommitment: string;
  nullifierSet: string[]; // nullifier hex strings on-chain
}

// Helper utilities for Hex <-> Uint8Array conversion (native implementation)
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate random hex bytes
export function generateRandomHex(bytesCount: number): string {
  const bytes = new Uint8Array(bytesCount);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToHex(bytes);
}

// Synchronous, deterministic mock hash function simulating persistentHash
export function simulatedPersistentHash(input: string | Uint8Array): string {
  let str = '';
  if (typeof input === 'string') {
    str = input;
  } else {
    str = bytesToHex(input);
  }
  
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  
  let result = '';
  for (let j = 0; j < 8; j++) {
    const seed = hash + j * 0x9e3779b9 + str.length;
    const value = Math.abs(Math.sin(seed) * 1e9) >>> 0;
    result += value.toString(16).padStart(8, '0');
  }
  return result.substring(0, 64);
}

export class VotingClient {
  // Modes: 'sandbox' (in-memory simulator) or 'preprod' (live Lace integration)
  public readonly mode$ = new BehaviorSubject<'sandbox' | 'preprod'>('sandbox');
  public readonly logs$ = new BehaviorSubject<ConsoleLog[]>([]);
  public readonly ledgerState$ = new BehaviorSubject<LedgerState | null>(null);
  public readonly walletConnected$ = new BehaviorSubject<boolean>(false);
  public readonly walletAddress$ = new BehaviorSubject<string | null>(null);
  public readonly activeContractAddress$ = new BehaviorSubject<string | null>(null);

  // Live contract reference
  private liveDeployedContract: any = null;
  private liveContractSubscription: any = null;

  constructor() {
    this.addLog('info', 'New Moon ZK Voting Client Initialized. Ready in Sandbox Mode.');
    this.loadSandboxState();
  }

  // Set mode (Sandbox vs Preprod)
  public setMode(mode: 'sandbox' | 'preprod') {
    if (this.mode$.value === mode) return;
    this.mode$.next(mode);
    this.addLog('info', `Switched to ${mode === 'sandbox' ? 'Simulated Sandbox' : 'Midnight Preprod Network'} mode.`);
    
    // Always reset wallet connection when switching modes so user has to click Connect Wallet
    this.walletConnected$.next(false);
    this.walletAddress$.next(null);

    if (mode === 'sandbox') {
      this.loadSandboxState();
    } else {
      this.ledgerState$.next(null);
      this.activeContractAddress$.next(null);
      this.liveDeployedContract = null;
      if (this.liveContractSubscription) {
        this.liveContractSubscription.unsubscribe();
        this.liveContractSubscription = null;
      }
    }
  }

  // Logging system
  public addLog(type: ConsoleLog['type'], message: string) {
    const newLog: ConsoleLog = {
      id: generateRandomHex(8),
      timestamp: new Date(),
      type,
      message
    };
    const current = this.logs$.value;
    this.logs$.next([newLog, ...current].slice(0, 200)); // limit to 200 logs
  }

  public clearLogs() {
    this.logs$.next([]);
  }

  // Load sandbox campaign state from storage
  private loadSandboxState() {
    try {
      const stored = localStorage.getItem('newmoon_sandbox_state');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.ledgerState$.next({
          proposalId: parsed.proposalId,
          proposalText: parsed.proposalText,
          yesTally: BigInt(parsed.yesTally),
          noTally: BigInt(parsed.noTally),
          votingOpen: parsed.votingOpen,
          adminCommitment: parsed.adminCommitment,
          nullifierSet: parsed.nullifierSet
        });
        this.activeContractAddress$.next(parsed.address);
        this.addLog('info', `Loaded existing sandbox contract at address: ${parsed.address}`);
      } else {
        this.ledgerState$.next(null);
        this.activeContractAddress$.next(null);
      }
    } catch (e) {
      this.addLog('error', `Failed to load sandbox state: ${(e as Error).message}`);
    }
  }

  // Save sandbox campaign state to storage
  private saveSandboxState(address: string, state: LedgerState) {
    try {
      const data = {
        address,
        proposalId: state.proposalId,
        proposalText: state.proposalText,
        yesTally: state.yesTally.toString(),
        noTally: state.noTally.toString(),
        votingOpen: state.votingOpen,
        adminCommitment: state.adminCommitment,
        nullifierSet: state.nullifierSet
      };
      localStorage.setItem('newmoon_sandbox_state', JSON.stringify(data));
    } catch (e) {
      this.addLog('error', `Failed to save sandbox state: ${(e as Error).message}`);
    }
  }

  // Detect and connect real Midnight Lace Wallet
  public async detectAndConnectWallet(silent = false) {
    const isSandbox = this.mode$.value === 'sandbox';
    if (isSandbox) {
      this.walletConnected$.next(true);
      this.walletAddress$.next('sandbox-voter-wallet-address');
      if (!silent) this.addLog('success', 'Connected to Simulated Sandbox Wallet');
      return;
    }

    this.addLog('info', 'Scanning for Midnight Lace Wallet extension...');
    const wallet = (window as any).midnight?.mnLace;

    if (!wallet) {
      if (!silent) this.addLog('error', 'Lace Wallet for Midnight not found. Please install the chrome extension.');
      this.walletConnected$.next(false);
      this.walletAddress$.next(null);
      return;
    }

    try {
      const api = await wallet.enable();
      const state = await api.state();
      this.walletConnected$.next(true);
      this.walletAddress$.next(state.address);
      this.addLog('success', `Connected to Midnight Wallet: ${state.address.substring(0, 10)}...${state.address.slice(-6)}`);
    } catch (e) {
      this.addLog('error', `Failed to connect wallet: ${(e as Error).message}`);
      this.walletConnected$.next(false);
      this.walletAddress$.next(null);
    }
  }

  // Deploy Contract
  public async deployCampaign(proposalText: string, proposalIdHex: string, adminSecretKeyHex: string) {
    this.addLog('info', 'Starting deployment pipeline...');
    
    if (this.mode$.value === 'sandbox') {
      // Simulate Deployment
      try {
        this.addLog('zk', '[PROVER] Fetching constructor parameters...');
        this.addLog('zk', `[PROVER] Proposal ID (Public): ${proposalIdHex}`);
        this.addLog('zk', `[PROVER] Proposal Text (Public): "${proposalText}"`);
        this.addLog('zk', `[PROVER] Admin Secret Key (Private): ${adminSecretKeyHex.substring(0, 6)}... (hidden)`);
        
        // Compute admin commitment
        this.addLog('zk', '[PROVER] Executing persistentHash(adminSecretKey) inside ZK circuit...');
        const adminCommitment = simulatedPersistentHash(adminSecretKeyHex);
        this.addLog('zk', `[PROVER] Derived Admin Commitment (Public): ${adminCommitment}`);
        
        this.addLog('zk', '[PROVER] Generating zero-knowledge construction proof...');
        await new Promise(resolve => setTimeout(resolve, 1500)); // artificial proof latency
        this.addLog('success', '[VERIFIER] ZK proof verification successful.');
        
        const contractAddress = '0x' + generateRandomHex(20);
        const initialLedger: LedgerState = {
          proposalId: proposalIdHex,
          proposalText,
          yesTally: 0n,
          noTally: 0n,
          votingOpen: true,
          adminCommitment,
          nullifierSet: []
        };
        
        this.ledgerState$.next(initialLedger);
        this.activeContractAddress$.next(contractAddress);
        this.saveSandboxState(contractAddress, initialLedger);
        
        this.addLog('success', `Simulated Contract deployed successfully! Address: ${contractAddress}`);
      } catch (e) {
        this.addLog('error', `Sandbox deployment failed: ${(e as Error).message}`);
      }
    } else {
      // Live Network Deployment
      try {
        const wallet = (window as any).midnight?.mnLace;
        if (!wallet) throw new Error("Lace Wallet not connected.");
        const api = await wallet.enable();
        const state = await api.state();
        
        this.addLog('info', 'Configuring ZK and network providers...');
        const uris = await wallet.serviceUriConfig();
        
        // Dynamically import Midnight JS components to prevent browser bundling issues in mock-only setups
        const { levelPrivateStateProvider } = await import('@midnight-ntwrk/midnight-js-level-private-state-provider');
        const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
        const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
        const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
        const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
        const { ZKConfigProvider } = await import('@midnight-ntwrk/midnight-js-types');
        
        setNetworkId('preprod');
        
        const indexerUrl = uris.indexer || 'https://indexer.preprod.midnight.network/v1/graphql';
        const indexerWsUrl = indexerUrl.replace('http', 'ws');
        const proofServerUrl = uris.prover || 'http://localhost:6300';
        
        this.addLog('info', `Public indexer endpoint: ${indexerUrl}`);
        this.addLog('info', `ZK proof server: ${proofServerUrl}`);
        
        // Fetch ZK config from public served directory
        class FetchZkConfigProvider extends ZKConfigProvider<string> {
          async getProverKey(circuitId: string) {
            const res = await fetch(`/zk-config/keys/${circuitId}.prover`);
            return new Uint8Array(await res.arrayBuffer()) as any;
          }
          async getVerifierKey(circuitId: string) {
            const res = await fetch(`/zk-config/keys/${circuitId}.verifier`);
            return new Uint8Array(await res.arrayBuffer()) as any;
          }
          async getZKIR(circuitId: string) {
            const res = await fetch(`/zk-config/zkir/${circuitId}.bzkir`);
            return new Uint8Array(await res.arrayBuffer()) as any;
          }
        }
        
        const zkConfigProvider = new FetchZkConfigProvider();
        const providers = {
          privateStateProvider: levelPrivateStateProvider({
            privateStoragePasswordProvider: () => 'NewMoonSecurePassword2026!',
            accountId: state.address
          }),
          publicDataProvider: indexerPublicDataProvider(indexerUrl, indexerWsUrl),
          zkConfigProvider,
          proofProvider: httpClientProofProvider(proofServerUrl, zkConfigProvider),
          walletProvider: api,
          midnightProvider: api
        };
        
        const CompiledVotingContract = CompiledContract.make('VotingContract', Contract).pipe(
          CompiledContract.withVacantWitnesses
        );
        
        this.addLog('zk', '[PROVER] Deriving Admin Commitment...');
        const adminCommitBytes = hexToBytes(simulatedPersistentHash(adminSecretKeyHex));
        const pIdBytes = hexToBytes(proposalIdHex);
        
        this.addLog('info', 'Submitting deployment transaction to network. Please sign in Lace wallet...');
        const deployed = await deployContract(providers as any, {
          compiledContract: CompiledVotingContract as any,
          privateStateId: `newmoon-voting-${proposalIdHex}`,
          initialPrivateState: {
            voterSecretKey: new Uint8Array(0),
            voteChoice: false,
            adminSecretKey: hexToBytes(adminSecretKeyHex)
          },
          args: [pIdBytes, proposalText, adminCommitBytes]
        });
        
        this.liveDeployedContract = deployed;
        const deployedAddress = deployed.deployTxData.public.contractAddress;
        this.activeContractAddress$.next(deployedAddress);
        this.addLog('success', `Deployed on Preprod network! Address: ${deployedAddress}`);
        
        // Subscribe to ledger changes
        this.subscribeToLiveContractState(deployed);
      } catch (e) {
        this.addLog('error', `Deployment failed: ${(e as Error).message}`);
      }
    }
  }

  // Connect/Load existing campaign address
  public async loadCampaign(address: string) {
    if (!address.startsWith('0x') || address.length < 10) {
      this.addLog('error', 'Invalid contract address format.');
      return;
    }
    
    this.addLog('info', `Connecting to contract at address ${address}...`);
    
    if (this.mode$.value === 'sandbox') {
      const stored = localStorage.getItem('newmoon_sandbox_state');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.address === address) {
          this.loadSandboxState();
          return;
        }
      }
      this.addLog('error', 'Campaign address not found in local sandbox storage.');
    } else {
      // Live Network load contract
      try {
        const wallet = (window as any).midnight?.mnLace;
        if (!wallet) throw new Error("Wallet not connected.");
        const api = await wallet.enable();
        const state = await api.state();
        
        const { levelPrivateStateProvider } = await import('@midnight-ntwrk/midnight-js-level-private-state-provider');
        const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
        const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
        const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
        const { ZKConfigProvider } = await import('@midnight-ntwrk/midnight-js-types');
        
        const uris = await wallet.serviceUriConfig();
        const indexerUrl = uris.indexer || 'https://indexer.preprod.midnight.network/v1/graphql';
        const indexerWsUrl = indexerUrl.replace('http', 'ws');
        const proofServerUrl = uris.prover || 'http://localhost:6300';
        
        class FetchZkConfigProvider extends ZKConfigProvider<string> {
          async getProverKey(circuitId: string) {
            const res = await fetch(`/zk-config/keys/${circuitId}.prover`);
            return new Uint8Array(await res.arrayBuffer()) as any;
          }
          async getVerifierKey(circuitId: string) {
            const res = await fetch(`/zk-config/keys/${circuitId}.verifier`);
            return new Uint8Array(await res.arrayBuffer()) as any;
          }
          async getZKIR(circuitId: string) {
            const res = await fetch(`/zk-config/zkir/${circuitId}.bzkir`);
            return new Uint8Array(await res.arrayBuffer()) as any;
          }
        }
        const zkConfigProvider = new FetchZkConfigProvider();
        
        const providers = {
          privateStateProvider: levelPrivateStateProvider({
            privateStoragePasswordProvider: () => 'NewMoonSecurePassword2026!',
            accountId: state.address
          }),
          publicDataProvider: indexerPublicDataProvider(indexerUrl, indexerWsUrl),
          zkConfigProvider,
          proofProvider: httpClientProofProvider(proofServerUrl, zkConfigProvider),
          walletProvider: api,
          midnightProvider: api
        };
        
        const CompiledVotingContract = CompiledContract.make('VotingContract', Contract).pipe(
          CompiledContract.withVacantWitnesses
        );
        
        const found = await findDeployedContract(providers as any, {
          compiledContract: CompiledVotingContract as any,
          contractAddress: address,
          privateStateId: `newmoon-voting-generic`
        });
        
        this.liveDeployedContract = found;
        this.activeContractAddress$.next(address);
        this.addLog('success', `Found contract at: ${address}`);
        this.subscribeToLiveContractState(found);
      } catch (e) {
        this.addLog('error', `Failed to load live contract: ${(e as Error).message}`);
      }
    }
  }

  // Subscribe to live contract state$ observable
  private subscribeToLiveContractState(deployedContractInstance: any) {
    if (this.liveContractSubscription) {
      this.liveContractSubscription.unsubscribe();
    }
    
    this.addLog('info', 'Subscribing to ledger updates...');
    this.liveContractSubscription = deployedContractInstance.state$.subscribe({
      next: (ledgerState: any) => {
        if (!ledgerState) return;
        
        // Transform the ledger to our LedgerState structure
        const nullifierList: string[] = [];
        // Map set has symbol iterator in Compact
        try {
          for (const [nullifierBytes, spent] of ledgerState.nullifierSet) {
            if (spent) {
              nullifierList.push(bytesToHex(nullifierBytes));
            }
          }
        } catch (e) {
          // fallback if symbol iterator doesn't run cleanly on mock mapping objects
        }
        
        const parsedState: LedgerState = {
          proposalId: bytesToHex(ledgerState.proposalId),
          proposalText: ledgerState.proposalText,
          yesTally: ledgerState.yesTally,
          noTally: ledgerState.noTally,
          votingOpen: ledgerState.votingOpen,
          adminCommitment: bytesToHex(ledgerState.adminCommitment),
          nullifierSet: nullifierList
        };
        
        this.ledgerState$.next(parsedState);
        this.addLog('info', `Ledger updated: Yes=${parsedState.yesTally}, No=${parsedState.noTally}, Open=${parsedState.votingOpen}`);
      },
      error: (err: Error) => {
        this.addLog('error', `Ledger subscription error: ${err.message}`);
      }
    });
  }

  // Cast secure vote
  public async castVote(voterSecretKeyHex: string, choice: boolean) {
    const activeAddress = this.activeContractAddress$.value;
    const currentState = this.ledgerState$.value;
    
    if (!activeAddress || !currentState) {
      this.addLog('error', 'No active campaign loaded.');
      return;
    }
    
    this.addLog('info', `Preparing to cast secure ${choice ? 'YES' : 'NO'} vote...`);
    
    if (this.mode$.value === 'sandbox') {
      try {
        this.addLog('zk', '[PROVER] Asserting campaign status is open...');
        if (!currentState.votingOpen) {
          this.addLog('error', '[PROVER] Assertion failed: Voting is closed');
          throw new Error('Voting is closed');
        }
        
        this.addLog('zk', '[PROVER] Resolving private witness parameters...');
        this.addLog('zk', `[PROVER] Voter Secret Key: ${voterSecretKeyHex.substring(0, 6)}... (hidden)`);
        this.addLog('zk', `[PROVER] Choice: ${choice}`);
        
        // Derive nullifier inside ZK proof: nullifier = persistentHash([voterSecretKey, proposalId])
        this.addLog('zk', '[PROVER] Computing double-voting prevention nullifier inside ZK circuit...');
        this.addLog('zk', 'nullifier = persistentHash([sk, proposalId])');
        const nullifier = simulatedPersistentHash(voterSecretKeyHex + currentState.proposalId);
        this.addLog('zk', `[PROVER] Nullifier derived: ${nullifier}`);
        
        this.addLog('zk', '[PROVER] Asserting nullifier is not present on ledger...');
        if (currentState.nullifierSet.includes(nullifier)) {
          this.addLog('error', `[PROVER] Assertion failed: Double voting is not allowed. Nullifier ${nullifier.substring(0, 10)}... already spent.`);
          throw new Error('Double voting is not allowed');
        }
        
        this.addLog('zk', '[PROVER] All assertions passed. Generating ZK proof for castVote circuit...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // ZK proof overhead simulation
        this.addLog('success', '[VERIFIER] Zero-knowledge proof verified successfully.');
        
        // Update local ledger
        const updatedLedger: LedgerState = {
          ...currentState,
          yesTally: choice ? currentState.yesTally + 1n : currentState.yesTally,
          noTally: !choice ? currentState.noTally + 1n : currentState.noTally,
          nullifierSet: [...currentState.nullifierSet, nullifier]
        };
        
        this.ledgerState$.next(updatedLedger);
        this.saveSandboxState(activeAddress, updatedLedger);
        this.addLog('success', `Vote successfully cast! ZK verification complete. nullifier on-chain: ${nullifier.substring(0, 12)}...`);
      } catch (e) {
        this.addLog('error', `Failed to cast vote: ${(e as Error).message}`);
      }
    } else {
      // Live Network transaction call
      try {
        if (!this.liveDeployedContract) throw new Error("Contract instance not initialized.");
        
        this.addLog('zk', '[PROVER] Instantiating private state witnesses...');
        const wallet = (window as any).midnight?.mnLace;
        const api = await wallet.enable();
        const state = await api.state();
        
        const { levelPrivateStateProvider } = await import('@midnight-ntwrk/midnight-js-level-private-state-provider');
        const privateStateStore = levelPrivateStateProvider({
          privateStoragePasswordProvider: () => 'NewMoonSecurePassword2026!',
          accountId: state.address
        });
        
        // Save choice & voter secret key into local level DB so contract witness functions can pull it
        await privateStateStore.set(`newmoon-voting-generic`, {
          voterSecretKey: hexToBytes(voterSecretKeyHex),
          voteChoice: choice,
          adminSecretKey: new Uint8Array(0)
        });
        
        this.addLog('info', 'Submitting castVote transaction. Please sign in Lace wallet...');
        const tx = await this.liveDeployedContract.callTx.castVote();
        this.addLog('success', `Transaction submitted successfully! TX ID: ${tx.txHash}`);
      } catch (e) {
        this.addLog('error', `Transaction execution failed: ${(e as Error).message}`);
      }
    }
  }

  // Close voting campaign (Admin only)
  public async closeVoting(adminSecretKeyHex: string) {
    const activeAddress = this.activeContractAddress$.value;
    const currentState = this.ledgerState$.value;
    
    if (!activeAddress || !currentState) {
      this.addLog('error', 'No active campaign loaded.');
      return;
    }
    
    this.addLog('info', 'Preparing to close voting campaign (Admin action)...');
    
    if (this.mode$.value === 'sandbox') {
      try {
        this.addLog('zk', '[PROVER] Fetching adminSecretKey witness...');
        this.addLog('zk', `[PROVER] Admin Secret Key: ${adminSecretKeyHex.substring(0, 6)}... (hidden)`);
        
        // Validate admin secret key
        this.addLog('zk', '[PROVER] Computing persistentHash(adminSecretKey) in ZK circuit...');
        const derivedCommitment = simulatedPersistentHash(adminSecretKeyHex);
        this.addLog('zk', `[PROVER] Derived: ${derivedCommitment}`);
        this.addLog('zk', `[PROVER] Ledger:  ${currentState.adminCommitment}`);
        
        this.addLog('zk', '[PROVER] Asserting derived commitment matches adminCommitment...');
        if (derivedCommitment !== currentState.adminCommitment) {
          this.addLog('error', '[PROVER] Assertion failed: Unauthorized admin (keys do not match)');
          throw new Error('Unauthorized admin');
        }
        
        this.addLog('zk', '[PROVER] All assertions passed. Generating ZK proof for closeVoting circuit...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        this.addLog('success', '[VERIFIER] ZK proof verified. Closing voting campaign.');
        
        const updatedLedger: LedgerState = {
          ...currentState,
          votingOpen: false
        };
        
        this.ledgerState$.next(updatedLedger);
        this.saveSandboxState(activeAddress, updatedLedger);
        this.addLog('success', 'Voting period successfully closed on-chain!');
      } catch (e) {
        this.addLog('error', `Failed to close voting: ${(e as Error).message}`);
      }
    } else {
      // Live Network transaction call
      try {
        if (!this.liveDeployedContract) throw new Error("Contract instance not initialized.");
        
        const wallet = (window as any).midnight?.mnLace;
        const api = await wallet.enable();
        const state = await api.state();
        
        const { levelPrivateStateProvider } = await import('@midnight-ntwrk/midnight-js-level-private-state-provider');
        const privateStateStore = levelPrivateStateProvider({
          privateStoragePasswordProvider: () => 'NewMoonSecurePassword2026!',
          accountId: state.address
        });
        
        await privateStateStore.set(`newmoon-voting-generic`, {
          voterSecretKey: new Uint8Array(0),
          voteChoice: false,
          adminSecretKey: hexToBytes(adminSecretKeyHex)
        });
        
        this.addLog('info', 'Submitting closeVoting transaction. Please sign in Lace wallet...');
        const tx = await this.liveDeployedContract.callTx.closeVoting();
        this.addLog('success', `Campaign closed successfully! TX ID: ${tx.txHash}`);
      } catch (e) {
        this.addLog('error', `Failed to close campaign: ${(e as Error).message}`);
      }
    }
  }
}
