"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "@/lib/api";

interface AuthState {
  username: string | null;
  salaryModeEnabled: boolean;
  loading: boolean;
  sessionExpired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  invalidate: () => void;
  setSalaryModeEnabled: (enabled: boolean) => Promise<void>;
}

const SESSION_CHECK_RETRY_DELAYS_MS = [500, 1500, 3000];

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [salaryModeEnabled, setSalaryModeEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Only a 401 means "signed out". A home-screen app resuming from the background often has no
    // network for a moment, so transient failures are retried instead of bouncing to /login.
    async function checkSession() {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await api.me();
          if (!cancelled) {
            setUsername(res.username);
            setSalaryModeEnabledState(res.salaryModeEnabled);
          }
          return;
        } catch (err) {
          const unauthorized = err instanceof api.ApiError && err.status === 401;
          if (unauthorized || attempt >= SESSION_CHECK_RETRY_DELAYS_MS.length) {
            if (!cancelled) {
              setUsername(null);
              setSalaryModeEnabledState(false);
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, SESSION_CHECK_RETRY_DELAYS_MS[attempt]));
          if (cancelled) return;
        }
      }
    }
    checkSession().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    api.setSessionExpiredHandler(() => {
      setSessionExpired(true);
      setUsername(null);
      setSalaryModeEnabledState(false);
    });
    return () => api.setSessionExpiredHandler(null);
  }, []);

  const login = useCallback(async (user: string, password: string) => {
    const res = await api.login(user, password);
    setUsername(res.username);
    const currentUser = await api.me();
    setSalaryModeEnabledState(currentUser.salaryModeEnabled);
    setSessionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUsername(null);
    setSalaryModeEnabledState(false);
  }, []);

  const invalidate = useCallback(() => {
    setUsername(null);
    setSalaryModeEnabledState(false);
  }, []);
  const updateSalaryMode = useCallback(async (enabled: boolean) => {
    const result = await api.setSalaryMode(enabled);
    setSalaryModeEnabledState(result.salaryModeEnabled);
  }, []);

  return (
    <AuthContext.Provider value={{ username, salaryModeEnabled, loading, sessionExpired, login, logout, invalidate,
      setSalaryModeEnabled: updateSalaryMode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
