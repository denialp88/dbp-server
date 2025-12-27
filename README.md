# DBP Server - Push Notification Backend with Browser

This server uses **Puppeteer (headless Chrome)** to check BookMyShow ticket availability every 30 seconds. It runs a real browser to bypass API restrictions and sends push notifications to registered devices.

## Deploy to Render.com (Free with Docker)

### Step 1: Push to GitHub

```bash
cd DBP-Server
git init
git add .
git commit -m "DBP Server with Puppeteer"
# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/dbp-server.git
git push -u origin main
```

### Step 2: Deploy on Render

1. Go to [render.com](https://render.com) and sign up/login
2. Click **New** → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Environment**: Docker
   - **Plan**: Free
5. Click **Create Web Service**
6. Wait for build (~5-10 minutes for Docker)

### Step 3: Get your URL

Copy your Render URL (e.g., `https://dbp-server-xxxx.onrender.com`)

### Step 4: Update Mobile App

Edit `BMSChecker/App.js`:
```javascript
const SERVER_URL = "https://your-render-url.onrender.com";
```

## API Endpoints

- `POST /register` - Register device push token
- `POST /unregister` - Unregister device
- `POST /test-notification` - Send 10 test notifications
- `GET /status` - Check server status & browser status
- `GET /check` - Manually trigger ticket check
- `GET /` - Health check

## How It Works

1. Server starts → Launches headless Chrome browser
2. Browser navigates to BookMyShow → Gets session cookies
3. Every 30 seconds → Browser makes API calls with cookies
4. When tickets found → Server sends 10 push notifications via Expo
5. **Notifications work even when app is closed!**

## Local Testing

```bash
cd DBP-Server
npm install
npm start
```

Server runs on http://localhost:3000

**Note**: Puppeteer will download Chromium on first run (~150MB)
