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

/**
 * Dynamic ESM Loader for CommonJS
 * Caches imported modules to avoid redundant loads.
 */
const moduleCache = new Map();

const loadHandler = async (modulePath) => {
    if (moduleCache.has(modulePath)) {
        return moduleCache.get(modulePath);
    }
    // Dynamic import works from CJS to load ESM
    const module = await import(`./api/${modulePath}`);
    const handler = module.default || module;
    moduleCache.set(modulePath, handler);
    return handler;
};

const routeHandler = (fileName) => async (req, res) => {
    try {
        const handler = await loadHandler(fileName);
        await handler(req, res);
    } catch (error) {
        console.error(`API Error [${fileName}]:`, error);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Internal Server Error', 
                message: error.message,
                path: fileName
            });
        }
    }
};

// API Routes - Mounted using dynamic ESM loader
app.all('/api/xaman', routeHandler('xaman.js'));
app.all('/api/chat', routeHandler('chat.js'));
app.all('/api/fusion-gate', routeHandler('fusion-gate.js'));
app.all('/api/callback', routeHandler('callback.js'));

// SPA Routing: Redirect all other requests to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${port}`);
});
