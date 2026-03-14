import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: process.env.PORT || 3000,
    twelveDataKey: process.env.TWELVE_DATA_KEY || '',
    firestoreDatabase: process.env.FIRESTORE_DATABASE || 'gold-api',
    internalApiKey: process.env.INTERNAL_API_KEY || '',
};
