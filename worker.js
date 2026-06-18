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

// --- AUTOMATED CALENDAR UTILITIES ---

function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNthWeekday(year, month, dayOfWeek, n) {
  let date = new Date(year, month, 1);
  let count = 0;
  while (date.getMonth() === month) {
    if (date.getDay() === dayOfWeek) {
      count++;
      if (count === n) return new Date(date);
    }
    date.setDate(date.getDate() + 1);
  }
}

function getLastMonday(year, month) {
  let date = new Date(year, month + 1, 0); 
  while (date.getDay() !== 1) {
    date.setDate(date.getDate() - 1);
  }
  return new Date(date);
}

function getObservedDate(year, month, day, skipSaturdayObserved = false) {
  let d = new Date(year, month, day);
  if (d.getDay() === 0) d.setDate(day + 1); 
  if (d.getDay() === 6 && !skipSaturdayObserved) d.setDate(day - 1); 
  return d;
}

function getMarketHolidays(year) {
  const holidays = [];

  // 1. New Year's Day
  const ny = new Date(year, 0, 1);
  holidays.push(formatDateString(ny.getDay() === 0 ? new Date(year, 0, 2) : ny));

  // 2. MLK Jr. Day
  holidays.push(formatDateString(getNthWeekday(year, 0, 1, 3)));

  // 3. Presidents' Day
  holidays.push(formatDateString(getNthWeekday(year, 1, 1, 3)));

  // 4. Good Friday
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const easterMonth = Math.floor((h + L - 7 * m + 114) / 31);
  const easterDay = ((h + L - 7 * m + 114) % 31) + 1;
  const goodFriday = new Date(year, easterMonth - 1, easterDay - 2);
  holidays.push(formatDateString(goodFriday));

  // 5. Memorial Day
  holidays.push(formatDateString(getLastMonday(year, 4)));

  // 6. Juneteenth
  holidays.push(formatDateString(getObservedDate(year, 5, 19)));

  // 7. Independence Day
  holidays.push(formatDateString(getObservedDate(year, 6, 4)));

  // 8. Labor Day
  holidays.push(formatDateString(getNthWeekday(year, 8, 1, 1)));

  // 9. Thanksgiving Day
  holidays.push(formatDateString(getNthWeekday(year, 10, 4, 4)));

  // 10. Christmas Day
  holidays.push(formatDateString(getObservedDate(year, 11, 25)));

  return holidays;
}

// --- END AUTOMATED CALENDAR UTILITIES ---

async function checkAndSendAlerts() {
  try {
    const now = new Date();
    let timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
    
    let [time, ampm] = timeString.split(' ');
    let [hour, minute] = time.split(':');
    hour = hour.padStart(2, '0');
    const currentAlertTime = `${hour}:${minute} ${ampm}`;

    console.log(`[${new Date().toLocaleTimeString()}] Mass Scan Initiated for: ${currentAlertTime}...`);

    // Clock and Calendar Logic Processing
    const pacificDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const laDay = pacificDate.getDay(); 
    const laHour = pacificDate.getHours();
    const laMinute = pacificDate.getMinutes();
    const formatYear = pacificDate.getFullYear();

    const activeMarketHolidays = getMarketHolidays(formatYear);
    const laDateString = formatDateString(pacificDate);

    const isWeekend = (laDay === 0 || laDay === 6);
    const isHoliday = activeMarketHolidays.includes(laDateString);

    const isMarketOpen = !isWeekend && !isHoliday && 
                         ((laHour === 6 && laMinute >= 30) || (laHour > 6 && laHour < 13));
    const isAfterHours = !isMarketOpen;

    // 1. UNIQUE DATABASE FETCH GATING LINE (Fixed Duplication Here)
    const { data: alerts, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('alert_time', currentAlertTime);

    if (error) throw error;
    if (!alerts || alerts.length === 0) return;

    console.log(`-> Processing ${alerts.length} user rows. Unpacking multi-ticker configurations...`);

    // 2. EXTRACTION: Unpack comma-separated list values safely
    const uniqueTickers = [...new Set(alerts.flatMap(alert => 
      alert.ticker.split(',').map(t => t.trim().toUpperCase())
    ).filter(Boolean))];
    
    const priceMap = {};

    // 3. PARALLEL FETCHING: Retrieve from Finnhub
    await Promise.all(uniqueTickers.map(async (ticker) => {
      try {
        const stockUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`;
        const response = await axios.get(stockUrl);
        
        if (response.data && response.data.c !== undefined) {
          priceMap[ticker] = {
            price: response.data.c,
            change: response.data.d || 0,
            percentChange: response.data.dp || 0
          };
        }
      } catch (tickerError) {
        console.error(`   [API Error] Failed fetching market data for ${ticker}:`, tickerError.message);
      }
    }));

    const pushBatch = [];
    const emailBatch = [];

    // 4. GROUPING ENGINE: Process individual multi-ticker values inside user objects
    const emailGroups = {}; 
    const pushGroups = {};  

    for (const alert of alerts) {
      if (alert.market_days_only && (isWeekend || isHoliday)) {
        continue; 
      }

      const rowTickers = alert.ticker.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

      for (const currentTicker of rowTickers) {
        const stockData = priceMap[currentTicker]; 
        if (!stockData) continue;

        const livePrice = (typeof stockData === 'object' && stockData !== null) ? stockData.price : Number(stockData);
        const changeValue = (typeof stockData === 'object' && stockData !== null) ? (stockData.change || 0) : 0;
        const changePercent = (typeof stockData === 'object' && stockData !== null) ? (stockData.percentChange || 0) : 0;

        if (!livePrice || isNaN(livePrice)) continue;

        const marketLabel = isAfterHours ? 'At Close' : 'Today';
        const timingPhrase = marketLabel.toLowerCase();

        const isPositive = changeValue >= 0;
        const changeColor = isPositive ? '#30d158' : '#ff453a'; 
        const formattedChange = isPositive ? `+$${changeValue.toFixed(2)}` : `-$${Math.abs(changeValue).toFixed(2)}`;
        const formattedPercent = isPositive ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;

        const assetSummary = {
          ticker: currentTicker,
          livePrice: livePrice.toFixed(2),
          changeValue,
          formattedChange,
          formattedPercent,
          changeColor,
          marketLabel,
          timingPhrase
        };

        if (alert.send_email && alert.email) {
          const targetEmail = alert.alert_email || alert.email;
          if (!emailGroups[targetEmail]) emailGroups[targetEmail] = [];
          emailGroups[targetEmail].push(assetSummary);
        }

        if (alert.send_push && alert.push_token) {
          if (!pushGroups[alert.push_token]) pushGroups[alert.push_token] = [];
          pushGroups[alert.push_token].push(assetSummary);
        }
      }
    }

    // 5. PACKET COMPILATION 
    for (const [token, assets] of Object.entries(pushGroups)) {
      let pushTitle = '';
      let pushBody = '';

      if (assets.length === 1) {
        const item = assets[0];
        pushTitle = item.changeValue !== 0 ? `📈 ${item.ticker} Alert: ${item.formattedChange}` : `📊 ${item.ticker} Alert: $${item.livePrice}`;
        pushBody = `${item.ticker} is trading at $${item.livePrice} (${item.formattedPercent}) ${item.timingPhrase}.`;
      } else {
        pushTitle = `💼 Portfolio Alert: ${assets.length} Stocks Updated`;
        pushBody = assets.map(a => `${a.ticker}: $${a.livePrice} (${a.formattedPercent})`).join(' | ');
      }

      pushBatch.push({
        to: token,
        sound: 'default',
        title: pushTitle,
        body: pushBody
      });
    }

    for (const [targetEmail, assets] of Object.entries(emailGroups)) {
      const subjectTime = currentAlertTime;
      const emailSubject = assets.length === 1 
        ? `${assets[0].ticker}: $${assets[0].livePrice} (${assets[0].formattedPercent}) at ${subjectTime}`
        : `Market Digest: ${assets.length} Alerts Synchronized at ${subjectTime}`;

      let assetsHtmlRows = '';
      for (const item of assets) {
        assetsHtmlRows += `
          <div style="background-color: #1c1c1e; padding: 16px; border-radius: 8px; border: 1px solid #2c2c2e; margin-bottom: 12px;">
            <div style="font-size: 10px; color: #8e8e93; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 6px;">CURRENT VALUE</div>
            <div style="font-size: 24px; font-weight: 700; color: #ffffff; line-height: 1.2;">
              ${item.ticker} <span style="font-weight: 500; margin-left: 4px; color: ${item.changeColor};">$${item.livePrice}</span>
            </div>
            <div style="font-size: 13px; font-weight: 600; color: ${item.changeColor}; margin-top: 4px; letter-spacing: -0.2px;">
              ${item.formattedChange} (${item.formattedPercent}) <span style="color: #636366; font-size: 11px; font-weight: 400; margin-left: 4px;">${item.marketLabel}</span>
            </div>
          </div>
        `;
      }

      const cleanHtml = `
        <div style="background-color: #121214; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; border-radius: 12px; max-width: 400px; margin: 0 auto; border: 1px solid #2c2c2e;">
          <div style="font-size: 11px; color: #8e8e93; font-weight: 600; letter-spacing: 1px; margin-bottom: 16px;">STOCK MARKET DIGEST</div>
          
          ${assetsHtmlRows}

          <div style="background-color: #1c1c1e; padding: 14px; border-radius: 8px; border: 1px solid #2c2c2e; margin-top: 4px;">
            <div style="font-size: 10px; color: #8e8e93; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 2px;">TRIGGER SCHEDULE</div>
            <div style="font-size: 14px; font-weight: 600; color: #ffffff;">Daily Batch at ${currentAlertTime}</div>
          </div>
          
          <div style="font-size: 10px; color: #636366; text-align: center; margin-top: 24px; padding-top: 12px; border-top: 1px solid #2c2c2e;">
            Sent securely to ${targetEmail}. Manage alerts in your app.
          </div>
        </div>
      `;

      emailBatch.push({
        from: 'Stock Alerts <alerts@stockalertapp.net>',
        to: targetEmail,
        subject: emailSubject,
        html: cleanHtml
      });
    }

    // 6. BULK DISPATCH TRANSMISSIONS
    if (pushBatch.length > 0) {
      console.log(`   Dispatched ${pushBatch.length} unified push notification packages...`);
      for (let i = 0; i < pushBatch.length; i += 100) {
        const chunk = pushBatch.slice(i, i + 100);
        try {
          await axios.post('https://exp.host/--/api/v2/push/send', chunk, {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (pushQueueErr) {
          console.error(`   [Push Queue Error] Packet transmission failure:`, pushQueueErr.message);
        }
      }
      console.log(`   ✓ All push notification packets successfully transferred.`);
    }

    if (emailBatch.length > 0) {
      console.log(`   Dispatched ${emailBatch.length} unified inbox packages...`);
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
