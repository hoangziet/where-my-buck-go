"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "@/lib/api";

interface AuthState {
  username: string | null;
  loading: boolean;
  sessionExpired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  invalidate: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((res) => setUsername(res.username))
      .catch(() => setUsername(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.setSessionExpiredHandler(() => {
      setSessionExpired(true);
      setUsername(null);
    });
    return () => api.setSessionExpiredHandler(null);
  }, []);

  const login = useCallback(async (user: string, password: string) => {
    const res = await api.login(user, password);
    setUsername(res.username);
    setSessionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUsername(null);
  }, []);

  const invalidate = useCallback(() => setUsername(null), []);

  return (
    <AuthContext.Provider value={{ username, loading, sessionExpired, login, logout, invalidate }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
