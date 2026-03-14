import express from 'express';
import router from './routes';

const app = express();

app.use(express.json());

// All API routes are namespaced under /api
app.use('/api', router);

export default app;
