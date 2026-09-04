// WalletConnect — Lace connect/disconnect UI with the three failure paths
// users actually hit: wallet not installed, connect rejected in the wallet,
// and wallet on the wrong network.

import type { MidnightConnection, WalletError } from '../hooks/useMidnight';

const LACE_STORE_URL =
  'https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk';

/** Short bech32m address for display: mid1abcd…wxyz */
function shortAddress(addr: string): string {
  return addr.length > 22 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr;
}

/** NIGHT has 9 decimals; balances arrive as raw bigints keyed by token type. */
function formatBalance(tokenType: string, raw: bigint): string {
  const isNative = /^0x?0*$/.test(tokenType);
  const label = isNative ? 'NIGHT' : `${tokenType.slice(0, 8)}…`;
  const units = Number(raw) / 1e9;
  const shown = units >= 1000 ? units.toFixed(0) : units.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${shown} ${label}`;
}

function ErrorNote({ error, onRetry }: { error: WalletError; onRetry: () => void }) {
  if (error.kind === 'not-installed') {
    return (
      <div className="note error" role="alert">
        <b>No Midnight wallet detected.</b> {error.message}
        <div style={{ marginTop: 8 }}>
          <a href={LACE_STORE_URL} target="_blank" rel="noreferrer">
            Install Lace →
          </a>
        </div>
      </div>
    );
  }
  if (error.kind === 'user-rejected') {
    return (
      <div className="note error" role="alert">
        <b>Connection rejected.</b> {error.message}
        <div style={{ marginTop: 8 }}>
          <button className="btn ghost" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (error.kind === 'wrong-network') {
    return (
      <div className="note error" role="alert">
        <b>Wrong network.</b> {error.message}
        <div style={{ marginTop: 8 }}>
          <button className="btn ghost" onClick={onRetry}>
            Reconnect
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="note error" role="alert">
      <b>Wallet error.</b> {error.message}
      <div style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

export default function WalletConnect({ conn }: { conn: MidnightConnection }) {
  const { status, error, unshieldedAddress, shieldedAddress, networkId, balances } = conn;

  if (status === 'connected') {
    const entries = balances ? Object.entries(balances) : [];
    return (
      <div className="panel" data-testid="wallet-connected">
        <h2>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--ok)',
            }}
          />{' '}
          Wallet connected
        </h2>
        <p className="sub">
          Network <span className="pill open">{networkId}</span>
        </p>

        <div className="facts" style={{ marginBottom: 12 }}>
          <div className="fact">
            <div className="k">Unshielded address</div>
            <div className="v small" title={unshieldedAddress ?? undefined}>
              {unshieldedAddress ? shortAddress(unshieldedAddress) : '—'}
            </div>
          </div>
          <div className="fact">
            <div className="k">Shielded address</div>
            <div className="v small" title={shieldedAddress ?? undefined}>
              {shieldedAddress ? shortAddress(shieldedAddress) : '—'}
            </div>
          </div>
          {entries.map(([token, raw]) => (
            <div className="fact" key={token}>
              <div className="k">Balance</div>
              <div className="v">{formatBalance(token, raw)}</div>
            </div>
          ))}
        </div>

        <button className="btn ghost" onClick={conn.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="panel" data-testid="wallet-connecting">
        <h2>
          <span className="spinner" /> Waiting for Lace…
        </h2>
        <p className="sub">Approve the connection request in the wallet window.</p>
      </div>
    );
  }

  return (
    <div className="panel" data-testid="wallet-idle">
      <h2>Connect your wallet</h2>
      <p className="sub">
        HushPot runs on Midnight <b>Preprod</b> and proves your pledge locally in Lace — the
        amount never leaves your wallet in the clear.
      </p>
      <button className="btn primary" onClick={() => void conn.connect()}>
        Connect Lace
      </button>
      {error && <ErrorNote error={error} onRetry={() => void conn.connect()} />}
    </div>
  );
}
