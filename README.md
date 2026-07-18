# New Moon: Privacy-Preserving ZK Voting DApp on Midnight

### Live Demo Deploy
https://level2-new-moon.vercel.app/

### Demo Video
https://drive.google.com/file/d/1Vm2uK66IR9Xiy0HzQaJHz8piQC98-5lB/view?usp=sharing

New Moon is a privacy-first decentralized voting application built on the **Midnight Network**, a data-protection blockchain from IOG. It utilizes zero-knowledge (ZK) circuits written in **Compact** to allow voters to securely cast votes on proposals while preserving their identity and choice.

## Features

- **ZK Privacy Shield**: Cast anonymous votes. The connection between the voter's identity/key and their YES/NO option choice is never revealed on-chain.
- **Double-Voting Prevention**: A cryptographic nullifier `persistentHash(voterSecretKey + proposalId)` is generated locally inside the ZK proof and published on-chain. If the same key attempts to vote again, the ledger asserts a double-voting violation and rejects the transaction.
- **Dual Operational Modes**:
  - 🛠️ **Simulated Sandbox (Recommended)**: A self-contained, in-memory simulated Midnight ZK runtime. The application displays a real-time **ZK Cryptographic Console** that prints out the step-by-step prover/verifier assertions, witness resolutions, and nullifier derivations.
  - 🌐 **Midnight Preprod Network**: Connects directly to the browser-installed **Midnight Lace Wallet** extension, resolving public indexer endpoints, node RPCs, and proof generation servers to submit on-chain transactions.

---

## Project Structure

```bash
├── contract/             # Compact ZK Smart Contract definitions
│   ├── voting.compact    # Compact contract source code
│   └── managed/          # Compiled ZK circuit assets (keys, zkir, JS targets)
└── frontend/             # Vite + React + TypeScript Web DApp
    ├── src/
    │   ├── midnight/     # Voting client state & connection handlers
    │   ├── App.tsx       # Glassmorphism dashboard layout
    │   └── index.css     # Premium UI visual styling
    └── public/zk-config/ # Served prover/verifier keys and ZKIR targets
```

---

## Getting Started

### Prerequisites
- Node.js (>= 20.0.0)
- npm (>= 10.0.0)

### Setup & Run
1. Navigate into the frontend directory:
   ```bash
   cd frontend
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to **[http://localhost:5173/](http://localhost:5173/)**.

### Build for Production
To build the application bundle including the compiled WebAssembly cryptographic engines:
```bash
npm run build
```

---

## Cryptographic Operations in Sandbox Mode

When you perform actions in **Simulated Sandbox** mode, the interactive **ZK Cryptographic Console** reveals the internal operations:

- **Campaign Deployment (Admin)**: Computes the admin commitment on-chain using `persistentHash(adminSecretKey)`.
- **Private Voting (Voter)**: Evaluates private witnesses (Voter Secret Key & Choice) to derive the double-voting nullifier inside the ZK circuit, asserting that the nullifier does not already exist on-chain.
- **Admin Close Campaign**: Asserts that `persistentHash(adminSecretKey) == adminCommitment` in the ZK proof before disabling voting on the ledger.
