const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const axios = require('axios');

// ============================================
// GET CURRENT WEATHER (Multi-Tenant Isolated)
// ============================================
router.get('/current/:city', async (req, res) => {
  try {
    const { city } = req.params;
    const hotelId = req.hotelId;
    const db = getDB();

    // Check if we have recent weather data (less than 1 hour old)
    const cached = await db.collection('weather').findOne({
      city,
      hotelId,
      updatedAt: { $gte: new Date(Date.now() - 3600000) } // 1 hour
    });

    if (cached) {
      return res.json({ success: true, data: cached, source: 'cache' });
    }

    // Fetch from OpenWeatherMap API
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'Weather API key not configured' });
    }

    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`
    );

    const weatherData = {
      city: response.data.name,
      country: response.data.sys.country,
      temperature: response.data.main.temp,
      feelsLike: response.data.main.feels_like,
      humidity: response.data.main.humidity,
      description: response.data.weather[0].description,
      icon: response.data.weather[0].icon,
      windSpeed: response.data.wind.speed,
      windDirection: response.data.wind.deg,
      pressure: response.data.main.pressure,
      visibility: response.data.visibility,
      sunrise: new Date(response.data.sys.sunrise * 1000),
      sunset: new Date(response.data.sys.sunset * 1000),
      hotelId,
      updatedAt: new Date()
    };

    // Save or update weather data
    const existing = await db.collection('weather').findOne({ city, hotelId });
    let weather;
    if (existing) {
      weather = await db.collection('weather').findOneAndUpdate(
        { _id: existing._id },
        { $set: weatherData },
        { returnDocument: 'after' }
      );
    } else {
      weatherData.createdAt = new Date();
      const result = await db.collection('weather').insertOne(weatherData);
      weather = { ...weatherData, _id: result.insertedId };
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${hotelId}`).emit('weather_upd', weather);

    res.json({ success: true, data: weather, source: 'api' });
  } catch (err) {
    console.error('Weather API Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch weather data' });
  }
});

// ============================================
// GET WEATHER FORECAST (5 days)
// ============================================
router.get('/forecast/:city', async (req, res) => {
  try {
    const { city } = req.params;
    const apiKey = process.env.WEATHER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'Weather API key not configured' });
    }

    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric&cnt=5`
    );

    const forecast = response.data.list.map(item => ({
      date: new Date(item.dt * 1000),
      temperature: item.main.temp,
      feelsLike: item.main.feels_like,
      humidity: item.main.humidity,
      description: item.weather[0].description,
      icon: item.weather[0].icon,
      windSpeed: item.wind.speed,
      pressure: item.main.pressure
    }));

    res.json({ success: true, data: forecast });
  } catch (err) {
    console.error('Forecast API Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch forecast data' });
  }
});

// ============================================
// GET WEATHER BY COORDINATES
// ============================================
router.get('/current/coordinates/:lat/:lon', async (req, res) => {
  try {
    const { lat, lon } = req.params;
    const apiKey = process.env.WEATHER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'Weather API key not configured' });
    }

    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
    );

    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('Weather API Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch weather data' });
  }
});

module.exports = router;
