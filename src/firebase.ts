import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  getDocFromServer, 
  FirestoreError,
  collection,
  query,
  where,
  or,
  getDocs,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  disableNetwork,
  enableNetwork
} from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Support custom Firebase configuration from localStorage
let firebaseConfigToUse = firebaseConfig;
if (typeof window !== 'undefined') {
  const customConfigStr = localStorage.getItem('oden_custom_firebase_config');
  if (customConfigStr) {
    try {
      firebaseConfigToUse = JSON.parse(customConfigStr);
      console.log("ODEN: Using custom Firebase configuration.");
    } catch (e) {
      console.error("ODEN: Failed to parse custom Firebase config:", e);
    }
  }
}

// Initialize Firebase SDK
const app = initializeApp(firebaseConfigToUse);

// Initialize Firestore with modern persistent cache settings
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
}, firebaseConfigToUse.firestoreDatabaseId || '(default)');

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
  or,
  getDocs,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  disableNetwork,
  enableNetwork
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
