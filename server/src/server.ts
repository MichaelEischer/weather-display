import express from 'express';
import dotenv from 'dotenv';
import { renderDashboardSvg, rasterizeToBlackWhite, encodePbm, encodePng } from './dashboardRender';
import { singleFlight } from './singleFlight';

dotenv.config({ quiet: true });

// Validate required environment variables
if (!process.env.HA_URL) {
  throw new Error('HA_URL environment variable is not set. Please set it in your .env file.');
}
if (!process.env.HA_TOKEN) {
  throw new Error('HA_TOKEN environment variable is not set. Please set it in your .env file.');
}

// Validate HA_URL format
try {
  new URL(process.env.HA_URL);
} catch (e) {
  throw new Error('HA_URL environment variable is not a valid URL. Please ensure it includes the protocol (http:// or https://).');
}

const app = express();
const PORT = process.env.PORT || 3000;

const getBlackWhiteDashboard = singleFlight(async () => {
  const svg = await renderDashboardSvg();
  return rasterizeToBlackWhite(svg);
});

app.get('/', async (_req, res) => {
  const svg = await renderDashboardSvg();
  res.set('Content-Type', 'image/svg+xml; charset=utf-8');
  res.send(svg);
});

app.get('/dashboard.pbm', async (_req, res) => {
  const image = await getBlackWhiteDashboard();
  res.set('Content-Type', 'application/octet-stream');
  res.send(encodePbm(image));
});

app.get('/dashboard.png', async (_req, res) => {
  const image = await getBlackWhiteDashboard();
  res.set('Content-Type', 'image/png');
  res.send(encodePng(image));
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
