// ============================================
// WEATHER MODEL (Native Driver Schema)
// ============================================
const Weather = {
  collection: 'weather',

  schema: {
    city: { type: 'string', required: true },
    country: { type: 'string' },
    temperature: { type: 'number' },
    feelsLike: { type: 'number' },
    humidity: { type: 'number' },
    description: { type: 'string' },
    icon: { type: 'string' },
    windSpeed: { type: 'number' },
    windDirection: { type: 'number' },
    pressure: { type: 'number' },
    visibility: { type: 'number' },
    sunrise: { type: 'date' },
    sunset: { type: 'date' },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.city) errors.push('City name is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { city: 1 } },
    { key: { updatedAt: -1 } }
  ]
};

module.exports = Weather;
