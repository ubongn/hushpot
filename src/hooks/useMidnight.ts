// useMidnight — React hook binding the Lace dapp-connector to HushPot.
//
// Handles: wallet detection (window.midnight.lace), connect to Preprod,
// connection-state tracking (unshielded address, NIGHT balance, network),
// error classification for the UI, and polling getConnectionStatus so a
// wallet-side disconnect (extension off, account locked) is noticed.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { buildHushpotProviders, type HushpotProviders } from '../midnight/providers';
import { TARGET_NETWORK_ID } from '../midnight/hushpot';

export type WalletErrorKind =
  | 'not-installed' // no Lace (or any Midnight wallet) in window.midnight
  | 'user-rejected' // user dismissed the connect prompt
  | 'wrong-network' // wallet connected, but not to Preprod
  | 'wallet-error'; // anything the wallet API threw

export interface WalletError {
  kind: WalletErrorKind;
  message: string;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected';

const POLL_MS = 10_000;

/** Find the Lace InitialAPI among injected wallets (key 'lace' or rdns match). */
function findLace(): InitialAPI | null {
  const wallets = window.midnight;
  if (!wallets) return null;
  const byKey = wallets['lace'];
  if (byKey) return byKey;
  const entry = Object.values(wallets).find((w) => w?.rdns?.toLowerCase().includes('lace'));
  return entry ?? null;
}

interface APIErrorShape {
  type?: string;
  code?: string;
  message?: string;
}

function classifyWalletError(err: unknown): WalletError {
  const e = err as APIErrorShape;
  if (e?.type === 'DAppConnectorAPIError' && (e.code === 'Rejected' || e.code === 'PermissionRejected')) {
    return { kind: 'user-rejected', message: 'Connection request was rejected in the wallet.' };
  }
  return {
    kind: 'wallet-error',
    message: e instanceof Error ? e.message : 'The wallet reported an unexpected error.',
  };
}

export interface MidnightConnection {
  status: ConnectionStatus;
  error: WalletError | null;
  api: ConnectedAPI | null;
  providers: HushpotProviders | null;
  unshieldedAddress: string | null;
  shieldedAddress: string | null;
  networkId: string | null;
  /** Unshielded balances keyed by token type (hex). */
  balances: Record<string, bigint> | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
}

export function useMidnight(): MidnightConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<WalletError | null>(null);
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [providers, setProviders] = useState<HushpotProviders | null>(null);
  const [unshieldedAddress, setUnshieldedAddress] = useState<string | null>(null);
  const [shieldedAddress, setShieldedAddress] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, bigint> | null>(null);

  const apiRef = useRef<ConnectedAPI | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    stopPolling();
    apiRef.current = null;
    setApi(null);
    setProviders(null);
    setUnshieldedAddress(null);
    setShieldedAddress(null);
    setNetworkId(null);
    setBalances(null);
  }, [stopPolling]);

  const refreshBalances = useCallback(async () => {
    const a = apiRef.current;
    if (!a) return;
    try {
      setBalances(await a.getUnshieldedBalances());
    } catch {
      // Balance is cosmetic; ignore transient failures.
    }
  }, []);

  const connect = useCallback(async () => {
    if (apiRef.current) return;
    setError(null);

    const lace = findLace();
    if (!lace) {
      setError({
        kind: 'not-installed',
        message: 'No Midnight wallet found. Install the Lace browser extension to continue.',
      });
      return;
    }

    setStatus('connecting');
    try {
      const connected = await lace.connect(TARGET_NETWORK_ID);
      apiRef.current = connected;

      // The network hint is non-binding; verify what we actually got.
      const config = await connected.getConfiguration();
      if (config.networkId !== TARGET_NETWORK_ID) {
        teardown();
        setStatus('idle');
        setError({
          kind: 'wrong-network',
          message: `Wallet is on '${config.networkId}', but HushPot lives on '${TARGET_NETWORK_ID}'. Switch the wallet network and reconnect.`,
        });
        return;
      }

      const [{ unshieldedAddress: unshielded }, { shieldedAddress: shielded }] =
        await Promise.all([connected.getUnshieldedAddress(), connected.getShieldedAddresses()]);

      const built = await buildHushpotProviders(connected);

      setApi(connected);
      setProviders(built);
      setUnshieldedAddress(unshielded);
      setShieldedAddress(shielded);
      setNetworkId(config.networkId);
      setStatus('connected');
      void refreshBalances();

      // Watch for wallet-side disconnects (extension disabled, window closed).
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        const a = apiRef.current;
        if (!a) return stopPolling();
        try {
          const s = await a.getConnectionStatus();
          if (s.status === 'disconnected') {
            teardown();
            setStatus('idle');
          }
        } catch {
          teardown();
          setStatus('idle');
        }
      }, POLL_MS);
    } catch (err) {
      teardown();
      setStatus('idle');
      setError(classifyWalletError(err));
    }
  }, [refreshBalances, stopPolling, teardown]);

  const disconnect = useCallback(() => {
    teardown();
    setStatus('idle');
  }, [teardown]);

  // Cleanup on unmount.
  useEffect(() => stopPolling, [stopPolling]);

  return {
    status,
    error,
    api,
    providers,
    unshieldedAddress,
    shieldedAddress,
    networkId,
    balances,
    connect,
    disconnect,
    refreshBalances,
  };
}
