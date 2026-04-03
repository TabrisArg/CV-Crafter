import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, onSnapshot, deleteDoc, getDocFromServer } from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase SDK
console.log("[DEBUG] Full Firebase Config:", JSON.stringify({ ...firebaseConfig, apiKey: "REDACTED" }));
console.log("[DEBUG] Initializing Firebase with Project ID:", firebaseConfig.projectId);
const app = initializeApp(firebaseConfig);

// Use the provided database ID if it's not the default one
const dbId = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? firebaseConfig.firestoreDatabaseId
  : undefined;

console.log("[DEBUG] Using Firestore Database ID:", dbId || "(default)");

export const db = dbId ? getFirestore(app, dbId) : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Auth functions
export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Save user profile to Firestore
    const userPath = `users/${user.uid}`;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        id: user.uid,
        email: user.email || '',
        name: user.displayName || user.email?.split('@')[0] || 'Anonymous User',
        picture: user.photoURL || ''
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
    
    return user;
  } catch (error) {
    console.error('Error logging in with Google:', error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error logging out:', error);
    throw error;
  }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  if (errorMessage.includes('Database') && errorMessage.includes('not found')) {
    console.error(`CRITICAL: The Firestore database "${firebaseConfig.firestoreDatabaseId || '(default)'}" was not found in project "${firebaseConfig.projectId}". Please verify the Project ID and Database ID in your Firebase Console.`);
  } else if (errorMessage.includes('project') && errorMessage.includes('not found')) {
    console.error(`CRITICAL: The Firebase project "${firebaseConfig.projectId}" was not found. Please check your Project ID in firebase-applet-config.json.`);
  }

  throw new Error(JSON.stringify(errInfo));
}

// Test connection
async function testConnection() {
  try {
    // Attempt to fetch a non-existent doc to test connectivity
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. Ensure the Firestore Database has been created in the Firebase Console.");
    } else if (errorMessage.includes('Database') && errorMessage.includes('not found')) {
      console.error(`CRITICAL: The Firestore database "${firebaseConfig.firestoreDatabaseId || '(default)'}" was not found in project "${firebaseConfig.projectId}". Please verify the Project ID and Database ID in your Firebase Console.`);
    } else if (errorMessage.includes('project') && errorMessage.includes('not found')) {
      console.error(`CRITICAL: The Firebase project "${firebaseConfig.projectId}" was not found. Please check your Project ID in firebase-applet-config.json.`);
    } else {
      console.warn("Firestore connection test notice (can be ignored if app works):", errorMessage);
    }
  }
}
testConnection();

export type { FirebaseUser };
