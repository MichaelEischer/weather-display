import express from 'express';
import axios from 'axios';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { renderDashboardHtml } from './dashboardTemplate';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Helper to fetch sensor data
async function fetchSensorData() {
  const url = `${process.env.HA_URL}/api/states`;
  const headers = { Authorization: `Bearer ${process.env.HA_TOKEN}` };
  const response = await axios.get(url, { headers });
  // Filter/select your sensors here
  return response.data;
}

// Web page endpoint
app.get('/', async (req, res) => {
  const data = await fetchSensorData();
  const html = renderDashboardHtml(data);
  res.send(html);
});

// PNG endpoint
app.get('/dashboard.png', async (req, res) => {
  const data = await fetchSensorData();
  const html = renderDashboardHtml(data);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 800 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const png = await page.screenshot({ type: 'png' });
  await browser.close();

  res.set('Content-Type', 'image/png');
  res.send(png);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
