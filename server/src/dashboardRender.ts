import fs from 'fs';
import path from 'path';
import { deflateSync, crc32 } from 'zlib';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { DashboardData, TemperatureSensor, loadDashboardData } from './dashboardTemplate';

export const DASHBOARD_WIDTH = 480;
export const DASHBOARD_HEIGHT = 800;

const FA = {
  moon: '\uf186',
  cloud: '\uf0c2',
  smog: '\uf75f',
  cloudMeatball: '\uf73b',
  bolt: '\uf0e7',
  cloudBolt: '\uf76c',
  cloudSun: '\uf6c4',
  cloudShowersHeavy: '\uf740',
  cloudRain: '\uf73d',
  snowflake: '\uf2dc',
  sun: '\uf185',
  wind: '\uf72e',
  triangleExclamation: '\uf071',
  question: '?',
  temperatureThreeQuarters: '\uf2c8',
  droplet: '\uf043',
  water: '\uf773',
  arrowDown: '\uf063',
  arrowUp: '\uf062',
  batteryFull: '\uf240',
  batteryThreeQuarters: '\uf241',
  batteryHalf: '\uf242',
  batteryQuarter: '\uf243',
  batteryEmpty: '\uf244',
} as const;

const WEATHER_ICONS: { [key: string]: string } = {
  'clear-night': FA.moon,
  'cloudy': FA.cloud,
  'fog': FA.smog,
  'hail': FA.cloudMeatball,
  'lightning': FA.bolt,
  'lightning-rainy': FA.cloudBolt,
  'partlycloudy': FA.cloudSun,
  'pouring': FA.cloudShowersHeavy,
  'rainy': FA.cloudRain,
  'snowy': FA.snowflake,
  'snowy-rainy': FA.cloudRain, // fa-cloud-snow would actually be a better fit, but is only available in pro version of fontawesome
  'sunny': FA.sun,
  'windy': FA.wind,
  'windy-variant': FA.wind,
  'exceptional': FA.triangleExclamation,
  'unknown': FA.question
};

type Style = Record<string, string | number>;
type Child = string | SatoriNode | undefined | false;
type SatoriNode = {
  type: string;
  props: {
    style: Style;
    children?: string | SatoriNode | (string | SatoriNode)[];
  };
};

function h(style: Style, ...children: Child[]): SatoriNode {
  const filtered = children.filter((c): c is string | SatoriNode => c !== undefined && c !== false);
  return {
    type: 'div',
    props: {
      style,
      children: filtered.length <= 1 ? filtered[0] : filtered
    }
  };
}

function icon(char: string, fontSize: number): SatoriNode {
  return h({
    fontFamily: 'Font Awesome 6 Free',
    fontWeight: 900,
    fontSize,
    lineHeight: 1
  }, char);
}

function formatLocalTime(isoString: string, timezone: string = 'Europe/Berlin'): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('de-DE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function germanDateParts(): { weekday: string; date: string } {
  const now = new Date();
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return {
    weekday: weekdays[now.getDay()],
    date: `${now.getDate()}. ${months[now.getMonth()]}`
  };
}

function batteryIcon(battery: number): string {
  if (battery >= 87) return FA.batteryFull;
  if (battery >= 63) return FA.batteryThreeQuarters;
  if (battery >= 37) return FA.batteryHalf;
  if (battery >= 12) return FA.batteryQuarter;
  return FA.batteryEmpty;
}

function roomSection(sensors: TemperatureSensor, isLast: boolean): SatoriNode {
  return h(
    {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      backgroundColor: 'white',
      padding: '2px 0',
      ...(isLast ? {} : {
        borderBottomWidth: 2,
        borderBottomStyle: 'solid',
        borderBottomColor: 'black'
      })
    },
    h({
      fontSize: 36,
      fontWeight: 700,
      color: 'black',
      marginBottom: -12,
      width: '100%',
      display: 'flex',
      justifyContent: 'center'
    }, sensors.title),
    h(
      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
      h(
        { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 56, color: 'black' },
        icon(FA.temperatureThreeQuarters, 28),
        `${sensors.temperature.toFixed(1)}°C`
      ),
      h(
        { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 56, color: 'black' },
        icon(FA.droplet, 28),
        `${sensors.humidity.toFixed(1)}%`
      )
    ),
    h(
      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
      h(
        { display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 26, color: 'black' },
        icon(FA.water, 26),
        `${sensors.dewPoint.toFixed(1)}°C`
      ),
      h(
        { display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 26, color: 'black' },
        icon(FA.arrowDown, 26),
        `${sensors.min.toFixed(1)}°C`,
        icon(FA.arrowUp, 26),
        `${sensors.max.toFixed(1)}°C`
      ),
      sensors.battery !== undefined && h(
        { display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 26, color: 'black' },
        icon(batteryIcon(sensors.battery), 26)
      )
    )
  );
}

function dashboardTree(data: DashboardData): SatoriNode {
  const weatherIcon = WEATHER_ICONS[data.weatherState] || WEATHER_ICONS['unknown'];
  const { weekday, date } = germanDateParts();
  const rooms = Object.values(data.temperatureSensors);

  return h(
    {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: 'white',
      padding: '5px 15px',
      fontFamily: 'Noto Sans',
      color: 'black'
    },
    h(
      {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 15,
        fontSize: 36,
        fontWeight: 700,
        color: 'black',
        marginBottom: 15
      },
      icon(weatherIcon, 100),
      h(
        { display: 'flex', flexDirection: 'column' },
        h({}, weekday),
        h({}, date),
        data.sunriseTime && data.sunsetTime && h(
          {
            display: 'flex',
            width: '100%',
            gap: 15,
            fontSize: 32,
            justifyContent: 'space-around'
          },
          h(
            { display: 'flex', alignItems: 'center', gap: 5 },
            icon(FA.sun, 32),
            formatLocalTime(data.sunriseTime)
          ),
          h(
            { display: 'flex', alignItems: 'center', gap: 5 },
            icon(FA.moon, 32),
            formatLocalTime(data.sunsetTime)
          )
        )
      )
    ),
    ...rooms.map((sensors, i) => roomSection(sensors, i === rooms.length - 1))
  );
}

const fonts = [
  {
    name: 'Noto Sans',
    data: fs.readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff')),
    weight: 400 as const,
    style: 'normal' as const
  },
  {
    name: 'Noto Sans',
    data: fs.readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff')),
    weight: 700 as const,
    style: 'normal' as const
  },
  {
    name: 'Font Awesome 6 Free',
    data: fs.readFileSync(path.join(__dirname, '../public/assets/fontawesome/webfonts/fa-solid-900.ttf')),
    weight: 900 as const,
    style: 'normal' as const
  }
];

export async function dashboardDataToSvg(data: DashboardData): Promise<string> {
  return satori(dashboardTree(data) as never, {
    width: DASHBOARD_WIDTH,
    height: DASHBOARD_HEIGHT,
    fonts
  });
}

export async function renderDashboardSvg(): Promise<string> {
  const data = await loadDashboardData();
  return dashboardDataToSvg(data);
}

export interface BlackWhiteImage {
  width: number;
  height: number;
  gray: Buffer;
}

export function rasterizeToBlackWhite(svg: string): BlackWhiteImage {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: DASHBOARD_WIDTH },
    font: { loadSystemFonts: false }
  }).render();

  const { pixels, width, height } = rendered;
  const gray = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const brightness = (r + g + b) / 3;
    gray[i] = brightness > 128 ? 255 : 0;
  }

  return { width, height, gray };
}

export function encodePbm(image: BlackWhiteImage): Buffer {
  const { width, height, gray } = image;
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
      const isWhite = gray[y * width + x] > 128;

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

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function encodePng(image: BlackWhiteImage): Buffer {
  const { width, height, gray } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale

  const raw = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0;
    gray.copy(raw, y * (1 + width) + 1, y * width, y * width + width);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
