const express = require('express');
const path = require('path');
const xamanRouter = require('./api/xaman');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/xaman', xamanRouter);

// Basic health check
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'online', 
        system: 'GROSS-BROS-V7', 
        timestamp: new Date().toISOString() 
    });
});

// Fallback to index.html for SPA behavior
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
    console.log(`Gross-Bros-V7 Terminal Server running at http://${HOST}:${PORT}`);
});
