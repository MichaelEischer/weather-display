import axios from 'axios';

interface SensorData {
  entity_id: string;
  state: string;
}

interface TemperatureSensor {
  temperature: number;
  humidity: number;
  battery?: number;
  min: number;
  max: number;
  dewPoint: number;
}

type TemperatureSensorsMap = { [location: string]: TemperatureSensor };

interface DashboardData {
  weatherState: string;
  sunriseTime?: string;
  sunsetTime?: string;
  temperatureSensors: TemperatureSensorsMap;
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

async function processSensorData(sensorData: SensorData[]): Promise<DashboardData> {
  const relevantSensorIds = new Set([
    'sensor.temperatur_wohnzimmer_temperature',
    'sensor.temperatur_wohnzimmer_humidity',
    'sensor.temperatur_wohnzimmer_battery',
    'sensor.temperatur_bad_temperature',
    'sensor.temperatur_bad_humidity',
    'sensor.temperatur_bad_battery',
    'sensor.temperatur_balkon_temperature',
    'sensor.temperatur_balkon_humidity',
    'sensor.temperatur_balkon_battery',
    'weather.forecast_home',
    'sensor.sun_next_rising',
    'sensor.sun_next_dusk'
  ]);

  const relevantSensors = sensorData.filter(s => relevantSensorIds.has(s.entity_id));

  const weatherSensor = relevantSensors.find(s => s.entity_id === 'weather.forecast_home');
  const sunriseSensor = relevantSensors.find(s => s.entity_id === 'sensor.sun_next_rising');
  const sunsetSensor = relevantSensors.find(s => s.entity_id === 'sensor.sun_next_dusk');

  const temperatureSensors: TemperatureSensorsMap = relevantSensors
    .filter(s => s.entity_id.startsWith('sensor.temperatur_'))
    .reduce((acc, sensor) => {
      const location = sensor.entity_id.split('_')[1];
      const type = sensor.entity_id.split('_')[2];
      
      if (!acc[location]) {
        acc[location] = {
          temperature: 0,
          humidity: 0,
          min: 0,
          max: 0,
          dewPoint: 0
        };
      }

      switch (type) {
        case 'temperature':
          acc[location].temperature = parseFloat(sensor.state);
          break;
        case 'humidity':
          acc[location].humidity = parseFloat(sensor.state);
          break;
        case 'battery':
          acc[location].battery = parseInt(sensor.state);
          break;
      }

      return acc;
    }, {} as TemperatureSensorsMap);

  // Calculate dew points for all sensors
  Object.values(temperatureSensors).forEach(sensor => {
    sensor.dewPoint = calculateDewPoint(sensor.temperature, sensor.humidity);
  });

  // Fetch statistics for all temperature sensors
  const temperatureStats = await Promise.all(
    Object.keys(temperatureSensors).map(async (location) => {
      const sensorId = `sensor.temperatur_${location}_temperature`;
      const minMax = await fetchSensorStatistics(sensorId);
      return { location, minMax };
    })
  );

  // Inject statistics into temperatureSensors
  temperatureStats.forEach(({ location, minMax }) => {
    temperatureSensors[location].min = minMax.min;
    temperatureSensors[location].max = minMax.max;
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
    'snowy-rainy': 'fa-cloud-snow',
    'sunny': 'fa-sun',
    'windy': 'fa-wind',
    'windy-variant': 'fa-wind',
    'exceptional': 'fa-exclamation-triangle',
    'unknown': 'fa-question'
  };

  return weatherIcons[weatherState] || weatherIcons['unknown'];
}

function renderRoomSection(location: string, sensors: TemperatureSensor): string {
  return `
    <div class="room">
      <div class="room-title">${location.charAt(0).toUpperCase() + location.slice(1)}</div>
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
              if (sensors.battery! >= 90) return '<i class="fas fa-battery-full"></i>';
              if (sensors.battery! >= 70) return '<i class="fas fa-battery-three-quarters"></i>';
              if (sensors.battery! >= 40) return '<i class="fas fa-battery-half"></i>';
              if (sensors.battery! >= 20) return '<i class="fas fa-battery-quarter"></i>';
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
        ${Object.entries(data.temperatureSensors).map(([location, sensors]) => 
          renderRoomSection(location, sensors)
        ).join('')}
      </body>
    </html>
  `;
}

export async function renderDashboardHtml(): Promise<string> {
  const sensorData = await fetchSensorData();
  const data = await processSensorData(sensorData);
  return generateHtml(data);
}
