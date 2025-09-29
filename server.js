const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
const sharp = require('sharp');
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

// Proxy imagery endpoint to handle CORS
app.get('/api/proxy-image', async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL parameter required' });
        }

        // Add API key to the URL
        const imageUrl = `${url}&key=${GOOGLE_API_KEY}`;
        const response = await fetch(imageUrl);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch image' });
        }

        // Set appropriate headers
        res.set({
            'Content-Type': response.headers.get('content-type') || 'image/tiff',
            'Cache-Control': 'public, max-age=3600'
        });

        // Pipe the response
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('Image proxy error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Process TIFF data using Sharp endpoint
app.get('/api/process-geotiff', async (req, res) => {
    try {
        const { url, layer } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL parameter required' });
        }

        console.log('Processing TIFF data for URL:', url, 'Layer:', layer);

        // Add API key to the URL
        const imageUrl = `${url}&key=${GOOGLE_API_KEY}`;
        const response = await fetch(imageUrl);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch TIFF' });
        }

        // Get the TIFF buffer
        const buffer = await response.arrayBuffer();
        const inputBuffer = Buffer.from(buffer);
        console.log('TIFF size:', buffer.byteLength, 'bytes');

        // Use Sharp to extract metadata and pixel data
        const image = sharp(inputBuffer);
        const metadata = await image.metadata();

        console.log('Image dimensions:', metadata.width, 'x', metadata.height);
        console.log('Channels:', metadata.channels);

        // For RGB layer, extract RGB channels
        if (layer === 'rgb') {
            const { data, info } = await image
                .ensureAlpha(false)
                .raw()
                .toBuffer({ resolveWithObject: true });

            const width = info.width;
            const height = info.height;
            const channels = info.channels;

            if (channels >= 3) {
                const red = [];
                const green = [];
                const blue = [];

                for (let i = 0; i < data.length; i += channels) {
                    red.push(data[i]);
                    green.push(data[i + 1]);
                    blue.push(data[i + 2]);
                }

                return res.json({
                    success: true,
                    type: 'rgb',
                    width: width,
                    height: height,
                    data: { red, green, blue }
                });
            }
        }

        // For single-band data (flux, mask), extract first channel
        const { data, info } = await image
            .raw()
            .toBuffer({ resolveWithObject: true });

        const width = info.width;
        const height = info.height;
        const values = [];

        // Extract values based on data type
        if (metadata.format === 'tiff') {
            // For single channel, take every pixel
            const step = info.channels;
            for (let i = 0; i < data.length; i += step) {
                values.push(data[i]);
            }
        } else {
            // For other formats, use all data
            for (let i = 0; i < data.length; i++) {
                values.push(data[i]);
            }
        }

        // Calculate statistics for proper visualization
        const validValues = values.filter(v => v !== 255 && v !== 0 && !isNaN(v)); // Filter common invalid values
        const min = validValues.length > 0 ? Math.min(...validValues) : 0;
        const max = validValues.length > 0 ? Math.max(...validValues) : 255;
        const mean = validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : 0;

        console.log(`Layer stats - Min: ${min}, Max: ${max}, Mean: ${mean.toFixed(2)}`);

        res.json({
            success: true,
            type: 'single-band',
            layer: layer,
            width: width,
            height: height,
            stats: { min, max, mean },
            data: values
        });

    } catch (error) {
        console.error('TIFF processing error:', error);
        res.status(500).json({ error: 'Failed to process TIFF: ' + error.message });
    }
});

// Convert GeoTIFF to PNG endpoint (fallback for simple display)
app.get('/api/convert-image', async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL parameter required' });
        }

        console.log('Converting GeoTIFF to PNG for URL:', url);

        // Add API key to the URL
        const imageUrl = `${url}&key=${GOOGLE_API_KEY}`;
        const response = await fetch(imageUrl);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch image' });
        }

        // Get the image buffer
        const buffer = await response.arrayBuffer();
        const inputBuffer = Buffer.from(buffer);

        console.log('Original image size:', inputBuffer.length, 'bytes');

        // Convert GeoTIFF to PNG using Sharp
        const pngBuffer = await sharp(inputBuffer)
            .png()
            .toBuffer();

        console.log('Converted PNG size:', pngBuffer.length, 'bytes');

        // Set appropriate headers for PNG
        res.set({
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600'
        });

        res.send(pngBuffer);

    } catch (error) {
        console.error('Image conversion error:', error);
        res.status(500).json({ error: 'Failed to convert image: ' + error.message });
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