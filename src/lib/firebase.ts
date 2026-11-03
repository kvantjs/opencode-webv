import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore'
import config from '../../firebase-applet-config.json'

const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
}

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app, config.firestoreDatabaseId)

// Test connection on boot per Firebase skill guidelines
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'))
    return true
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase Firestore is offline or checking connection.')
      return false
    }
    // Document not existing is a normal successful server reach
    return true
  }
}

// Auto sign-in anonymously for web sessions
export async function ensureAuth() {
  if (typeof window === 'undefined') return null
  if (auth.currentUser) return auth.currentUser
  try {
    const cred = await signInAnonymously(auth)
    return cred.user
  } catch (err) {
    console.warn('Anonymous sign-in error:', err)
    return null
  }
}

if (typeof window !== 'undefined') {
  void ensureAuth()
  void testConnection()
}
