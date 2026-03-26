import express from 'express';
import router from './routes';

const app = express();

app.use(express.json());

app.get('/', (_req, res) => {
	res.redirect('https://github.com/Chocorot/gold-api');
});

// All API routes are namespaced under /api
app.use('/api', router);

export default app;
