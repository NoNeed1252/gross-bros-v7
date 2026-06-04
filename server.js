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
const chatHandler = require('./api/chat.js');

// Helper to mock Vercel's req/res objects for the existing handlers
const wrapHandler = (handler) => async (req, res) => {
    try {
        // Vercel handlers typically look like: export default async function(req, res)
        // If it's a module.exports style, or default export:
        const actualHandler = handler.default || handler;
        await actualHandler(req, res);
    } catch (error) {
        console.error('API Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
};

app.post('/api/xaman', wrapHandler(xamanHandler));
app.post('/api/chat', wrapHandler(chatHandler));

// Catch-all to serve index.html for frontend routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Explicitly bind to 0.0.0.0
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${port}`);
});
