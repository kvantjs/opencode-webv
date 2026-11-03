import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SessionInfo, SessionMessageInfo, Project as ApiProject } from '@opencode/client'

let firestoreDb: any = null

function getFirestoreInstance() {
  if (firestoreDb) return firestoreDb
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json')
    const configRaw = require('fs').readFileSync(configPath, 'utf-8')
    const config = JSON.parse(configRaw)

    const app = getApps().length > 0 ? getApp() : initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    })

    firestoreDb = getFirestore(app, config.firestoreDatabaseId)
    return firestoreDb
  } catch (err) {
    console.warn('Firestore initialization warning (will use resilient fallback):', err)
    return null
  }
}

export async function persistSessionToFirestore(session: SessionInfo): Promise<void> {
  const db = getFirestoreInstance()
  if (!db) return
  try {
    const sessionDocRef = doc(db, 'sessions', session.id)
    await setDoc(
      sessionDocRef,
      {
        id: session.id,
        userId: 'web-user',
        title: session.title || 'Session',
        agentMode: session.agent || 'unified',
        model: session.model?.id || 'gemini-3.8-flash',
        directory: session.location?.directory || process.cwd(),
        status: 'active',
        createdAt: session.time?.created || Date.now(),
        updatedAt: session.time?.updated || Date.now(),
        rawData: JSON.stringify(session),
      },
      { merge: true },
    )
  } catch (err) {
    console.warn(`Firestore save session [${session.id}] error:`, err)
  }
}

export async function persistMessageToFirestore(
  sessionId: string,
  message: SessionMessageInfo,
): Promise<void> {
  const db = getFirestoreInstance()
  if (!db) return
  try {
    const msgDocRef = doc(db, 'sessions', sessionId, 'messages', message.id)
    const textContent =
      'text' in message && typeof message.text === 'string'
        ? message.text
        : 'content' in message && Array.isArray(message.content)
          ? message.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n')
          : ''

    const thoughts =
      'content' in message && Array.isArray(message.content)
        ? message.content
            .filter((c: any) => c.type === 'reasoning')
            .map((c: any) => c.text)
            .join('\n')
        : ''

    await setDoc(
      msgDocRef,
      {
        id: message.id,
        sessionId,
        userId: 'web-user',
        role: message.type === 'user' ? 'user' : 'assistant',
        content: textContent,
        thoughts: thoughts || null,
        status: 'status' in message ? message.status : 'completed',
        createdAt: message.time?.created || Date.now(),
        rawMessage: JSON.stringify(message),
      },
      { merge: true },
    )
  } catch (err) {
    console.warn(`Firestore save message [${message.id}] error:`, err)
  }
}

export async function deleteSessionFromFirestore(sessionId: string): Promise<void> {
  const db = getFirestoreInstance()
  if (!db) return
  try {
    const sessionDocRef = doc(db, 'sessions', sessionId)
    await deleteDoc(sessionDocRef)
  } catch (err) {
    console.warn(`Firestore delete session [${sessionId}] error:`, err)
  }
}

export async function loadSessionsFromFirestore(): Promise<SessionInfo[] | null> {
  const db = getFirestoreInstance()
  if (!db) return null
  try {
    const sessionsCol = collection(db, 'sessions')
    const q = query(sessionsCol, orderBy('updatedAt', 'desc'), limit(100))
    const snapshot = await getDocs(q)
    const sessions: SessionInfo[] = []
    snapshot.forEach((d) => {
      const data = d.data()
      if (data.rawData) {
        try {
          sessions.push(JSON.parse(data.rawData))
        } catch {
          // fallback
        }
      }
    })
    return sessions.length > 0 ? sessions : null
  } catch (err) {
    console.warn('Firestore load sessions error:', err)
    return null
  }
}

export async function loadMessagesFromFirestore(sessionId: string): Promise<SessionMessageInfo[] | null> {
  const db = getFirestoreInstance()
  if (!db) return null
  try {
    const messagesCol = collection(db, 'sessions', sessionId, 'messages')
    const q = query(messagesCol, orderBy('createdAt', 'asc'), limit(200))
    const snapshot = await getDocs(q)
    const messages: SessionMessageInfo[] = []
    snapshot.forEach((d) => {
      const data = d.data()
      if (data.rawMessage) {
        try {
          messages.push(JSON.parse(data.rawMessage))
        } catch {
          // fallback
        }
      }
    })
    return messages.length > 0 ? messages : null
  } catch (err) {
    console.warn(`Firestore load messages for [${sessionId}] error:`, err)
    return null
  }
}
