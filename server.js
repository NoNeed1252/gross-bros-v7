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

// Chat API Route (Mounted directly for compatibility)
const chatHandler = require('./chat_updated');
app.post('/api/chat', chatHandler);
app.post('/api/chat.js', chatHandler); // Handle legacy extension calls

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

const fs = require('fs');
app.use((req, res, next) => {
  fs.appendFileSync('access.log', `${new Date().toISOString()} ${req.method} ${req.url}\n`);
  next();
});

app.listen(PORT, HOST, () => {
    console.log(`Gross-Bros-V7 Terminal Server running at http://${HOST}:${PORT}`);
});
