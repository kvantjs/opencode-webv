import * as React from 'react'
import {
  auth,
  signInWithGoogle as firebaseSignInWithGoogle,
  signOutUser as firebaseSignOutUser,
  syncUserProfile,
  type UserProfileData,
} from './firebase'
import { onAuthStateChanged, type User } from 'firebase/auth'

interface AuthContextValue {
  user: User | null
  profile: UserProfileData | null
  loading: boolean
  userId: string
  isLoggedIn: boolean
  isAnonymous: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(auth.currentUser)
  const [profile, setProfile] = React.useState<UserProfileData | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      if (nextUser) {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('oc-user-id', nextUser.uid)
          if (nextUser.email) window.localStorage.setItem('oc-user-email', nextUser.email)
          const token = await nextUser.getIdToken().catch(() => '')
          if (token) window.localStorage.setItem('oc-user-token', token)
        }
        try {
          const prof = await syncUserProfile(nextUser)
          setProfile(prof)
        } catch {
          // ignore profile sync failure
        }
      } else {
        setProfile(null)
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('oc-user-token')
        }
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const signInWithGoogle = React.useCallback(async () => {
    setLoading(true)
    try {
      const u = await firebaseSignInWithGoogle()
      setUser(u)
      const prof = await syncUserProfile(u)
      setProfile(prof)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = React.useCallback(async () => {
    setLoading(true)
    try {
      await firebaseSignOutUser()
      setUser(null)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshProfile = React.useCallback(async () => {
    if (user) {
      const prof = await syncUserProfile(user)
      setProfile(prof)
    }
  }, [user])

  const userId = user?.uid || (typeof window !== 'undefined' ? window.localStorage.getItem('oc-user-id') || 'guest-user' : 'guest-user')
  const isLoggedIn = !!user && !user.isAnonymous
  const isAnonymous = !!user?.isAnonymous

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      userId,
      isLoggedIn,
      isAnonymous,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [user, profile, loading, userId, isLoggedIn, isAnonymous, signInWithGoogle, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) {
    // Provide a safe fallback if used outside AuthProvider
    const fallbackUserId = typeof window !== 'undefined' ? window.localStorage.getItem('oc-user-id') || 'guest-user' : 'guest-user'
    return {
      user: null,
      profile: null,
      loading: false,
      userId: fallbackUserId,
      isLoggedIn: false,
      isAnonymous: false,
      signInWithGoogle: async () => {
        await firebaseSignInWithGoogle()
      },
      signOut: async () => {
        await firebaseSignOutUser()
      },
      refreshProfile: async () => {},
    }
  }
  return context
}
