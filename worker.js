const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const axios = require('axios');
const http = require('http'); // Built-in Node network tool

// CONFIGURATION: Ensure your keys are populated here
const SUPABASE_URL = 'https://ydppmymoaosvnhibxkbx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcHBteW1vYW9zdm5oaWJ4a2J4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTY2MTY2NiwiZXhwIjoyMDk3MjM3NjY2fQ.R6flAThoNSALA1muuBbR3lmI921iSCpyoFDV6xxs4N8';
const FINNHUB_API_KEY = 'd8p3bnpr01qp954ukcl0d8p3bnpr01qp954ukclg';
const RESEND_API_KEY = 're_Qo7LXrW4_3trRcyJw1boqY3bUAZQAaaS2';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const resend = new Resend(RESEND_API_KEY);

// THE MASTER SCANNERS LOGIC
async function checkAndSendAlerts() {
  try {
    const now = new Date();
    let timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
    
    let [time, ampm] = timeString.split(' ');
    let [hour, minute] = time.split(':');
    hour = hour.padStart(2, '0');
    const currentAlertTime = `${hour}:${minute} ${ampm}`;

    console.log(`[${new Date().toLocaleTimeString()}] Cloud Ping Received! Scanning for: ${currentAlertTime}...`);

    const { data: alerts, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('alert_time', currentAlertTime);

    if (error) throw error;
    if (!alerts || alerts.length === 0) {
      console.log('-> No notifications scheduled for this minute.');
      return;
    }

    for (const alert of alerts) {
      const stockUrl = `https://finnhub.io/api/v1/quote?symbol=${alert.ticker}&token=${FINNHUB_API_KEY}`;
      const stockResponse = await axios.get(stockUrl);
      const currentPrice = stockResponse.data.c;

      if (!currentPrice || currentPrice === 0) continue;
      const alertMessage = `${alert.ticker} is trading at $${currentPrice.toFixed(2)}.`;

      if (alert.send_push && alert.push_token) {
        try {
          await axios.post('https://exp.host/--/api/v2/push/send', {
            to: alert.push_token,
            sound: 'default',
            title: `📈 Market Trigger: ${alert.ticker}`,
            body: alertMessage,
          });
          console.log(`   ✓ Lock-screen push dispatched for ${alert.ticker}`);
        } catch (pErr) { console.error(pErr.message); }
      }

      if (alert.send_email && alert.email) {
        try {
          await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: alert.email,
            subject: `Market Notification: ${alert.ticker}`,
            text: `StockAlert: ${alertMessage}`
          });
          console.log(`   ✓ Email alert routed to inbox.`);
        } catch (eErr) { console.error(eErr.message); }
      }
    }
  } catch (err) {
    console.error('Global operational error:', err.message);
  }
}

// Create a minimalist web server listener to receive internet pings
const server = http.createServer((req, res) => {
  if (req.url === '/ping' || req.url === '/') {
    // Fire the stock tracking algorithm immediately when pinged
    checkAndSendAlerts();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('StockAlerts Worker Active\n');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Listen on the port Render assigns us, defaulting to 3000 locally
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cloud Server listening natively on port ${PORT}...`);
});