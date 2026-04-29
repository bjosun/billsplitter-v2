import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyB22d4lCqyoBHlJhNAbVhGu5j5d3KUGGFo",
  authDomain: "billsplitter-v2.firebaseapp.com",
  projectId: "billsplitter-v2",
  storageBucket: "billsplitter-v2.firebasestorage.app",
  messagingSenderId: "281838372829",
  appId: "1:281838372829:web:832fea3a9a12b0c8181834",
  measurementId: "G-L7BHR7522E"
};

const app = initializeApp(firebaseConfig);
getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
