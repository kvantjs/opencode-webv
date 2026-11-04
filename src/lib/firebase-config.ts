import config from '../../firebase-applet-config.json'

export const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
} as const

export const FIRESTORE_DATABASE_ID = config.firestoreDatabaseId || '(default)'

export function hasFirebaseConfiguration(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.appId &&
      firebaseConfig.authDomain,
  )
}
