import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  enableIndexedDbPersistence,
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  getDocFromServer, 
  FirestoreError,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Initialize Firestore with settings
export const db = initializeFirestore(app, {}, firebaseConfig.firestoreDatabaseId || '(default)');

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open, persistence can only be enabled in one tab at a time.
    console.warn('Firestore persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    // The current browser does not support all of the features required to enable persistence
    console.warn('Firestore persistence failed: browser not supported');
  }
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Export common Firestore functions
export { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  getDocFromServer,
  signInWithPopup,
  onAuthStateChanged,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove
};

export type { User, FirestoreError };

// Test connection to Firestore
async function testConnection() {
  try {
    // Use getDoc instead of getDocFromServer to allow cache if server is temporarily unreachable
    await getDoc(doc(db, 'test', 'connection'));
    console.log("Firestore connection test successful (or using cache).");
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    } else {
      console.error("Firestore connection test failed:", error);
    }
  }
}
testConnection();
