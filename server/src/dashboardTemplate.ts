import axios from 'axios';

interface SensorData {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}

interface TemperatureSensor {
  title: string;
  temperature: number;
  humidity: number;
  battery?: number;
  min: number;
  max: number;
  dewPoint: number;
}

interface DisplayDeviceDescriptor {
  device_id: string;
  name: string;
  entities: string[];
}

type TemperatureSensorsMap = { [location: string]: TemperatureSensor };

interface DashboardData {
  weatherState: string;
  sunriseTime?: string;
  sunsetTime?: string;
  temperatureSensors: TemperatureSensorsMap;
}

const OTHER_SENSORS = {
  weather: 'weather.forecast_home',
  sunrise: 'sensor.sun_next_rising',
  sunset: 'sensor.sun_next_dusk'
} as const;

/** Devices (and their entities) that carry the dashboard label, via HA template API. */
async function fetchDisplayDeviceDescriptor(): Promise<DisplayDeviceDescriptor[]> {
  const templateBody = `
[
{%- for dev in label_devices('Display') %}
  {
    "device_id": {{ dev | to_json }},
    "name": {{ (area_name(dev) or device_attr(dev, 'name_by_user') or device_attr(dev, 'name') or dev) | to_json }},
    "entities": {{ device_entities(dev) | select('match', '^sensor\\.') | list | to_json }}
  }{% if not loop.last %},{% endif %}
{%- endfor %}
]
`.trim();

  try {
    const url = `${process.env.HA_URL}/api/template`;
    const headers = {
      Authorization: `Bearer ${process.env.HA_TOKEN}`,
      'Content-Type': 'application/json'
    };
    const { data } = await axios.post<DisplayDeviceDescriptor[]>(url, { template: templateBody }, { headers });
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map(device => ({
      ...device,
      entities: (device.entities ?? []).filter(entityId => entityId.startsWith('sensor.'))
    }));
  } catch (e) {
    console.error('fetchDisplayDevicePlan: failed to fetch or decode template response', e);
    return [];
  }
}

function getRelevantSensorIds(displayPlan: DisplayDeviceDescriptor[]): Set<string> {
  const fromDevices = displayPlan.flatMap(d => d.entities);
  return new Set([...fromDevices, ...Object.values(OTHER_SENSORS)]);
}

function sensorRole(state: SensorData | undefined): 'temperature' | 'humidity' | 'battery' | null {
  if (!state || !state.entity_id.startsWith('sensor.')) {
    return null;
  }
  const dc = state.attributes?.device_class;
  if (dc == null || dc === '') {
    return null;
  }
  switch (dc) {
    case 'temperature':
      return 'temperature';
    case 'humidity':
      return 'humidity';
    case 'battery':
      return 'battery';
    default:
      return null;
  }
}

function pickLabeledSensorEntityIds(
  device: DisplayDeviceDescriptor,
  stateByEntity: Map<string, SensorData>
): { temperature?: string; humidity?: string; battery?: string } {
  const ids: { temperature?: string; humidity?: string; battery?: string } = {};
  for (const entityId of device.entities) {
    const role = sensorRole(stateByEntity.get(entityId));
    if (role === 'temperature' && !ids.temperature) {
      ids.temperature = entityId;
    } else if (role === 'humidity' && !ids.humidity) {
      ids.humidity = entityId;
    } else if (role === 'battery' && !ids.battery) {
      ids.battery = entityId;
    }
  }
  return ids;
}

// Data processing functions
async function fetchSensorStatistics(sensorId: string): Promise<{ min: number; max: number }> {
  const url = `${process.env.HA_URL}/api/history/period?filter_entity_id=${sensorId}&minimal_response&no_attributes`;
  const headers = {
    Authorization: `Bearer ${process.env.HA_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const response = await axios.get(url, { headers });
  return calculateMinMax(response.data[0]);
}

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

function calculateDewPoint(temperature: number, humidity: number): number {
  const a = 17.625;
  const b = 243.04;
  const alpha = ((a * temperature) / (b + temperature)) + Math.log(humidity / 100);
  return (b * alpha) / (a - alpha);
}

function formatLocalTime(isoString: string, timezone: string = 'Europe/Berlin'): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('de-DE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getGermanDate(): string {
  const now = new Date();
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const weekday = weekdays[now.getDay()];
  const day = now.getDate();
  const month = months[now.getMonth()];
  return `${weekday}<br/>${day}. ${month}`;
}

async function fetchSensorData(): Promise<SensorData[]> {
  const url = `${process.env.HA_URL}/api/states`;
  const headers = { Authorization: `Bearer ${process.env.HA_TOKEN}` };
  const response = await axios.get(url, { headers });
  return response.data;
}

async function processSensorData(
  sensorData: SensorData[],
  deviceDescriptors: DisplayDeviceDescriptor[]
): Promise<DashboardData> {
  const stateByEntity = new Map(sensorData.map(s => [s.entity_id, s]));
  const relevantSensors = sensorData.filter(s => getRelevantSensorIds(deviceDescriptors).has(s.entity_id));

  const weatherSensor = relevantSensors.find(s => s.entity_id === OTHER_SENSORS.weather);
  const sunriseSensor = relevantSensors.find(s => s.entity_id === OTHER_SENSORS.sunrise);
  const sunsetSensor = relevantSensors.find(s => s.entity_id === OTHER_SENSORS.sunset);

  const temperatureSensors: TemperatureSensorsMap = {};

  for (const device of deviceDescriptors) {
    const { temperature: temperatureEntityId, humidity: humidityEntityId, battery: batteryEntityId } =
      pickLabeledSensorEntityIds(device, stateByEntity);

    if (!temperatureEntityId) {
      continue;
    }

    const title = device.name || device.device_id;
    const key = device.device_id;
    const tempState = stateByEntity.get(temperatureEntityId);
    const humState = humidityEntityId ? stateByEntity.get(humidityEntityId) : undefined;
    const batState = batteryEntityId ? stateByEntity.get(batteryEntityId) : undefined;

    temperatureSensors[key] = {
      title,
      temperature: parseFloat(tempState?.state ?? 'NaN'),
      humidity: humState ? parseFloat(humState.state) : 0,
      dewPoint: 0,
      min: 0,
      max: 0
    };
    if (batState !== undefined && batState.state !== 'unavailable' && batState.state !== 'unknown') {
      const b = parseInt(batState.state, 10);
      if (!Number.isNaN(b)) {
        temperatureSensors[key].battery = b;
      }
    }
  }

  Object.values(temperatureSensors).forEach(sensor => {
    sensor.dewPoint = calculateDewPoint(sensor.temperature, sensor.humidity);
  });

  const temperatureStats = await Promise.all(
    deviceDescriptors
      .filter(d => temperatureSensors[d.device_id])
      .map(async device => {
        const temperatureEntityId = pickLabeledSensorEntityIds(device, stateByEntity).temperature;
        if (!temperatureEntityId) {
          return { deviceId: device.device_id, minMax: { min: 0, max: 0 } };
        }
        const minMax = await fetchSensorStatistics(temperatureEntityId);
        return { deviceId: device.device_id, minMax };
      })
  );

  temperatureStats.forEach(({ deviceId, minMax }) => {
    if (temperatureSensors[deviceId]) {
      temperatureSensors[deviceId].min = minMax.min;
      temperatureSensors[deviceId].max = minMax.max;
    }
  });

  return {
    weatherState: weatherSensor?.state || 'unknown',
    sunriseTime: sunriseSensor?.state,
    sunsetTime: sunsetSensor?.state,
    temperatureSensors
  };
}

// Rendering functions
function getWeatherIcon(weatherState: string): string {
  const weatherIcons: { [key: string]: string } = {
    'clear-night': 'fa-moon',
    'cloudy': 'fa-cloud',
    'fog': 'fa-smog',
    'hail': 'fa-cloud-meatball',
    'lightning': 'fa-bolt',
    'lightning-rainy': 'fa-cloud-bolt',
    'partlycloudy': 'fa-cloud-sun',
    'pouring': 'fa-cloud-showers-heavy',
    'rainy': 'fa-cloud-rain',
    'snowy': 'fa-snowflake',
    'snowy-rainy': 'fa-cloud-rain', // fa-cloud-snow would actually be a better fit, but is only available in pro version of fontawesome
    'sunny': 'fa-sun',
    'windy': 'fa-wind',
    'windy-variant': 'fa-wind',
    'exceptional': 'fa-triangle-exclamation',
    'unknown': 'fa-question'
  };

  return weatherIcons[weatherState] || weatherIcons['unknown'];
}

function renderRoomSection(sensors: TemperatureSensor): string {
  return `
    <div class="room">
      <div class="room-title">${sensors.title}</div>
      <div class="sensor-row">
        <span class="sensor-value"><i class="fas fa-temperature-three-quarters sensor-icon"></i>${sensors.temperature.toFixed(1)}°C</span>
        <span class="sensor-value"><i class="fas fa-droplet sensor-icon"></i>${sensors.humidity.toFixed(1)}%</span>
      </div>
      <div class="sensor-row">
        <span class="sensor-value-small"><i class="fas fa-water"></i>${sensors.dewPoint.toFixed(1)}°C</span>
        <span class="sensor-value-small">
          <i class="fas fa-arrow-down"></i>${sensors.min.toFixed(1)}°C
          <i class="fas fa-arrow-up"></i>${sensors.max.toFixed(1)}°C
        </span>
        ${sensors.battery !== undefined ? `
          <span class="sensor-value-small">
            ${(() => {
              if (sensors.battery! >= 87) return '<i class="fas fa-battery-full"></i>';
              if (sensors.battery! >= 63) return '<i class="fas fa-battery-three-quarters"></i>';
              if (sensors.battery! >= 37) return '<i class="fas fa-battery-half"></i>';
              if (sensors.battery! >= 12) return '<i class="fas fa-battery-quarter"></i>';
              return '<i class="fas fa-battery-empty"></i>';
            })()}
          </span>
        ` : ''}
      </div>
    </div>
  `;
}

function generateHtml(data: DashboardData): string {
  const weatherIcon = getWeatherIcon(data.weatherState);
  
  return `
    <html>
      <head>
        <link rel="stylesheet" href="/assets/fontawesome/css/all.min.css">
        <style>
          :root {
            --primary-color: black;
            --font-size-small: 20px;
            --font-size-medium: 26px;
            --font-size-large: 32px;
            --font-size-xxlarge: 40px;
            --font-size-huge: 60px;
            --spacing-small: 5px;
            --spacing-medium: 8px;
            --spacing-xlarge: 15px;
          }

          body { 
            width: 480px;
            height: 800px;
            margin: 0;
            font-family: sans-serif;
            background-color: white;
            padding: var(--spacing-xlarge);
            box-sizing: border-box;
          }

          .weather-icon {
            font-size: 100px;
          }

          .date {
            font-size: var(--font-size-xxlarge);
            font-weight: bold;
            color: var(--primary-color);
            margin-bottom: var(--spacing-xlarge);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--spacing-xlarge);
          }

          .sun-times {
            display: flex;
            gap: var(--spacing-xlarge);
            font-size: var(--font-size-large);
            justify-content: space-evenly;
          }

          .sun-info {
            display: flex;
            align-items: center;
            gap: var(--spacing-small);
          }

          .room {
            background-color: white;
            padding: var(--spacing-medium) 0;
            border-bottom: 2px solid var(--primary-color);
          }

          .room:last-child {
            border-bottom: none;
          }

          .room-title {
            font-size: var(--font-size-xxlarge);
            font-weight: bold;
            color: var(--primary-color);
            text-align: center;
          }

          .sensor-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .sensor-value {
            font-weight: bold;
            color: var(--primary-color);
            font-size: var(--font-size-huge);
            display: flex;
            align-items: center;
            gap: var(--spacing-medium);
          }

          .sensor-icon {
            font-size: 50%;
          }

          .sensor-value-small {
            font-weight: bold;
            color: var(--primary-color);
            font-size: var(--font-size-medium);
            display: flex;
            align-items: center;
            gap: var(--spacing-small);
          }
        </style>
      </head>
      <body>
        <div class="date">
          <i class="fas ${weatherIcon} weather-icon"></i>
          <div>
          ${getGermanDate()}
          ${data.sunriseTime && data.sunsetTime ? `
            <div class="sun-times">
              <div class="sun-info">
                <i class="fas fa-sun"></i>
                ${formatLocalTime(data.sunriseTime)}
              </div>
              <div class="sun-info">
                <i class="fas fa-moon"></i>
                ${formatLocalTime(data.sunsetTime)}
              </div>
            </div>
          ` : ''}
          </div>
        </div>
        ${Object.values(data.temperatureSensors).map(sensors => renderRoomSection(sensors)).join('')}
      </body>
    </html>
  `;
}

export async function renderDashboardHtml(): Promise<string> {
  const displayPlan = await fetchDisplayDeviceDescriptor();
  const sensorData = await fetchSensorData();
  const data = await processSensorData(sensorData, displayPlan);
  return generateHtml(data);
}
