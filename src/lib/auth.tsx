import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { pb } from './pb.ts'
import type { UserRecord } from './types.ts'

interface AuthState {
  user: UserRecord | null
  signOut: () => void
}

const AuthContext = createContext<AuthState>({ user: null, signOut: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(
    pb.authStore.isValid ? (pb.authStore.record as unknown as UserRecord) : null,
  )

  useEffect(() => {
    return pb.authStore.onChange(() => {
      setUser(pb.authStore.isValid ? (pb.authStore.record as unknown as UserRecord) : null)
    })
  }, [])

  // The cached record can go stale (e.g. the operator flag flipped in the
  // dashboard) — re-fetch it once per load. Only auth failures sign out;
  // being offline keeps the cached session.
  useEffect(() => {
    if (!pb.authStore.isValid) return
    pb.collection('users')
      .authRefresh()
      .catch((err: unknown) => {
        const status = (err as { status?: number }).status
        if (status === 401 || status === 403 || status === 404) pb.authStore.clear()
      })
  }, [])

  const signOut = () => {
    pb.authStore.clear()
  }

  return <AuthContext.Provider value={{ user, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
