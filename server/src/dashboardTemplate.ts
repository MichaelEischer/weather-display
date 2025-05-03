export function renderDashboardHtml(sensorData: any): string {
  // Filter for our specific sensors
  const relevantSensors = sensorData.filter((s: any) => 
    s.entity_id === 'sensor.temperatur_wohnzimmer_temperature' ||
    s.entity_id === 'sensor.temperatur_wohnzimmer_humidity' ||
    s.entity_id === 'sensor.temperatur_bad_temperature' ||
    s.entity_id === 'sensor.temperatur_bad_humidity' ||
    s.entity_id === 'sensor.temperatur_balkon_temperature' ||
    s.entity_id === 'sensor.temperatur_balkon_humidity'
  );

  // Group sensors by location
  const groupedSensors = relevantSensors.reduce((acc: any, sensor: any) => {
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

  return `
    <html>
      <head>
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
          .sensor-label {
            color: black;
            font-size: 18px;
            font-weight: 600;
          }
          .sensor-value {
            font-weight: bold;
            color: black;
            font-size: 64px;
          }
          .dew-point {
            font-weight: bold;
            color: black;
            font-size: 20px;
          }
          h1 {
            text-align: center;
            color: black;
            margin-bottom: 30px;
            font-size: 32px;
          }
        </style>
      </head>
      <body>
        ${Object.entries(groupedSensors).map(([location, sensors]: [string, any]) => {
          const dewPoint = calculateDewPoint(parseFloat(sensors.temperature), parseFloat(sensors.humidity));
          return `
          <div class="room">
            <div class="room-title">${location.charAt(0).toUpperCase() + location.slice(1)}</div>
            <div class="sensor-row">
              <span class="sensor-value">${sensors.temperature}°C</span>
              <span class="sensor-value">${sensors.humidity}%</span>
            </div>
            <div class="sensor-row">
              <span class="sensor-label">Dew Point:</span>
              <span class="dew-point">${dewPoint.toFixed(1)}°C</span>
            </div>
          </div>
        `}).join('')}
      </body>
    </html>
  `;
}
