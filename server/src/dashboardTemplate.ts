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
          }
          .room {
            background-color: white;
            border: 1px solid black;
            padding: 15px;
            margin-bottom: 15px;
          }
          .room-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 10px;
            color: black;
          }
          .sensor-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
          }
          .sensor-label {
            color: black;
          }
          .sensor-value {
            font-weight: bold;
            color: black;
          }
          h1 {
            text-align: center;
            color: black;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <h1>Home Assistant Dashboard</h1>
        ${Object.entries(groupedSensors).map(([location, sensors]: [string, any]) => `
          <div class="room">
            <div class="room-title">${location.charAt(0).toUpperCase() + location.slice(1)}</div>
            <div class="sensor-row">
              <span class="sensor-label">Temperature:</span>
              <span class="sensor-value">${sensors.temperature}°C</span>
            </div>
            <div class="sensor-row">
              <span class="sensor-label">Humidity:</span>
              <span class="sensor-value">${sensors.humidity}%</span>
            </div>
          </div>
        `).join('')}
      </body>
    </html>
  `;
}
