const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Environment variables
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const URL_SIGNING_SECRET = process.env.URL_SIGNING_SECRET;

// URL signing function for Google APIs
function signUrl(url, secret) {
    const urlObj = new URL(url);
    const urlToSign = urlObj.pathname + urlObj.search;

    // Create HMAC signature
    const signature = crypto
        .createHmac('sha1', Buffer.from(secret, 'base64'))
        .update(urlToSign)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `${url}&signature=${signature}`;
}

// Geocoding endpoint
app.post('/api/geocode', async (req, res) => {
    try {
        const { address } = req.body;

        if (!address) {
            return res.status(400).json({ error: 'Address is required' });
        }

        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK' && data.results.length > 0) {
            const result = data.results[0];
            res.json({
                success: true,
                lat: result.geometry.location.lat,
                lng: result.geometry.location.lng,
                formattedAddress: result.formatted_address
            });
        } else {
            res.status(400).json({
                success: false,
                error: `Geocoding failed: ${data.status}`
            });
        }
    } catch (error) {
        console.error('Geocoding error:', error);
        res.status(500).json({
            success: false,
            error: `Network error: ${error.message}`
        });
    }
});

// Solar building insights endpoint
app.post('/api/solar/building-insights', async (req, res) => {
    try {
        const { lat, lng } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude and longitude are required' });
        }

        // Try different quality levels
        const qualityLevels = ['HIGH', 'MEDIUM', 'BASE'];

        for (const quality of qualityLevels) {
            try {
                let response, data;

                if (quality === 'BASE') {
                    // GET request for BASE quality with expanded coverage
                    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=BASE&experiments=EXPANDED_COVERAGE&key=${GOOGLE_API_KEY}`;

                    response = await fetch(url);
                } else {
                    // GET request for HIGH/MEDIUM quality
                    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${quality}&key=${GOOGLE_API_KEY}`;

                    response = await fetch(url);
                }

                // Log response details for debugging
                console.log(`Building Insights API Response Status: ${response.status} for quality: ${quality}`);
                console.log(`API Response Headers:`, response.headers.get('content-type'));

                const responseText = await response.text();
                console.log(`API Response Body (first 200 chars):`, responseText.substring(0, 200));

                try {
                    data = JSON.parse(responseText);
                } catch (parseError) {
                    console.error(`JSON Parse Error for quality ${quality}:`, parseError.message);
                    console.error(`Response text:`, responseText);
                    throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}`);
                }

                if (response.ok) {
                    const qualityInfo = quality === 'HIGH' ? '0.1m/pixel aerial' :
                                      quality === 'MEDIUM' ? '0.25m/pixel aerial' :
                                      '0.25m/pixel satellite (experimental)';

                    return res.json({
                        success: true,
                        quality: quality,
                        qualityInfo: qualityInfo,
                        data: data
                    });
                } else if (data.error?.message?.includes('not found') && quality !== 'BASE') {
                    console.log(`${quality} quality not available, trying next level...`);
                    continue;
                } else {
                    throw new Error(`Solar API error: ${data.error?.message || response.status}`);
                }
            } catch (error) {
                if (quality === 'BASE') {
                    throw error;
                }
                continue;
            }
        }

        throw new Error('No solar data available for this location');

    } catch (error) {
        console.error('Solar API error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Solar imagery endpoint
app.post('/api/solar/imagery', async (req, res) => {
    try {
        const { lat, lng } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude and longitude are required' });
        }

        // Try different quality levels
        const qualityLevels = ['HIGH', 'MEDIUM', 'BASE'];

        for (const quality of qualityLevels) {
            try {
                let response, data;

                if (quality === 'BASE') {
                    // GET request for BASE quality with expanded coverage
                    const url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=100&requiredQuality=BASE&experiments=EXPANDED_COVERAGE&key=${GOOGLE_API_KEY}`;

                    response = await fetch(url);
                } else {
                    // GET request for HIGH/MEDIUM quality
                    const url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=100&requiredQuality=${quality}&key=${GOOGLE_API_KEY}`;

                    response = await fetch(url);
                }

                data = await response.json();

                if (response.ok) {
                    return res.json({
                        success: true,
                        quality: quality,
                        data: data
                    });
                } else if (data.error?.message?.includes('not found') && quality !== 'BASE') {
                    continue;
                } else {
                    console.warn('Imagery API error:', data.error?.message);
                    if (quality === 'BASE') {
                        return res.json({ success: false, data: null });
                    }
                    continue;
                }
            } catch (error) {
                console.warn('Imagery error:', error.message);
                if (quality === 'BASE') {
                    return res.json({ success: false, data: null });
                }
                continue;
            }
        }

        res.json({ success: false, data: null });

    } catch (error) {
        console.error('Imagery API error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        env: {
            hasApiKey: !!GOOGLE_API_KEY,
            hasSigningSecret: !!URL_SIGNING_SECRET
        }
    });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🌞 Solar Analysis Server running on port ${PORT}`);
    console.log(`Environment check:`);
    console.log(`- Google API Key: ${GOOGLE_API_KEY ? '✓ Present' : '✗ Missing'}`);
    console.log(`- URL Signing Secret: ${URL_SIGNING_SECRET ? '✓ Present' : '✗ Missing'}`);
});