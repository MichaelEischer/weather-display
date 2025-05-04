import express, { Request, Response } from 'express';
import axios from 'axios';
import puppeteer, { Browser } from 'puppeteer';
import dotenv from 'dotenv';
import { Jimp } from 'jimp';
import { renderDashboardHtml } from './dashboardTemplate';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use('/assets', express.static('public/assets'));

// Store browser instance
let browser: Browser | null = null;

// Initialize browser
async function initBrowser() {
  browser = await puppeteer.launch({
    args: process.env.PUPPETEER_ARGS?.split(' ') || [],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
  });
}

// Helper to fetch sensor data
async function fetchSensorData() {
  const url = `${process.env.HA_URL}/api/states`;
  const headers = { Authorization: `Bearer ${process.env.HA_TOKEN}` };
  const response = await axios.get(url, { headers });
  return response.data;
}

// Helper to fetch sensor statistics
async function fetchSensorStatistics(entityId: string) {
  const url = `${process.env.HA_URL}/api/history/period?filter_entity_id=${entityId}&minimal_response&no_attributes`;
  const headers = {
    Authorization: `Bearer ${process.env.HA_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const response = await axios.get(url, { headers });
  return response.data;
}

// Helper to calculate min/max values from statistics
function calculateMinMax(statistics: any[]): { min: number; max: number } {
  if (!statistics || statistics.length === 0) {
    return { min: 0, max: 0 };
  }

  let min = Number.MAX_VALUE;
  let max = Number.MIN_VALUE;

  statistics.forEach(entry => {
    const value = parseFloat(entry.state);
    if (!isNaN(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  });

  return {
    min: min === Number.MAX_VALUE ? 0 : min,
    max: max === Number.MIN_VALUE ? 0 : max
  };
}

// Web page endpoint
app.get('/', async (req, res) => {
  const data = await fetchSensorData();
  const html = await renderDashboardHtml(data);
  res.send(html);
});

// Helper function to get dashboard screenshot
async function getDashboardScreenshot(): Promise<Buffer> {
  if (!browser) {
    throw new Error('Browser not initialized');
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 800 });
  await page.goto(`http://localhost:${PORT}` , { waitUntil: 'networkidle0' });
  const png = await page.screenshot({ type: 'png', optimizeForSpeed: true });
  await page.close();

  return Buffer.from(png);
}

// Helper function to convert image to black and white
async function convertToBlackWhite(png: Buffer) {
  const image = await Jimp.read(png);
  return image
    .greyscale()
    .threshold({ max: 128 });
}

// Helper function to convert black and white image to binary PBM format
function convertToPBM(image: any): Buffer {
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  
  // Calculate bytes per row (rounded up to nearest byte)
  const bytesPerRow = Math.ceil(width / 8);
  const totalBytes = bytesPerRow * height;
  
  // Create buffer for PBM data (header + pixel data)
  const header = `P4\n${width} ${height}\n`;
  const buffer = Buffer.alloc(header.length + totalBytes);
  
  // Write PBM header
  buffer.write(header, 0);
  const headerLength = header.length;
  
  // Process each pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = image.getPixelColor(x, y);
      const r = (color >> 24) & 0xFF;
      const g = (color >> 16) & 0xFF;
      const b = (color >> 8) & 0xFF;
      const brightness = (r + g + b) / 3;
      const isWhite = brightness > 128;
      
      // Calculate position in buffer
      const byteIndex = headerLength + (y * bytesPerRow) + Math.floor(x / 8);
      const bitOffset = 7 - (x % 8); // MSB first
      
      // Set the bit (0 for white, 1 for black)
      if (!isWhite) {
        buffer[byteIndex] |= (1 << bitOffset);
      }
    }
  }

  return buffer;
}

// Binary endpoint
app.get('/dashboard.pbm', async (req, res) => {
  const png = await getDashboardScreenshot();
  const image = await convertToBlackWhite(png);
  const pbm = convertToPBM(image);

  res.set('Content-Type', 'application/octet-stream');
  res.send(pbm);
});

// Black and white PNG endpoint
app.get('/dashboard.png', async (req, res) => {
  const png = await getDashboardScreenshot();
  const image = await convertToBlackWhite(png);
  const buffer = await image.getBuffer('image/png');

  res.set('Content-Type', 'image/png');
  res.send(buffer);
});

const server = app.listen(PORT, async () => {
  await initBrowser();
  console.log(`Server running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  if (browser) {
    await browser.close();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
