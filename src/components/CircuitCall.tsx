// CircuitCall — the hero flow: join the pot with a hidden pledge, then prove
// "my pledge is at least T" without revealing the amount.
//
// What the user sees: the amount field is replaced by a masked value the
// moment it is committed; the proof step shows only validity + a tx id. What
// the chain sees: a join anchor and a proof — never the amount.

import { useMemo, useRef, useState } from 'react';
import type { MidnightConnection } from '../hooks/useMidnight';
import { preloadCircuit } from '../midnight/zkAssets';
import {
  freshMemberSecret,
  joinPot,
  pledgePot,
  provePledgeAtLeast,
} from '../midnight/hushpotClient';
import type { PotFactsData } from '../midnight/potFacts';

type Phase = 'idle' | 'proving' | 'done' | 'error';

interface StepState {
  phase: Phase;
  txId: string | null;
  error: string | null;
}

const initialStep: StepState = { phase: 'idle', txId: null, error: null };

function TxLine({ txId }: { txId: string }) {
  return (
    <div className="tx">
      tx <span title={txId}>{txId.slice(0, 18)}…</span>
    </div>
  );
}

export default function CircuitCall({
  conn,
  facts,
}: {
  conn: MidnightConnection;
  facts: PotFactsData | null;
}) {
  const [amount, setAmount] = useState('');
  const [threshold, setThreshold] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [pledged, setPledged] = useState(false);
  const [joinStep, setJoinStep] = useState<StepState>(initialStep);
  const [pledgeStep, setPledgeStep] = useState<StepState>(initialStep);
  const [proofStep, setProofStep] = useState<StepState>(initialStep);

  // Member identity for this session only.
  const skRef = useRef<Uint8Array | null>(null);
  const amountRef = useRef<bigint | null>(null);
  const ensureSecret = (): { sk: Uint8Array; amount: bigint } | null => {
    const amountBig =
      amountRef.current ?? (amount.trim() !== '' ? BigInt(amount.trim()) : null);
    if (amountBig === null || amountBig <= 0n) return null;
    if (!skRef.current) skRef.current = freshMemberSecret();
    amountRef.current = amountBig;
    return { sk: skRef.current, amount: amountBig };
  };

  const thresholdBig = useMemo(() => {
    const t = threshold.trim();
    if (t !== '') {
      try {
        return BigInt(t);
      } catch {
        return null;
      }
    }
    return facts?.minPledge ?? null;
  }, [threshold, facts]);

  const minPledge = facts?.minPledge ?? null;

  async function runJoin() {
    const secret = ensureSecret();
    if (!secret || !conn.providers) {
      setJoinStep({ ...initialStep, phase: 'error', error: 'Enter a pledge amount first.' });
      return;
    }
    setJoinStep({ phase: 'proving', txId: null, error: null });
    try {
      await preloadCircuit('join');
      const { txId } = await joinPot(conn.providers, secret.sk, secret.amount);
      setJoinStep({ phase: 'done', txId, error: null });
      setJoined(true);
    } catch (e) {
      setJoinStep({
        phase: 'error',
        txId: null,
        error: e instanceof Error ? e.message : 'Join failed.',
      });
    }
  }

  async function runPledge() {
    const secret = ensureSecret();
    if (!secret || !conn.providers) return;
    setPledgeStep({ phase: 'proving', txId: null, error: null });
    try {
      await preloadCircuit('pledge');
      const { txId } = await pledgePot(conn.providers, secret.sk, secret.amount);
      setPledgeStep({ phase: 'done', txId, error: null });
      setPledged(true);
    } catch (e) {
      setPledgeStep({
        phase: 'error',
        txId: null,
        error: e instanceof Error ? e.message : 'Pledge failed.',
      });
    }
  }

  async function runProof() {
    const secret = ensureSecret();
    if (!secret || !conn.providers || thresholdBig === null) {
      setProofStep({
        ...initialStep,
        phase: 'error',
        error: 'Set a threshold to prove against (defaults to the pot minimum).',
      });
      return;
    }
    setProofStep({ phase: 'proving', txId: null, error: null });
    try {
      await preloadCircuit('provePledgeAtLeast');
      const { txId } = await provePledgeAtLeast(
        conn.providers,
        secret.sk,
        secret.amount,
        thresholdBig,
      );
      setProofStep({ phase: 'done', txId, error: null });
    } catch (e) {
      setProofStep({
        phase: 'error',
        txId: null,
        error:
          e instanceof Error && /segment|failure|false/i.test(e.message)
            ? 'The proof was rejected: either the statement is false (pledge below threshold) or the pot refused the transition.'
            : e instanceof Error
              ? e.message
              : 'Proof failed.',
      });
    }
  }

  const connected = conn.status === 'connected';

  return (
    <div className="panel">
      <h2>Join the pot</h2>
      <p className="sub">
        Two transactions: <b>join</b> registers your hidden identity, <b>pledge</b> locks the
        amount into an on-chain commitment. Then prove a fact about it below — without ever
        revealing it.
      </p>

      {!connected && (
        <div className="note">
          Connect Lace above to interact with the pot (viewing the pot state needs no wallet).
        </div>
      )}

      <div className="field">
        <label htmlFor="pledge-amount">
          {joined ? (
            <>
              Your pledge: <span className="masked">•••••• NIGHT</span>{' '}
              <small>(hidden — held only in this session)</small>
            </>
          ) : (
            <>Pledge amount (NIGHT){minPledge !== null ? ` — pot minimum ${minPledge}` : ''}</>
          )}
        </label>
        {!joined && (
          <input
            id="pledge-amount"
            type="text"
            inputMode="numeric"
            placeholder={minPledge !== null ? `≥ ${minPledge}` : 'e.g. 25'}
            value={amount}
            disabled={!connected || joinStep.phase === 'proving'}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          />
        )}
        <div className="hint">
          The amount never leaves this tab in the clear — it is committed inside the proof.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn primary"
          disabled={!connected || joinStep.phase === 'proving' || joined}
          onClick={() => void runJoin()}
        >
          {joinStep.phase === 'proving' ? (
            <>
              <span className="spinner" /> Proving…
            </>
          ) : joined ? (
            'Joined ✓'
          ) : (
            'Join pot'
          )}
        </button>
        <button
          className="btn"
          disabled={!connected || !joined || pledged || pledgeStep.phase === 'proving'}
          onClick={() => void runPledge()}
        >
          {pledgeStep.phase === 'proving' ? (
            <>
              <span className="spinner" /> Committing…
            </>
          ) : pledged ? (
            'Pledged ✓'
          ) : (
            'Pledge'
          )}
        </button>
      </div>

      {joinStep.phase === 'done' && joinStep.txId && (
        <div className="note ok">
          <b>Joined.</b> Your membership anchor is on-chain; the amount is not.
          <TxLine txId={joinStep.txId} />
        </div>
      )}
      {joinStep.phase === 'error' && (
        <div className="note error">
          <b>Join failed.</b> {joinStep.error}
        </div>
      )}
      {pledgeStep.phase === 'done' && pledgeStep.txId && (
        <div className="note ok">
          <b>Pledged.</b> A salted commitment replaced the amount on-chain.
          <TxLine txId={pledgeStep.txId} />
        </div>
      )}
      {pledgeStep.phase === 'error' && (
        <div className="note error">
          <b>Pledge failed.</b> {pledgeStep.error}
        </div>
      )}

      <div className="divider" />

      <h2>Prove pledge ≥ threshold</h2>
      <p className="sub">
        Runs a zero-knowledge proof in your wallet: the chain learns <i>that</i> your pledge
        clears the bar — not <i>what</i> it is.
      </p>

      <div className="field">
        <label htmlFor="proof-threshold">
          Threshold (NIGHT){minPledge !== null && !threshold ? ` — default: pot minimum ${minPledge}` : ''}
        </label>
        <input
          id="proof-threshold"
          type="text"
          inputMode="numeric"
          placeholder={minPledge !== null ? String(minPledge) : 'e.g. 10'}
          value={threshold}
          disabled={!connected || proofStep.phase === 'proving'}
          onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </div>

      <button
        className="btn primary"
        disabled={!connected || !pledged || proofStep.phase === 'proving'}
        onClick={() => void runProof()}
      >
        {proofStep.phase === 'proving' ? (
          <>
            <span className="spinner" /> Proving locally…
          </>
        ) : (
          'Prove without revealing'
        )}
      </button>

      {proofStep.phase === 'done' && proofStep.txId && (
        <div className="note ok">
          <b>Proved without revealing your input.</b> The chain now holds a verified statement:
          your pledge ≥ {String(thresholdBig ?? minPledge)} NIGHT — and nothing more.
          <TxLine txId={proofStep.txId} />
        </div>
      )}
      {proofStep.phase === 'error' && (
        <div className="note error">
          <b>Proof failed.</b> {proofStep.error}
        </div>
      )}

      <div className="privacy-banner">
        Observer's view: membership anchor · commitment · proof validity. Not visible: your
        amount, your balance, your keys.
      </div>
    </div>
  );
}
