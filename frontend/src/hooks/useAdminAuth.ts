import { useCallback, useEffect, useState } from "react";

export interface UseAdminAuth {
  isAdmin: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export function useAdminAuth(): UseAdminAuth {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/check", { credentials: "same-origin" })
      .then(async (r) => {
        if (!active) return;
        if (!r.ok) {
          setIsAdmin(false);
          return;
        }
        const data = (await r.json()) as { isAdmin?: boolean };
        setIsAdmin(Boolean(data.isAdmin));
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) return false;
      const data = (await r.json()) as { success?: boolean };
      const ok = Boolean(data.success);
      setIsAdmin(ok);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      /* session clear is best-effort client-side */
    } finally {
      setIsAdmin(false);
    }
  }, []);

  return { isAdmin, isLoading, login, logout };
}
