import axios from 'axios';

export async function renderDashboardHtml(sensorData: any): Promise<string> {
  // Define set of relevant sensor IDs
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

  // Filter for our specific sensors
  const relevantSensors = sensorData.filter((s: any) => relevantSensorIds.has(s.entity_id));

  // Get weather state
  const weatherSensor = relevantSensors.find((s: any) => s.entity_id === 'weather.forecast_home');
  const weatherState = weatherSensor?.state || 'unknown';

  // Get sunrise and sunset times
  const sunriseSensor = relevantSensors.find((s: any) => s.entity_id === 'sensor.sun_next_rising');
  const sunsetSensor = relevantSensors.find((s: any) => s.entity_id === 'sensor.sun_next_dusk');

  // Format time in local timezone
  function formatLocalTime(isoString: string, timezone: string = 'Europe/Berlin'): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString('de-DE', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Map weather states to Font Awesome icons
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

  // Get the appropriate icon class based on weather state
  const weatherIcon = weatherIcons[weatherState] || weatherIcons['unknown'];

  // Group data fields of temperature sensors
  const temperatureSensors = relevantSensors
    .filter((s: any) => s.entity_id.startsWith('sensor.temperatur_'))
    .reduce((acc: any, sensor: any) => {
      const location = sensor.entity_id.split('_')[1];
      const type = sensor.entity_id.split('_')[2];
      if (!acc[location]) {
        acc[location] = {};
      }
      acc[location][type] = sensor.state;
      return acc;
    }, {});

  // Calculate dew point using Magnus formula
  function calculateDewPoint(temperature: number, humidity: number): number {
    const a = 17.625;
    const b = 243.04;
    const alpha = ((a * temperature) / (b + temperature)) + Math.log(humidity / 100);
    return (b * alpha) / (a - alpha);
  }

  // Get German date and weekday
  function getGermanDate(): string {
    const now = new Date();
    const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const weekday = weekdays[now.getDay()];
    const day = now.getDate();
    const month = months[now.getMonth()];
    return `${weekday}<br/>${day}. ${month}`;
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

  // Fetch statistics for all temperature sensors
  const temperatureStats = await Promise.all(
    Object.keys(temperatureSensors).map(async (location) => {
      const sensorId = `sensor.temperatur_${location}_temperature`;
      const url = `${process.env.HA_URL}/api/history/period?filter_entity_id=${sensorId}&minimal_response&no_attributes`;
      const headers = {
        Authorization: `Bearer ${process.env.HA_TOKEN}`,
        'Content-Type': 'application/json'
      };
      const response = await axios.get(url, { headers });
      const minMax = calculateMinMax(response.data[0]);
      return { location, minMax };
    })
  );

  // Inject statistics into temperatureSensors
  temperatureStats.forEach(({ location, minMax }) => {
    temperatureSensors[location].min = minMax.min;
    temperatureSensors[location].max = minMax.max;
  });

  return `
    <html>
      <head>
        <link rel="stylesheet" href="/assets/fontawesome/css/all.min.css">
        <style>
          :root {
            --primary-color: black;
            --font-size-small: 16px;
            --font-size-medium: 20px;
            --font-size-large: 24px;
            --font-size-xxlarge: 32px;
            --font-size-huge: 48px;
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
            font-size: 80px;
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
            padding: var(--spacing-xlarge);
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
            margin-bottom: var(--spacing-medium);
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
            font-size: 70%;
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
          ${sunriseSensor && sunsetSensor ? `
            <div class="sun-times">
              <div class="sun-info">
                <i class="fas fa-sun"></i>
                ${formatLocalTime(sunriseSensor.state)}
              </div>
              <div class="sun-info">
                <i class="fas fa-moon"></i>
                ${formatLocalTime(sunsetSensor.state)}
              </div>
            </div>
          ` : ''}
          </div>
        </div>
        ${Object.entries(temperatureSensors).map(([location, sensors]: [string, any]) => {
          const dewPoint = calculateDewPoint(parseFloat(sensors.temperature), parseFloat(sensors.humidity));
          return `
          <div class="room">
            <div class="room-title">${location.charAt(0).toUpperCase() + location.slice(1)}</div>
            <div class="sensor-row">
              <span class="sensor-value"><i class="fas fa-temperature-three-quarters sensor-icon"></i>${sensors.temperature}°C</span>
              <span class="sensor-value"><i class="fas fa-droplet sensor-icon"></i>${sensors.humidity}%</span>
            </div>
            <div class="sensor-row">
              <span class="sensor-value-small"><i class="fas fa-water"></i>${dewPoint.toFixed(1)}°C</span>
              <span class="sensor-value-small">
                <i class="fas fa-arrow-down"></i>${sensors.min.toFixed(1)}°C
                <i class="fas fa-arrow-up"></i>${sensors.max.toFixed(1)}°C
              </span>
              ${sensors.battery ? `
                <span class="sensor-value-small">
                  ${(() => {
                    const batteryLevel = parseInt(sensors.battery);
                    if (batteryLevel >= 90) return '<i class="fas fa-battery-full"></i>';
                    if (batteryLevel >= 70) return '<i class="fas fa-battery-three-quarters"></i>';
                    if (batteryLevel >= 40) return '<i class="fas fa-battery-half"></i>';
                    if (batteryLevel >= 20) return '<i class="fas fa-battery-quarter"></i>';
                    return '<i class="fas fa-battery-empty"></i>';
                  })()}
                </span>
              ` : ''}
            </div>
          </div>
        `}).join('')}
      </body>
    </html>
  `;
}