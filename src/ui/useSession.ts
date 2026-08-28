/**
 * The signed-in session, as a hook.
 *
 * On mount it asks the server who we are (the httpOnly cookie does the authenticating), so a returning
 * player with a live session is recognised without re-entering anything. Everything the account UI needs
 * — the current profile, whether we are loading, and the mutating actions — comes from here, so no other
 * component talks to the auth API directly.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../net/api.ts';
import type { ApiError } from '../net/api.ts';
import type { PublicProfile } from '../profile/profile.ts';
import type { Avatar } from '../profile/avatar.ts';

export interface Session {
  /** The signed-in profile, or null when signed out. `undefined` means we have not checked yet. */
  profile: PublicProfile | null | undefined;
  register: (input: { username: string; password: string; displayName?: string; avatar?: Avatar }) => Promise<ApiError | null>;
  login: (username: string, password: string) => Promise<ApiError | null>;
  logout: () => Promise<void>;
  updateProfile: (input: { displayName?: string; bio?: string; status?: string; avatar?: Avatar }) => Promise<ApiError | null>;
  /** Reports a rated match result to the server, updating the signed-in profile's rating and badges. */
  recordLadderResult: (input: { opponentRating: number; score: 0 | 0.5 | 1; gymId?: string }) => Promise<ApiError | null>;
  /** Claims a reward Pokémon into the collection, updating the signed-in profile's dex count. */
  claimReward: (species: string) => Promise<ApiError | null>;
}

export function useSession(): Session {
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api.me().then((r) => {
      if (live) setProfile(r.ok ? r.value.profile : null);
    });
    return () => {
      live = false;
    };
  }, []);

  const register: Session['register'] = useCallback(async (input) => {
    const r = await api.register(input);
    if (r.ok) {
      setProfile(r.value.profile);
      return null;
    }
    return r.error;
  }, []);

  const login: Session['login'] = useCallback(async (username, password) => {
    const r = await api.login(username, password);
    if (r.ok) {
      setProfile(r.value.profile);
      return null;
    }
    return r.error;
  }, []);

  const logout: Session['logout'] = useCallback(async () => {
    await api.logout();
    setProfile(null);
  }, []);

  const updateProfile: Session['updateProfile'] = useCallback(async (input) => {
    const r = await api.updateProfile(input);
    if (r.ok) {
      setProfile(r.value.profile);
      return null;
    }
    return r.error;
  }, []);

  const recordLadderResult: Session['recordLadderResult'] = useCallback(async (input) => {
    const r = await api.ladderResult(input);
    if (r.ok) {
      setProfile(r.value.profile);
      return null;
    }
    return r.error;
  }, []);

  const claimReward: Session['claimReward'] = useCallback(async (species) => {
    const r = await api.claimReward(species);
    if (r.ok) {
      setProfile(r.value.profile);
      return null;
    }
    return r.error;
  }, []);

  return { profile, register, login, logout, updateProfile, recordLadderResult, claimReward };
}
