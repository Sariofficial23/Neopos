import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler, type Me } from './api'
import { setDayStartHour } from './period'

type Session = {
  me: Me | null
  loading: boolean
  signIn: (token: string) => Promise<void>
  signOut: () => void
  can: (perm: string) => boolean
}

const SessionContext = createContext<Session>(null!)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(() => getToken() !== null)

  const signOut = useCallback(() => {
    setToken(null)
    setMe(null)
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await api<Me>('/auth/me')
      setDayStartHour(next.tenant?.dayStartHour)
      setMe(next)
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(signOut)
    if (getToken()) void load()
  }, [load, signOut])

  const signIn = useCallback(
    async (token: string) => {
      setToken(token)
      setLoading(true)
      await load()
    },
    [load],
  )

  const can = useCallback((perm: string) => !!me?.user.role.permissions.includes(perm), [me])

  return (
    <SessionContext.Provider value={{ me, loading, signIn, signOut, can }}>
      {children}
    </SessionContext.Provider>
  )
}

export const useSession = () => useContext(SessionContext)
