import { useState } from 'react';

export default function App() {
  const [connected, setConnected] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./hushpot.svg" alt="HushPot logo" width={28} height={28} />
          <span>
            HushPot <small>private savings pots on Midnight</small>
          </span>
        </div>
        <button className="btn primary" onClick={() => setConnected((v) => !v)}>
          {connected ? 'Disconnect' : 'Connect wallet'}
        </button>
      </header>

      <main className="content">
        <section className="panel">
          <h1>Scaffold ready</h1>
          <p>
            React + Vite web app for the HushPot contract. Wallet wiring
            (Lace / dapp-connector) lands in the next commits.
          </p>
        </section>
      </main>

      <footer className="footer">Private-by-default on Midnight</footer>
    </div>
  );
}
