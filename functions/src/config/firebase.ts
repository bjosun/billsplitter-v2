import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

// Initialize Firebase Admin
// In production, Firebase Functions automatically provides credentials
// In local development, use service account file if available
let serviceAccount;
try {
  serviceAccount = require('./service-account.json');
} catch (e) {
  // Service account file not found, use default credentials (works in production)
}

admin.initializeApp({
  credential: serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault(),
});

const db = admin.firestore();
const auth = admin.auth();

export { db, auth, admin };
