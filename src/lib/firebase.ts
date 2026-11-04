import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  type User,
} from 'firebase/auth'
import { getFirestore, doc, setDoc, getDoc, getDocFromServer } from 'firebase/firestore'
import { firebaseConfig, FIRESTORE_DATABASE_ID, hasFirebaseConfiguration } from './firebase-config'

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app, FIRESTORE_DATABASE_ID)

// Configure local persistence so user remains logged in across reloads
if (typeof window !== 'undefined') {
  void setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Firebase setPersistence warning:', err)
  })
}

// Test connection on boot per Firebase skill guidelines
export async function testConnection(): Promise<boolean> {
  if (!hasFirebaseConfiguration() || !auth.currentUser) return false
  try {
    await getDocFromServer(doc(db, 'test', 'connection'))
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/offline|permission-denied|insufficient permissions/i.test(message)) return false
    // A missing test document still proves that the authenticated server is reachable.
    if (/not-found|not found/i.test(message)) return true
    console.warn('Firebase Firestore connection check failed:', message)
    return false
  }
}

export interface UserProfileData {
  id: string
  userId: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  createdAt: number
  updatedAt: number
}

// Sync user profile to Firestore `/users/{userId}`
export async function syncUserProfile(user: User): Promise<UserProfileData | null> {
  const path = `users/${user.uid}`
  try {
    const userRef = doc(db, 'users', user.uid)
    const existingSnap = await getDoc(userRef)
    const now = Date.now()
    const data: UserProfileData = {
      id: user.uid,
      userId: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? (user.isAnonymous ? 'Guest Developer' : 'User'),
      photoURL: user.photoURL ?? null,
      createdAt: existingSnap.exists() ? (existingSnap.data().createdAt || now) : now,
      updatedAt: now,
    }
    await setDoc(userRef, data, { merge: true })
    return data
  } catch (err) {
    console.warn('UserProfile sync warning:', err)
    return null
  }
}

// Sign In with Google Popup
export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  try {
    const res = await signInWithPopup(auth, provider)
    if (res.user) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('oc-user-id', res.user.uid)
        window.localStorage.setItem('oc-user-email', res.user.email || '')
        window.localStorage.setItem('oc-user-name', res.user.displayName || '')
        const token = await res.user.getIdToken()
        window.localStorage.setItem('oc-user-token', token)
      }
      void syncUserProfile(res.user)
    }
    return res.user
  } catch (error) {
    console.error('Google Sign-In failed:', error)
    throw error
  }
}

// Sign Out
export async function signOutUser(): Promise<void> {
  try {
    await signOut(auth)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('oc-user-id')
      window.localStorage.removeItem('oc-user-email')
      window.localStorage.removeItem('oc-user-name')
      window.localStorage.removeItem('oc-user-token')
    }
  } catch (err) {
    console.error('Sign-out failed:', err)
    throw err
  }
}

// Ensure auth session or fallback
export async function ensureAuth(): Promise<User | null> {
  if (typeof window === 'undefined') return null
  if (auth.currentUser) return auth.currentUser

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe()
      if (user) {
        window.localStorage.setItem('oc-user-id', user.uid)
        if (user.email) window.localStorage.setItem('oc-user-email', user.email)
        const token = await user.getIdToken().catch(() => '')
        if (token) window.localStorage.setItem('oc-user-token', token)
        resolve(user)
      } else {
        // Do not force anonymous sign in if user wants to see login prompt
        const savedUid = window.localStorage.getItem('oc-user-id')
        if (savedUid && !savedUid.startsWith('guest_')) {
          resolve(null)
          return
        }
        // Anonymous auth is intentionally not forced: many Firebase projects
        // disable it, and doing so creates noisy ADMIN_ONLY_OPERATION errors.
        resolve(null)
      }
    })
  })
}

if (typeof window !== 'undefined') {
  void ensureAuth()
  void testConnection()
}
