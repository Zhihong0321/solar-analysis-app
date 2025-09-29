# Solar Analysis App

A web application that analyzes solar potential for any address using Google's Solar API with proper URL signing for secure requests.

## Features

- 🏠 Address geocoding with Google Maps API
- 🌞 Solar potential analysis with Google Solar API
- 📊 Detailed solar metrics (roof area, panel count, energy generation)
- 💰 Financial analysis (cost estimates, savings, payback period)
- 🌱 Environmental impact calculations
- 🖼️ High-resolution roof imagery
- 📱 Responsive design for mobile and desktop

## Deployment on Railway

### Prerequisites

- Railway CLI installed and logged in
- Railway subscription (for hosting)
- Google Cloud Project with Solar API enabled
- Google API key with URL signing secret

### Environment Variables

Set these environment variables in Railway:

```
GOOGLE_API_KEY=your_google_api_key_here
URL_SIGNING_SECRET=your_url_signing_secret_here
```

### Deployment Steps

1. Initialize Railway project:
   ```bash
   railway login
   railway init
   ```

2. Set environment variables:
   ```bash
   railway variables set GOOGLE_API_KEY=your_api_key
   railway variables set URL_SIGNING_SECRET=your_signing_secret
   ```

3. Deploy:
   ```bash
   railway up
   ```

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment file and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000

## API Endpoints

- `GET /api/health` - Server health check
- `POST /api/geocode` - Geocode addresses
- `POST /api/solar/building-insights` - Get solar building analysis
- `POST /api/solar/imagery` - Get roof imagery data

## Google Solar API Quality Levels

- **HIGH**: 0.1m/pixel aerial imagery (major cities)
- **MEDIUM**: 0.25m/pixel aerial imagery (enhanced coverage)
- **BASE**: 0.25m/pixel satellite imagery (experimental expanded coverage)

The app automatically tries HIGH → MEDIUM → BASE quality levels for maximum coverage.