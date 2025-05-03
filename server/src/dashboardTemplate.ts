export function renderDashboardHtml(sensorData: any): string {
  // Define set of relevant sensor IDs
  const relevantSensorIds = new Set([
    'sensor.temperatur_wohnzimmer_temperature',
    'sensor.temperatur_wohnzimmer_humidity',
    'sensor.temperatur_bad_temperature',
    'sensor.temperatur_bad_humidity',
    'sensor.temperatur_balkon_temperature',
    'sensor.temperatur_balkon_humidity',
    'weather.forecast_home'
  ]);

  // Filter for our specific sensors
  const relevantSensors = sensorData.filter((s: any) => relevantSensorIds.has(s.entity_id));

  // Get weather state
  const weatherSensor = relevantSensors.find((s: any) => s.entity_id === 'weather.forecast_home');
  const weatherState = weatherSensor?.state || 'unknown';

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

  // Group sensors by location
  const groupedSensors = relevantSensors
    .filter((s: any) => s.entity_id !== 'weather.forecast_home')
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
    return `${weekday}, ${day}. ${month}`;
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
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            color: black;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            justify-content: space-evenly;
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
            font-size: 24px;
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
            font-size: 60px;
          }
        </style>
      </head>
      <body>
        <div class="date">
          <i class="fas ${weatherIcon} weather-icon"></i>
          ${getGermanDate()}
        </div>
        ${Object.entries(groupedSensors).map(([location, sensors]: [string, any]) => {
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
            </div>
          </div>
        `}).join('')}
      </body>
    </html>
  `;
}