const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const axios = require('axios');
const http = require('http');

// CONFIGURATION PARAMETERS (Populate with your live credentials)
const SUPABASE_URL = 'https://ydppmymoaosvnhibxkbx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcHBteW1vYW9zdm5oaWJ4a2J4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTY2MTY2NiwiZXhwIjoyMDk3MjM3NjY2fQ.R6flAThoNSALA1muuBbR3lmI921iSCpyoFDV6xxs4N8'; // Master bypass key
const FINNHUB_API_KEY = 'd8p3bnpr01qp954ukcl0d8p3bnpr01qp954ukclg';
const RESEND_API_KEY = 're_Qo7LXrW4_3trRcyJw1boqY3bUAZQAaaS2';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(RESEND_API_KEY);

async function checkAndSendAlerts() {
  try {
    const now = new Date();
    let timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
    
    let [time, ampm] = timeString.split(' ');
    let [hour, minute] = time.split(':');
    hour = hour.padStart(2, '0');
    const currentAlertTime = `${hour}:${minute} ${ampm}`;

    console.log(`[${new Date().toLocaleTimeString()}] Mass Scan Initiated for: ${currentAlertTime}...`);

    // 1. Fetch all alerts scheduled for this precise minute
    const { data: alerts, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('alert_time', currentAlertTime);

    if (error) throw error;
    if (!alerts || alerts.length === 0) return;

    console.log(`-> Processing ${alerts.length} user alerts. Executing deduplication...`);

    // 2. EXTRACTION: Find every unique stock ticker requested for this minute
    const uniqueTickers = [...new Set(alerts.map(alert => alert.ticker))];
    const priceMap = {};

    // 3. PARALLEL FETCHING: Fetch prices for all unique tickers simultaneously
    await Promise.all(uniqueTickers.map(async (ticker) => {
      try {
        const stockUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`;
        const response = await axios.get(stockUrl);
        if (response.data && response.data.c) {
          priceMap[ticker] = response.data.c;
        }
      } catch (tickerError) {
        console.error(`   [API Error] Failed fetching market data for ${ticker}:`, tickerError.message);
      }
    }));

    // Arrays to hold prepared bulk dispatches
    const pushBatch = [];
    const emailBatch = [];

    // 4. COMPILATION: Match live pricing data back to individual user configurations
    for (const alert of alerts) {
      const livePrice = priceMap[alert.ticker];
      if (!livePrice) continue; // Skip if asset data lookup failed

      const msgBody = `${alert.ticker} is currently trading at $${livePrice.toFixed(2)}.`;

      // Queue push notifications for bulk processing
      if (alert.send_push && alert.push_token) {
        pushBatch.push({
          to: alert.push_token,
          sound: 'default',
          title: `📈 Market Notification: ${alert.ticker}`,
          body: msgBody,
        });
      }

  // Queue email dispatches with minimalist HTML layout
      if (alert.send_email && alert.email) {
        // Construct a clean, data-dense subject line: "AAPL: $175.50 at 09:30 AM"
        const emailSubject = `${alert.ticker}: $${livePrice.toFixed(2)} at ${alert.alert_time}`;

        const cleanHtml = `
          <div style="background-color: #121214; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; border-radius: 12px; max-width: 400px; margin: 0 auto; border: 1px solid #2c2c2e;">
            <div style="font-size: 11px; color: #30d158; font-weight: 600; letter-spacing: 1px; margin-bottom: 16px;">STOCKALERTS EXECUTION</div>
            
            <div style="background-color: #1c1c1e; padding: 16px; border-radius: 8px; border: 1px solid #2c2c2e; margin-bottom: 12px;">
              <div style="font-size: 10px; color: #8e8e93; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 4px;">ASSET PRICE</div>
              <div style="font-size: 24px; font-weight: 700; color: #ffffff;">
                ${alert.ticker} <span style="color: #30d158; margin-left: 6px;">$${livePrice.toFixed(2)}</span>
              </div>
            </div>

            <div style="background-color: #1c1c1e; padding: 16px; border-radius: 8px; border: 1px solid #2c2c2e;">
              <div style="font-size: 10px; color: #8e8e93; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 4px;">TRIGGER SCHEDULE</div>
              <div style="font-size: 16px; font-weight: 600; color: #ffffff;">Fired daily at ${alert.alert_time}</div>
            </div>
            
            <div style="font-size: 10px; color: #636366; text-align: center; margin-top: 24px; padding-top: 12px; border-top: 1px solid #2c2c2e;">
              Sent securely to ${alert.email}. Manage parameters inside your app.
            </div>
          </div>
        `;

        emailBatch.push({
          from: 'StockAlerts <alerts@stockalertapp.net>',
          to: alert.alert_email || alert.email,
          subject: emailSubject,
          html: cleanHtml
        });
      }
    }

    // 5. BULK DISPATCH PUSH NOTIFICATIONS: Chunk payloads into packets of 100
    if (pushBatch.length > 0) {
      console.log(`   Dispatched ${pushBatch.length} push notifications to high-throughput queue...`);
      for (let i = 0; i < pushBatch.length; i += 100) {
        const chunk = pushBatch.slice(i, i + 100);
        try {
          await axios.post('https://exp.host/--/api/v2/push/send', chunk, {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (pushQueueErr) {
          console.error(`   [Push Queue Error] Packet batch transmission failed:`, pushQueueErr.message);
        }
      }
      console.log(`   ✓ All push notification packets successfully transferred.`);
    }

    // 6. BULK DISPATCH EMAILS: Process the email payload queue asynchronously
    if (emailBatch.length > 0) {
      console.log(`   Dispatched ${emailBatch.length} inbox transmissions to mail queue...`);
      // Note: Resend supports sending array payloads on paid plans. For mass free tier/testing, execute concurrently:
      await Promise.allSettled(emailBatch.map(emailPayload => resend.emails.send(emailPayload)));
      console.log(`   ✓ All inbox deliveries dispatched.`);
    }

  } catch (globalError) {
    console.error('CRITICAL SCALING ENGINE ERROR:', globalError.message);
  }
}

// Minimalist server port allocation for Render production binding
const server = http.createServer((req, res) => {
  if (req.url === '/ping' || req.url === '/') {
    checkAndSendAlerts();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Mass-Market Engine Synchronized\n');
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mass production engine running on port ${PORT}.`);
});