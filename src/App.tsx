import { useCallback, useState } from 'react';
import { useMidnight } from './hooks/useMidnight';
import WalletConnect from './components/WalletConnect';
import PotFacts from './components/PotFacts';
import CircuitCall from './components/CircuitCall';
import type { PotFactsData } from './midnight/potFacts';
import { HUSHPOT_ADDRESS } from './midnight/hushpot';

export default function App() {
  const conn = useMidnight();
  const [facts, setFacts] = useState<PotFactsData | null>(null);
  const onFacts = useCallback((f: PotFactsData) => setFacts(f), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./hushpot.svg" alt="HushPot logo" width={28} height={28} />
          <span>
            HushPot <small>private savings pots on Midnight</small>
          </span>
        </div>
        {conn.status === 'connected' ? (
          <span className="pill open" title="Connected network">
            {conn.networkId}
          </span>
        ) : null}
      </header>

      <main className="content">
        <section className="hero">
          <h1>
            Pledge in <em>private</em>. Prove in zero knowledge.
          </h1>
          <p>
            HushPot is a savings pot on Midnight where membership is visible but amounts
            are not: your pledge lives as a salted commitment, and &ldquo;my pledge is at
            least T&rdquo; is proven in your wallet — never revealed on-chain.
          </p>
        </section>

        <div className="grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <CircuitCall conn={conn} facts={facts} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <WalletConnect conn={conn} />
            <PotFacts onFacts={onFacts} />
            <div className="panel">
              <h2>Contract</h2>
              <p className="sub">
                Deployed on Preprod:{' '}
                <span className="address" title={HUSHPOT_ADDRESS}>
                  {HUSHPOT_ADDRESS.slice(0, 20)}…
                </span>
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">Private-by-default on Midnight</footer>
    </div>
  );
}
