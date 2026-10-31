# UANScan Online v2.0

UANScan Online is a lightweight web application designed to scan, parse, and display details from various Indian identification and bank documents (Aadhaar, PAN, Driving Licence, Passbook).

## Features
- Case-sensitive relative image & asset loading for seamless GitHub Pages deployment.
- Asynchronous File Reader API integration for reliable image uploads.
- Offline support via Service Worker (`sw.js`).
- Structured document detail parsing and display.

## Files Included
- `index.html`: Web interface for uploading and viewing document details.
- `app.js`: Application logic and UI interactions.
- `core.js`: Core canvas image renderer and output formatter.
- `sw.js`: Service worker for offline caching (Cache v2).
- `README.md`: Project documentation.

## Deployment to GitHub Pages
1. Extract the zip file.
2. Push all files under `UANScan_online/` to your GitHub repository.
3. Enable GitHub Pages in Repository Settings -> Pages -> Source: `main` branch.
