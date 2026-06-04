const express = require('express');
const path = require('path');
const app = express();
const port = 80;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the root directory (index.html, etc.)
app.use(express.static(path.join(__dirname)));

// API Routes - Dynamic loading of Vercel handlers
const xamanHandler = require('./api/xaman.js');

// Helper to mock Vercel's req/res objects for the existing handlers
const wrapHandler = (handler) => async (req, res) => {
    try {
        const actualHandler = handler.default || handler;
        // The Vercel handler expects (req, res), but it also relies on req.query and req.body
        // In Express, these are already populated, but some handlers check req.method
        await actualHandler(req, res);
    } catch (error) {
        console.error('API Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
    }
};

// Use app.all to capture both GET (check-payload) and POST (create-payload)
app.all('/api/xaman', wrapHandler(xamanHandler));

// Catch-all to serve index.html for frontend routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Explicitly bind to 0.0.0.0
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${port}`);
});
