const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const app = express();
const port = 80;

// Security token for deployment
const DEPLOY_TOKEN = 'vAUL03juyPr1hu';

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// Auto-deployment endpoint
app.post('/api/deploy', (req, res) => {
    const token = req.headers['x-deploy-token'];
    if (token !== DEPLOY_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('Starting deployment sync...');
    exec('git pull origin main && pm2 reload all', (error, stdout, stderr) => {
        if (error) {
            console.error(`Deploy error: ${error}`);
            return res.status(500).json({ error: 'Deployment failed', details: stderr });
        }
        console.log(`Deploy success: ${stdout}`);
        res.json({ message: 'Deployment successful', output: stdout });
    });
});

// API Routes - Dynamic loading of Vercel handlers
const xamanHandler = require('./api/xaman.js');

const wrapHandler = (handler) => async (req, res) => {
    try {
        const actualHandler = handler.default || handler;
        await actualHandler(req, res);
    } catch (error) {
        console.error('API Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
    }
};

app.all('/api/xaman', wrapHandler(xamanHandler));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${port}`);
});
