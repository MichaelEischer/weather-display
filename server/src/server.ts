import express from 'express';
import axios from 'axios';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { Jimp } from 'jimp';
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

// Binary endpoint
app.get('/dashboard.bits', async (req, res) => {
  const data = await fetchSensorData();
  const html = renderDashboardHtml(data);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 800 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const png = await page.screenshot({ type: 'png' });
  await browser.close();

  // Convert image to binary bit field
  const image = await Jimp.read(png);
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  
  // Create a buffer to hold the bit field (1 bit per pixel)
  const bitField = Buffer.alloc(Math.ceil((width * height) / 8));
  
  // Process each pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = image.getPixelColor(x, y);
      const r = (color >> 24) & 0xFF;
      const g = (color >> 16) & 0xFF;
      const b = (color >> 8) & 0xFF;
      const brightness = (r + g + b) / 3;
      const isWhite = brightness > 128;
      
      // Calculate position in bit field
      const bitIndex = y * width + x;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = 7 - (bitIndex % 8); // MSB first
      
      // Set the bit (1 for white, 0 for black)
      if (isWhite) {
        bitField[byteIndex] |= (1 << bitOffset);
      }
    }
  }

  // Send the raw binary data
  res.set('Content-Type', 'application/octet-stream');
  res.send(bitField);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
