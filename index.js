import express from 'express';
import { exec, execSync } from 'child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.WEBHOOK_PORT || 3000;
const SECRET = process.env.WEBHOOK_SECRET ;
const APP_DIR =  process.env.APP_DIR;
const LOG_FILE = '/home/nitpo/app/webhook.log';

// ─── Logging ──────────────────────────────────────────────
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage.trim());
    // fs.appendFileSync(LOG_FILE, logMessage, { flag: 'a' });
}

// ─── Deployment function ──────────────────────────────────
function deploy(callback) {
    log('🚀 Starting deployment...');
    
    const commands = [
        `cd ${APP_DIR}`,
        'git pull origin main',
        'docker compose up -d --build',
        'docker system prune -f'
    ].join(' && ');

    exec(commands, (error, stdout, stderr) => {
        if (error) {
            log(`❌ Deployment failed: ${error.message}`);
            if (callback) callback(false, error.message);
            return;
        }
        log(`✅ Deployment successful!`);
        log(`📝 Output: ${stdout}`);
        if (stderr) log(`⚠️ Warnings: ${stderr}`);
        if (callback) callback(true, stdout);
    });
}

// ─── Check if update exists ──────────────────────────────
function checkForUpdates(callback) {
    log('🔍 Checking for updates...');
    
    try {
        // Get current commit hash
        const localCommit = execSync(`cd ${APP_DIR} && git rev-parse HEAD`, { encoding: 'utf8' }).trim();
        // Fetch latest without merging
        execSync(`cd ${APP_DIR} && git fetch origin main`, { encoding: 'utf8' });
        // Get remote commit hash
        const remoteCommit = execSync(`cd ${APP_DIR} && git rev-parse origin/main`, { encoding: 'utf8' }).trim();
        
        if (localCommit !== remoteCommit) {
            log(`📦 Update available! Local: ${localCommit.slice(0,7)} → Remote: ${remoteCommit.slice(0,7)}`);
            if (callback) callback(true);
        } else {
            log(`📭 No updates available (${localCommit.slice(0,7)})`);
            if (callback) callback(false);
        }
    } catch (error) {
        log(`❌ Failed to check updates: ${error.message}`);
        if (callback) callback(false);
    }
}

// ─── Webhook endpoint ──────────────────────────────────────
app.post('/webhook', (req, res) => {
    // Verify GitHub signature (optional but recommended)
    const signature = req.headers['x-hub-signature-256'];
    if (SECRET && SECRET !== 'your-secret-here') {
        const hmac = crypto.createHmac('sha256', SECRET);
        const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
        if (signature !== digest) {
            log('❌ Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
    }
    
    if (req.headers['x-github-event'] === 'push') {
        log(`📦 Webhook: Push event received from ${req.body.repository?.full_name || 'unknown'}`);
        deploy((success) => {
            if (success) {
                res.status(200).json({ message: 'Deployment started successfully' });
            } else {
                res.status(500).json({ error: 'Deployment failed' });
            }
        });
    } else {
        res.status(200).json({ message: 'OK' });
    }
});



// ─── Start server ──────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    log(`✅ Webhook listener running on port ${PORT}`);
    log(`📁 Working directory: ${APP_DIR}`);   
});

// ─── RUN ON STARTUP: Check for updates ────────────────────
log('🔄 Running startup update check...');
setTimeout(() => {
    checkForUpdates((hasUpdate) => {
        if (hasUpdate) {
            log('🚀 Starting deployment due to pending updates...');
            deploy(() => {
                log('✅ Startup deployment complete');
            });
        } else {
            log('✅ No updates needed on startup');
        }
    });
}, 2000); // Wait 2 seconds for everything to initialize