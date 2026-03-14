import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../config';

initializeApp({ credential: applicationDefault() });

const db = getFirestore(config.firestoreDatabase);

export default db;
