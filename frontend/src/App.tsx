import { useState, useEffect } from 'react';
import {
  VotingClient,
  generateRandomHex
} from './midnight/votingClient';
import type { ConsoleLog, LedgerState } from './midnight/votingClient';

// Instantiate the single-instance Voting Client
const client = new VotingClient();

function App() {
  // Observables state
  const [mode, setMode] = useState<'sandbox' | 'preprod'>('sandbox');
  const [logs, setLogs] = useState<ConsoleLog[]>([]);
  const [ledgerState, setLedgerState] = useState<LedgerState | null>(null);
  const [walletConnected, setWalletConnected] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [activeContractAddress, setActiveContractAddress] = useState<string | null>(null);

  // Forms and actions input state
  const [setupTab, setSetupTab] = useState<'deploy' | 'load'>('deploy');
  const [proposalText, setProposalText] = useState('');
  const [proposalId, setProposalId] = useState('');
  const [adminSecretKey, setAdminSecretKey] = useState('');
  const [loadAddress, setLoadAddress] = useState('');

  const [voterSecretKey, setVoterSecretKey] = useState('');
  const [voteChoice, setVoteChoice] = useState<boolean | null>(null);
  
  const [adminCloseKey, setAdminCloseKey] = useState('');

  // Connect React to RxJS subjects in votingClient
  useEffect(() => {
    const subMode = client.mode$.subscribe(setMode);
    const subLogs = client.logs$.subscribe(setLogs);
    const subLedger = client.ledgerState$.subscribe(setLedgerState);
    const subConnected = client.walletConnected$.subscribe(setWalletConnected);
    const subAddr = client.walletAddress$.subscribe(setWalletAddress);
    const subContract = client.activeContractAddress$.subscribe(setActiveContractAddress);

    return () => {
      subMode.unsubscribe();
      subLogs.unsubscribe();
      subLedger.unsubscribe();
      subConnected.unsubscribe();
      subAddr.unsubscribe();
      subContract.unsubscribe();
    };
  }, []);

  // Helper generators
  const regenProposalId = () => setProposalId(generateRandomHex(32));
  const regenAdminKey = () => setAdminSecretKey(generateRandomHex(32));
  const regenVoterKey = () => setVoterSecretKey(generateRandomHex(32));

  // Handler functions
  const handleConnectWallet = async () => {
    await client.detectAndConnectWallet();
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposalText.trim() || !proposalId.trim() || !adminSecretKey.trim()) {
      client.addLog('error', 'Please fill in all deployment fields.');
      return;
    }
    await client.deployCampaign(proposalText, proposalId, adminSecretKey);
  };

  const handleLoadContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loadAddress.trim()) {
      client.addLog('error', 'Please enter a contract address.');
      return;
    }
    await client.loadCampaign(loadAddress);
  };

  const handleCastVote = async (choice: boolean) => {
    if (!voterSecretKey.trim()) {
      client.addLog('error', 'Voter Secret Key witness is required to generate ZK proof.');
      return;
    }
    await client.castVote(voterSecretKey, choice);
    setVoteChoice(null); // Reset selection UI after submit
    setVoterSecretKey(''); // Clear voter key so next vote needs a new key
  };

  const handleCloseCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminCloseKey.trim()) {
      client.addLog('error', 'Admin Secret Key witness is required to authenticate.');
      return;
    }
    await client.closeVoting(adminCloseKey);
    setAdminCloseKey('');
  };

  // UI calculations
  const totalVotes = ledgerState ? ledgerState.yesTally + ledgerState.noTally : 0n;
  const yesPercentage = totalVotes > 0n ? Number((ledgerState!.yesTally * 100n) / totalVotes) : 0;
  const noPercentage = totalVotes > 0n ? Number((ledgerState!.noTally * 100n) / totalVotes) : 0;

  return (
    <>
      {/* Top Header */}
      <header>
        <div className="logo-section">
          <h1>
            <span className="logo-icon"></span>
            NEW MOON
          </h1>
        </div>
        <div className="controls-section">
          <div className="mode-toggle">
            <button
              className={`mode-btn ${mode === 'sandbox' ? 'active' : ''}`}
              onClick={() => client.setMode('sandbox')}
            >
              Simulated Sandbox
            </button>
            <button
              className={`mode-btn ${mode === 'preprod' ? 'active' : ''}`}
              onClick={() => client.setMode('preprod')}
            >
              Preprod Network
            </button>
          </div>

          <div className="wallet-status">
            {walletConnected ? (
              <span className="badge badge-connected" title={walletAddress || undefined}>
                <span className="dot dot-pulse"></span>
                {walletAddress ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}` : 'Connected'}
              </span>
            ) : (
              <button className="btn-secondary" style={{ padding: '8px 16px', borderRadius: '10px' }} onClick={handleConnectWallet}>
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Warning banner for Midnight Lace Wallet not detected in preprod */}
      {mode === 'preprod' && !walletConnected && (
        <div className="warning-banner">
          <div>
            <strong>Lace Extension Wallet Not Detected.</strong> To use the live Midnight Preprod testnet, install the Lace browser extension. Otherwise, switch to <strong>Simulated Sandbox</strong> mode to run the full application logic in memory.
          </div>
          <button onClick={() => client.setMode('sandbox')}>Switch to Sandbox</button>
        </div>
      )}

      {/* Main Grid */}
      <main className="dashboard-grid">
        {/* Left Side: Setup, Vote, Admin Close */}
        <div>
          {/* Setup / Deploy campaign panel */}
          <div className="panel">
            <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
              <h2
                style={{ margin: 0, cursor: 'pointer', opacity: setupTab === 'deploy' ? 1 : 0.4 }}
                onClick={() => setSetupTab('deploy')}
              >
                Deploy Campaign
              </h2>
              <h2
                style={{ margin: 0, cursor: 'pointer', opacity: setupTab === 'load' ? 1 : 0.4 }}
                onClick={() => setSetupTab('load')}
              >
                Load Campaign
              </h2>
            </div>

            {setupTab === 'deploy' ? (
              <form onSubmit={handleDeploy}>
                <div className="form-group">
                  <label htmlFor="prop-text">Proposal Text</label>
                  <div className="input-container">
                    <textarea
                      id="prop-text"
                      value={proposalText}
                      onChange={(e) => setProposalText(e.target.value)}
                      placeholder="Write your decentralized proposal..."
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="prop-id">Proposal ID (32-Byte Hex)</label>
                  <div className="input-container">
                    <input
                      id="prop-id"
                      type="text"
                      value={proposalId}
                      onChange={(e) => setProposalId(e.target.value)}
                      placeholder="0x..."
                    />
                    <button type="button" className="input-btn" onClick={regenProposalId}>
                      Generate
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="admin-sk">Admin Secret Key Witness (32-Byte Hex)</label>
                  <div className="input-container">
                    <input
                      id="admin-sk"
                      type="text"
                      value={adminSecretKey}
                      onChange={(e) => setAdminSecretKey(e.target.value)}
                      placeholder="0x..."
                    />
                    <button type="button" className="input-btn" onClick={regenAdminKey}>
                      Generate
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={!walletConnected}>
                  Initialize & Deploy Contract
                </button>
              </form>
            ) : (
              <form onSubmit={handleLoadContract}>
                <div className="form-group">
                  <label htmlFor="contract-addr">Contract Address</label>
                  <div className="input-container">
                    <input
                      id="contract-addr"
                      type="text"
                      value={loadAddress}
                      onChange={(e) => setLoadAddress(e.target.value)}
                      placeholder="0x..."
                    />
                  </div>
                </div>
                <button type="submit" className="btn-secondary">
                  Connect to Campaign
                </button>
              </form>
            )}
          </div>

          {/* Secure Voting panel */}
          <div className="panel">
            <h2>Cast Private Zero-Knowledge Vote</h2>
            
            {activeContractAddress ? (
              <>
                <div className="warning-banner" style={{ background: 'rgba(6, 182, 212, 0.05)', borderColor: 'rgba(6, 182, 212, 0.2)', color: 'var(--accent-cyan)' }}>
                  <div>
                    <strong>ZK Privacy Shield Active:</strong> Your secret key generates a nullifier to guarantee 1 vote per key, without revealing your identity or option link.
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="voter-sk">Voter Secret Key Witness (32-Byte Hex)</label>
                  <div className="input-container">
                    <input
                      id="voter-sk"
                      type="text"
                      value={voterSecretKey}
                      onChange={(e) => setVoterSecretKey(e.target.value)}
                      placeholder="Enter private ZK witness key..."
                    />
                    <button type="button" className="input-btn" onClick={regenVoterKey}>
                      Generate
                    </button>
                  </div>
                </div>

                <div className="voting-options">
                  <div
                    className={`option-card ${voteChoice === true ? 'selected-yes' : ''}`}
                    onClick={() => setVoteChoice(true)}
                  >
                    <div className="option-title">YES</div>
                    <div className="option-desc">Approve proposal</div>
                  </div>

                  <div
                    className={`option-card ${voteChoice === false ? 'selected-no' : ''}`}
                    onClick={() => setVoteChoice(false)}
                  >
                    <div className="option-title">NO</div>
                    <div className="option-desc">Reject proposal</div>
                  </div>
                </div>

                <button
                  type="button"
                  className={`btn-primary ${voteChoice === null || !ledgerState?.votingOpen ? 'btn-disabled' : ''}`}
                  disabled={voteChoice === null || !ledgerState?.votingOpen}
                  onClick={() => handleCastVote(voteChoice!)}
                >
                  {!ledgerState?.votingOpen ? 'Voting Closed' : 'Cast ZK Proof Vote'}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
                Please deploy or load an active voting campaign to cast votes.
              </div>
            )}
          </div>

          {/* Admin Control Panel */}
          {activeContractAddress && ledgerState?.votingOpen && (
            <div className="panel">
              <h2>Close Campaign (Admin Panel)</h2>
              <form onSubmit={handleCloseCampaign}>
                <div className="form-group">
                  <label htmlFor="admin-close-sk">Admin Secret Key Witness</label>
                  <div className="input-container">
                    <input
                      id="admin-close-sk"
                      type="text"
                      value={adminCloseKey}
                      onChange={(e) => setAdminCloseKey(e.target.value)}
                      placeholder="Verify admin secret key to close..."
                    />
                  </div>
                </div>
                <button type="submit" className="btn-secondary" style={{ border: '1px solid rgba(244, 63, 94, 0.4)', color: 'var(--accent-rose)' }}>
                  Close Voting Period
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Right Side: Ledger Results, ZK Prover Console */}
        <div>
          {/* Ledger Results */}
          <div className="panel">
            <div className="results-header">
              <h2 style={{ margin: 0 }}>On-Chain Ledger State</h2>
              {activeContractAddress && (
                <span className={`badge ${ledgerState?.votingOpen ? 'badge-connected' : 'badge-disconnected'}`}>
                  {ledgerState?.votingOpen ? 'Active' : 'Closed'}
                </span>
              )}
            </div>

            {activeContractAddress && ledgerState ? (
              <>
                <div className="proposal-info-box">
                  <div className="p-text">{ledgerState.proposalText}</div>
                  <div className="p-meta">Campaign Address: {activeContractAddress}</div>
                  <div className="p-meta" style={{ marginTop: '4px' }}>Proposal ID: 0x{ledgerState.proposalId.substring(0, 16)}...</div>
                  <div className="p-meta" style={{ marginTop: '4px' }}>Admin Commitment: 0x{ledgerState.adminCommitment.substring(0, 16)}...</div>
                </div>

                <div className="progress-container">
                  <div className="progress-labels">
                    <span>YES Tally ({yesPercentage}%)</span>
                    <span>NO Tally ({noPercentage}%)</span>
                  </div>
                  <div className="progress-bar-wrapper">
                    <div className="progress-fill-yes" style={{ width: `${yesPercentage}%` }} />
                    <div className="progress-fill-no" style={{ width: `${noPercentage}%` }} />
                  </div>
                </div>

                <div className="progress-tally-digits">
                  <div className="digit-box yes">
                    <div className="label">Yes Votes</div>
                    <div className="val">{ledgerState.yesTally.toString()}</div>
                  </div>
                  <div className="digit-box no">
                    <div className="label">No Votes</div>
                    <div className="val">{ledgerState.noTally.toString()}</div>
                  </div>
                </div>

                <div className="nullifier-list-container">
                  <h3>
                    Spent Nullifiers Ledger
                    <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                      Total: {ledgerState.nullifierSet.length}
                    </span>
                  </h3>
                  <div className="nullifier-scroll">
                    {ledgerState.nullifierSet.length > 0 ? (
                      ledgerState.nullifierSet.map((n) => (
                        <div key={n} className="nullifier-item">
                          <span>0x{n.substring(0, 24)}...{n.slice(-6)}</span>
                          <span className="status">SPENT</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '10px 0' }}>
                        No spent nullifiers on ledger.
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>
                No active campaign loaded. Deploy a new campaign or join an existing contract address to view ledger tallies.
              </div>
            )}
          </div>

          {/* Cryptographic ZK Console */}
          <div className="panel console-panel">
            <h2>
              ZK Cryptographic Console
              <div className="console-header-actions">
                <button className="console-action-btn" onClick={() => client.clearLogs()}>
                  Clear
                </button>
              </div>
            </h2>
            <div className="console-output">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <div key={log.id} className="log-line">
                    <span className="log-timestamp">
                      {log.timestamp.toLocaleTimeString()}
                    </span>
                    <span className={`log-${log.type}`}>{log.message}</span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', margin: 'auto' }}>
                  Console idle. Run ZK transactions to see output.
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer>
        <p>
          New Moon Voting Campaign • Built on{' '}
          <a href="https://midnight.network" target="_blank" rel="noreferrer">
            Midnight Network
          </a>{' '}
          using Compact Zero-Knowledge Circuits.
        </p>
      </footer>
    </>
  );
}

export default App;
