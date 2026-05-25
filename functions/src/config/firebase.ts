import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// In production, Firebase Functions provides credentials automatically.
// In local development, look for service-account.json at the functions/ root
// (README convention), and respect FIREBASE_SERVICE_ACCOUNT_PATH if set.
function loadServiceAccount(): admin.ServiceAccount | undefined {
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  // After tsc, __dirname is lib/config; the functions/ root is two levels up.
  const candidates = [
    ...(envPath ? [path.resolve(process.cwd(), envPath)] : []),
    path.resolve(__dirname, '../../service-account.json'),
    path.resolve(process.cwd(), 'service-account.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  return undefined;
}

const serviceAccount = loadServiceAccount();

admin.initializeApp({
  credential: serviceAccount
    ? admin.credential.cert(serviceAccount)
    : admin.credential.applicationDefault(),
});

const db = admin.firestore();
const auth = admin.auth();

export { db, auth, admin };
