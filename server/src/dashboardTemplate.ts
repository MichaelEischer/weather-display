import axios from 'axios';

interface SensorData {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}

export interface TemperatureSensor {
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

export interface DashboardData {
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
{%- set sep = namespace(first=true) %}
{%- for area_id in areas() %}
  {%- for dev in label_devices('Display') %}
    {%- if device_attr(dev, 'area_id') == area_id %}
      {%- if not sep.first %},{% endif %}
      {%- set sep.first = false %}
  {
    "device_id": {{ dev | to_json }},
    "name": {{ (area_name(dev) or device_attr(dev, 'name_by_user') or device_attr(dev, 'name') or dev) | to_json }},
    "entities": {{ device_entities(dev) | select('match', '^sensor\\.') | list | to_json }}
  }
    {%- endif %}
  {%- endfor %}
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
    return Array.isArray(data) ? data : [];
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

export async function loadDashboardData(): Promise<DashboardData> {
  const displayPlan = await fetchDisplayDeviceDescriptor();
  const sensorData = await fetchSensorData();
  return processSensorData(sensorData, displayPlan);
}
