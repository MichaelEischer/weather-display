export function renderDashboardHtml(sensorData: any): string {
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

  return `
    <html>
      <head>
        <link rel="stylesheet" href="/assets/fontawesome/css/all.min.css">
        <style>
          body { 
            width: 480px; 
            height: 800px; 
            margin: 0; 
            font-family: sans-serif;
            background-color: white;
            padding: 20px;
            box-sizing: border-box;
            font-size: 16px;
          }
          .date {
            font-size: 28px;
            font-weight: bold;
            color: black;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
          }
          .sun-times {
            display: flex;
            gap: 20px;
            font-size: 24px;
            justify-content: space-evenly;
          }
          .sun-info {
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .room {
            background-color: white;
            padding: 15px;
            border-bottom: 2px solid black;
          }
          .room:last-child {
            border-bottom: none;
          }
          .room-title {
            font-size: 32px;
            font-weight: bold;
            color: black;
            text-align: center;
          }
          .sensor-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            align-items: center;
          }
          .sensor-value {
            font-weight: bold;
            color: black;
            font-size: 48px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .dew-point {
            font-weight: bold;
            color: black;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .battery-level {
            font-weight: bold;
            color: black;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          h1 {
            text-align: center;
            color: black;
            margin-bottom: 30px;
            font-size: 32px;
          }
          .sensor-icon {
            font-size: 70%;
          }
          .weather-icon {
            font-size: 80px;
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
              <span class="dew-point"><i class="fas fa-water"></i>${dewPoint.toFixed(1)}°C</span>
              ${sensors.battery ? `
                <span class="battery-level">
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