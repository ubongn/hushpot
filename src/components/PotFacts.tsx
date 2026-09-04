// PotFacts — live public pot state from the Midnight indexer (no wallet
// needed). Shows exactly what a chain observer can see: membership counts and
// pot parameters — never pledge amounts.

import { useCallback, useEffect, useState } from 'react';
import { fetchPotFacts, PotState, type PotFactsData } from '../midnight/potFacts';

const REFRESH_MS = 30_000;

export default function PotFacts({ onFacts }: { onFacts?: (facts: PotFactsData) => void }) {
  const [facts, setFacts] = useState<PotFactsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await fetchPotFacts();
      setFacts(next);
      setError(null);
      onFacts?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach the indexer.');
    } finally {
      setLoading(false);
    }
  }, [onFacts]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const statePill =
    facts?.state === PotState.OPEN ? (
      <span className="pill open">Open</span>
    ) : (
      <span className="pill closed">Closed</span>
    );

  return (
    <div className="panel">
      <h2>
        Pot state
        {loading && <span className="spinner" />}
        {!loading && (
          <button
            className="btn ghost small-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => void load()}
          >
            Refresh
          </button>
        )}
      </h2>
      <p className="sub">
        Public committed state, read from the Preprod indexer. Auto-refreshes every 30s.
      </p>

      {error && (
        <div className="note error" role="alert">
          <b>Indexer unreachable.</b> {error}
        </div>
      )}

      {!error && (
        <div className="facts">
          <div className="fact">
            <div className="k">Status</div>
            <div className="v">{statePill}</div>
          </div>
          <div className="fact">
            <div className="k">Members</div>
            <div className="v">
              {facts ? `${facts.memberCount} / ${facts.capacity}` : '…'}
            </div>
          </div>
          <div className="fact">
            <div className="k">Pledges</div>
            <div className="v">{facts ? `${facts.pledgeCount}` : '…'}</div>
          </div>
          <div className="fact">
            <div className="k">Min pledge</div>
            <div className="v">{facts ? `${facts.minPledge} NIGHT` : '…'}</div>
          </div>
          <div className="fact">
            <div className="k">Claims</div>
            <div className="v">{facts ? `${facts.claimCount}` : '…'}</div>
          </div>
        </div>
      )}

      <div className="privacy-banner">
        This panel shows everything an on-chain observer can see: counts and parameters.
        Individual pledge amounts are commitments — they never appear here.
      </div>
    </div>
  );
}
