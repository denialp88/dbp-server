const express = require('express');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

const expo = new Expo();
const PORT = process.env.PORT || 3000;

// Store registered push tokens and events
let pushTokens = [];
let events = [
  { code: "ET00474265", name: "India vs USA" },
  { code: "ET00474011", name: "India vs Namibia" },
  { code: "ET00474320", name: "India vs Pakistan" },
  { code: "ET00474264", name: "Super 8 Match 8" },
  { code: "ET00474002", name: "Super 8 Match 12" },
];
let prevAvailability = {};
let lastCheck = null;
let isChecking = false;
let browser = null;
let page = null;
let browserReady = false;

const API = "https://in.bookmyshow.com";

// Initialize browser
async function initBrowser() {
  try {
    console.log('🌐 Launching browser...');
    
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ]
    };
    
    // Use system Chromium if available (Docker)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    browser = await puppeteer.launch(launchOptions);
    
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    // Go to BMS homepage to get cookies
    console.log('🔗 Navigating to BookMyShow...');
    await page.goto('https://in.bookmyshow.com', { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait a bit for any dynamic content
    await new Promise(r => setTimeout(r, 2000));
    
    browserReady = true;
    console.log('✅ Browser ready!');
  } catch (error) {
    console.error('❌ Browser init failed:', error.message);
    browserReady = false;
  }
}

// Register push token
app.post('/register', (req, res) => {
  const { token, deviceEvents } = req.body;
  
  if (!token || !Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: 'Invalid Expo push token' });
  }
  
  // Remove existing token and add new one
  pushTokens = pushTokens.filter(t => t.token !== token);
  pushTokens.push({ 
    token, 
    events: deviceEvents || events,
    registeredAt: new Date().toISOString()
  });
  
  console.log(`✅ Token registered: ${token.substring(0, 30)}... (${pushTokens.length} total)`);
  res.json({ success: true, message: 'Token registered', totalTokens: pushTokens.length });
});

// Unregister push token
app.post('/unregister', (req, res) => {
  const { token } = req.body;
  pushTokens = pushTokens.filter(t => t.token !== token);
  console.log(`❌ Token unregistered: ${token.substring(0, 30)}...`);
  res.json({ success: true });
});

// Update events for a token
app.post('/update-events', (req, res) => {
  const { token, events: newEvents } = req.body;
  const tokenEntry = pushTokens.find(t => t.token === token);
  if (tokenEntry) {
    tokenEntry.events = newEvents;
    console.log(`📝 Events updated for token: ${token.substring(0, 30)}...`);
  }
  res.json({ success: true });
});

// Get status
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    registeredDevices: pushTokens.length,
    lastCheck: lastCheck,
    isChecking: isChecking,
    events: events,
    prevAvailability: prevAvailability
  });
});

// Manual check endpoint
app.get('/check', async (req, res) => {
  await checkTickets();
  res.json({ success: true, lastCheck, prevAvailability });
});

// Test notification endpoint
app.post('/test-notification', async (req, res) => {
  const { token } = req.body;
  
  if (!token || !Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  
  try {
    const messages = [];
    for (let i = 1; i <= 10; i++) {
      messages.push({
        to: token,
        sound: 'default',
        title: `🚨🔔 ALARM ${i}/10 🔔🚨`,
        body: `TEST NOTIFICATION ${i}/10 - Server is working!`,
        priority: 'high',
        channelId: 'alarm',
      });
    }
    
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    
    console.log(`🧪 Test notifications sent to: ${token.substring(0, 30)}...`);
    res.json({ success: true, message: '10 test notifications sent!' });
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check single event using browser context
async function checkEvent(code) {
  if (!browserReady || !page) {
    console.log(`  ⚠️ Browser not ready, skipping ${code}`);
    return { code, seats: 0, tickets: [], error: 'Browser not ready' };
  }
  
  try {
    // Use page.evaluate to make API call with browser cookies
    const data = await page.evaluate(async (eventCode, apiUrl) => {
      try {
        const response = await fetch(`${apiUrl}/api/le/events/info/${eventCode}`, {
          headers: {
            "Accept": "application/json",
            "x-app-code": "WEB",
            "x-platform-code": "WEB",
            "x-region-code": "BANG"
          },
          credentials: "include"
        });
        return await response.json();
      } catch (e) {
        return { error: e.message };
      }
    }, code, API);
    
    if (data.error) {
      console.error(`  Error checking ${code}:`, data.error);
      return { code, seats: 0, tickets: [], error: data.error };
    }
    
    if (!data.data) return { code, seats: 0, tickets: [] };
    
    let totalSeats = 0;
    const tickets = [];
    
    if (data.data.eventCards) {
      for (const [venue, dates] of Object.entries(data.data.eventCards)) {
        for (const [date, times] of Object.entries(dates)) {
          for (const [time, tix] of Object.entries(times)) {
            for (const [key, t] of Object.entries(tix)) {
              const seats = t.minAvailableSeats || 0;
              totalSeats += seats;
              if (seats > 0) {
                tickets.push({
                  name: t.eventName || key,
                  venue: t.venueName || venue,
                  date: t.eventDate || date,
                  time: t.eventTime || time,
                  seats: seats,
                  price: t.minPrice || 0,
                  url: `https://in.bookmyshow.com/events/${code}`
                });
              }
            }
          }
        }
      }
    }
    
    return { code, seats: totalSeats, tickets };
  } catch (error) {
    console.error(`Error checking ${code}:`, error.message);
    return { code, seats: 0, tickets: [], error: error.message };
  }
}

// Send push notifications to all registered devices
async function sendAlarmNotifications(event, seats) {
  if (pushTokens.length === 0) {
    console.log('⚠️ No registered devices to notify');
    return;
  }
  
  const messages = [];
  const alarmMessages = [
    { title: '🚨🔔 ALARM 1/10 🔔🚨', body: `${event.name}: ${seats} SEATS AVAILABLE NOW!!!` },
    { title: '🔔🚨 ALARM 2/10 🚨🔔', body: `BOOK NOW! ${seats} tickets for ${event.name}!` },
    { title: '⚡💥 ALARM 3/10 💥⚡', body: `HURRY! ${event.name} has ${seats} seats!` },
    { title: '🔥🔥 ALARM 4/10 🔥🔥', body: `HOT! ${seats} seats for ${event.name}!` },
    { title: '🏏🎫 ALARM 5/10 🎫🏏', body: `CRICKET TICKETS! ${event.name}: ${seats}!` },
    { title: '💥⚡ ALARM 6/10 ⚡💥', body: `ACT FAST! ${seats} seats going fast!` },
    { title: '🎯🎯 ALARM 7/10 🎯🎯', body: `TARGET: ${event.name} - ${seats} seats!` },
    { title: '⏰⏰ ALARM 8/10 ⏰⏰', body: `TIME CRITICAL! Book ${event.name} NOW!` },
    { title: '🎫🚀 ALARM 9/10 🚀🎫', body: `LAST CHANCE! ${seats} seats remaining!` },
    { title: '🚀🚀 ALARM 10/10 🚀🚀', body: `FINAL ALERT! ${event.name}: ${seats} seats! GO!!!` },
  ];
  
  for (const tokenEntry of pushTokens) {
    // Check if this device is monitoring this event
    const isMonitoring = tokenEntry.events?.some(e => e.code === event.code) ?? true;
    if (!isMonitoring) continue;
    
    for (const msg of alarmMessages) {
      if (Expo.isExpoPushToken(tokenEntry.token)) {
        messages.push({
          to: tokenEntry.token,
          sound: 'default',
          title: msg.title,
          body: msg.body,
          priority: 'high',
          channelId: 'alarm',
          data: { eventCode: event.code, seats: seats },
        });
      }
    }
  }
  
  if (messages.length === 0) return;
  
  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log(`📤 Sent ${chunk.length} notifications`);
    }
  } catch (error) {
    console.error('Error sending notifications:', error);
  }
}

// Main ticket checking function
async function checkTickets() {
  if (isChecking) return;
  isChecking = true;
  
  console.log(`\n🔍 Checking tickets at ${new Date().toLocaleTimeString()}...`);
  
  for (const event of events) {
    const result = await checkEvent(event.code);
    const prev = prevAvailability[event.code] || 0;
    
    console.log(`  ${event.name}: ${result.seats} seats (was: ${prev})`);
    
    // If new tickets available, send notifications
    if (result.seats > 0 && result.seats !== prev) {
      console.log(`  🎉 NEW TICKETS FOUND! Sending 10 alarm notifications...`);
      await sendAlarmNotifications(event, result.seats);
    }
    
    prevAvailability[event.code] = result.seats;
  }
  
  lastCheck = new Date().toISOString();
  isChecking = false;
}

// Start server
app.listen(PORT, async () => {
  console.log(`\n🚀 DBP Server running on port ${PORT}`);
  console.log(`📱 Waiting for devices to register...`);
  
  // Initialize browser first
  await initBrowser();
  
  if (browserReady) {
    console.log(`🔄 Checking tickets every 30 seconds\n`);
    
    // Initial check
    checkTickets();
    
    // Check every 30 seconds
    setInterval(checkTickets, 30000);
  } else {
    console.log(`❌ Browser failed to start. Ticket checking disabled.`);
  }
});

// Health check for Render
app.get('/', (req, res) => {
  res.json({ 
    name: 'DBP Ticket Checker Server',
    status: 'running',
    browserReady: browserReady,
    devices: pushTokens.length,
    lastCheck: lastCheck
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (browser) await browser.close();
  process.exit(0);
});
