// ═══ ASTROQUANT MODULE ═══
// ═══════════════════════════════════════════════════════════════════════
//  SAARTHI ASTROQUANT — Frontend Module
//  Inject into index.html:
//    1. Add nav item (search "n-smarttrade" → add after)
//    2. Add to PT/PS objects
//    3. Add renderAstroQuant to M{} map in nav()
//    4. Paste this entire block before closing </script>
// ═══════════════════════════════════════════════════════════════════════

// ── NAV ITEM to add in sidebar (after smarttrade nav item):
// <div class="si" onclick="nav('astroquant')" id="n-astroquant">
//   <span class="si-ico">✦</span><span>AstroQuant</span>
//   <span class="si-badge am" id="aq-alert-badge" style="display:none">!</span>
// </div>

// ── PT entry: astroquant:'AstroQuant · Planetary Intelligence'
// ── PS entry: astroquant:'Planetary cycles × Indian market history · Scores, backtests, research'
// ── M{} entry: astroquant:renderAstroQuant

// ═══════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════
const AQ = {
  tab: 'dashboard',
  btResult: null,
  aiHistory: [],
  loaded: {}
};

const AQ_TABS = [
  { id: 'dashboard', label: '◉ Dashboard' },
  { id: 'sectors',   label: '⬡ Sectors' },
  { id: 'backtest',  label: '⧫ Backtest Lab' },
  { id: 'calendar',  label: '📅 Calendar' },
  { id: 'alerts',    label: '🔔 Alerts' },
  { id: 'analyst',   label: '✦ AI Analyst' },
];

const AQ_EVENTS = [
  {val:'MERCURY_RETROGRADE',     label:'Mercury Retrograde'},
  {val:'MARS_RETROGRADE',        label:'Mars Retrograde'},
  {val:'VENUS_RETROGRADE',       label:'Venus Retrograde'},
  {val:'JUPITER_SIGN_CHANGE',    label:'Jupiter Sign Change'},
  {val:'SATURN_SIGN_CHANGE',     label:'Saturn Sign Change'},
  {val:'ECLIPSE_SOLAR',          label:'Solar Eclipse'},
  {val:'ECLIPSE_LUNAR',          label:'Lunar Eclipse'},
  {val:'JUPITER_SATURN_CONJUNCTION', label:'Jupiter–Saturn Conjunction'},
];

const AQ_INSTRUMENTS = [
  {val:'NIFTY50',       label:'Nifty 50'},
  {val:'NIFTY500',      label:'Nifty 500'},
  {val:'SENSEX',        label:'Sensex'},
  {val:'GOLD',          label:'Gold (MCX)'},
  {val:'SILVER',        label:'Silver (MCX)'},
  {val:'NIFTY_BANK',   label:'Nifty Bank'},
  {val:'NIFTY_IT',     label:'Nifty IT'},
  {val:'NIFTY_PHARMA', label:'Nifty Pharma'},
  {val:'NIFTY_AUTO',   label:'Nifty Auto'},
  {val:'NIFTY_FMCG',   label:'Nifty FMCG'},
  {val:'NIFTY_METAL',  label:'Nifty Metal'},
];

// ── Helpers ──────────────────────────────────────────────────────────
function aqScore(v, size='lg') {
  const c = v >= 65 ? 'var(--green)' : v >= 45 ? 'var(--amber)' : 'var(--red)';
  const bg = v >= 65 ? 'var(--grn2)' : v >= 45 ? 'var(--amb2)' : 'var(--red2)';
  const fs = size === 'lg' ? '22px' : size === 'md' ? '15px' : '12px';
  return `<span style="font-family:var(--font-mono);font-size:${fs};font-weight:700;color:${c};background:${bg};padding:2px 8px;border-radius:5px;display:inline-block">${v?.toFixed(1)||'—'}</span>`;
}

function aqConfBadge(v) {
  const label = v >= 65 ? 'HIGH' : v >= 50 ? 'MED' : 'LOW';
  const col = v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--ink4)';
  return `<span style="font-size:9px;font-weight:700;color:${col};background:${v>=65?'var(--grn2)':v>=50?'var(--amb2)':'var(--sur3)'};padding:2px 6px;border-radius:10px;border:1px solid ${v>=65?'var(--grnbdr)':v>=50?'var(--ambbdr)':'var(--bdr)'}">${label} ${v?.toFixed(0)||0}%</span>`;
}

function aqRetro(bool) {
  return bool ? `<span style="font-size:9px;background:#fdf1ef;color:var(--red);border:1px solid var(--redbdr);padding:2px 6px;border-radius:10px;font-weight:700">℞ Retrograde</span>` : '';
}

function aqPlanetColor(planet) {
  const map = { Sun:'#e8a020', Moon:'#c0b0f0', Mars:'#c0382a', Mercury:'#22a060',
    Jupiter:'#a07820', Venus:'#c060a0', Saturn:'#605040', Rahu:'#304060', Ketu:'#606040' };
  return map[planet] || 'var(--ink3)';
}

async function aqFetch(path, opts={}) {
  return authFetch(KITE_BACKEND + path, opts);
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN RENDER
// ═══════════════════════════════════════════════════════════════════════
async function renderAstroQuant(el) {
  el.innerHTML = `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${AQ_TABS.map(t=>`
        <button onclick="aqSetTab('${t.id}')" id="aqt-${t.id}"
          style="padding:6px 14px;border-radius:20px;border:1.5px solid ${AQ.tab===t.id?'var(--gold)':'var(--bdr)'};
          background:${AQ.tab===t.id?'var(--glt)':'var(--sur)'};color:${AQ.tab===t.id?'var(--gold3)':'var(--ink3)'};
          font-size:11px;font-weight:${AQ.tab===t.id?700:500};cursor:pointer;white-space:nowrap;transition:all .15s">
          ${t.label}
        </button>`).join('')}
    </div>
    <div id="aq-body"></div>
  `;
  await aqRenderTab(document.getElementById('aq-body'));
}

function aqSetTab(tab) {
  AQ.tab = tab;
  AQ_TABS.forEach(t => {
    const btn = document.getElementById(`aqt-${t.id}`);
    if (!btn) return;
    const on = t.id === tab;
    btn.style.borderColor = on ? 'var(--gold)' : 'var(--bdr)';
    btn.style.background  = on ? 'var(--glt)'  : 'var(--sur)';
    btn.style.color       = on ? 'var(--gold3)' : 'var(--ink3)';
    btn.style.fontWeight  = on ? '700' : '500';
  });
  aqRenderTab(document.getElementById('aq-body'));
}

async function aqRenderTab(el) {
  if (!el) return;
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spin"></div><div style="margin-top:10px;font-size:11px;color:var(--ink4)">Loading AstroQuant data…</div></div>`;
  try {
    if (AQ.tab === 'dashboard') await aqRenderDashboard(el);
    else if (AQ.tab === 'sectors')   await aqRenderSectors(el);
    else if (AQ.tab === 'backtest')  await aqRenderBacktest(el);
    else if (AQ.tab === 'calendar')  await aqRenderCalendar(el);
    else if (AQ.tab === 'alerts')    await aqRenderAlerts(el);
    else if (AQ.tab === 'analyst')   await aqRenderAnalyst(el);
  } catch(e) {
    el.innerHTML = `<div style="padding:20px;background:var(--red2);border:1.5px solid var(--redbdr);border-radius:var(--r);color:var(--red)">Error: ${e.message}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TAB 1 — DASHBOARD
// ═══════════════════════════════════════════════════════════════════════
async function aqRenderDashboard(el) {
  const r = await aqFetch('/api/astro/dashboard');
  const d = await r.json();
  const { planets=[], regime={}, upcomingEvents=[], date } = d;

  const regimeColor = {
    BULLISH_ASTRO:'var(--green)', BEARISH_ASTRO:'var(--red)',
    VOLATILE:'var(--amber)', NEUTRAL:'var(--ink3)'
  }[regime.regime_label] || 'var(--ink3)';

  el.innerHTML = `
    <!-- KPI Row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${[
        {label:'Risk Appetite',  val:regime.risk_appetite,    icon:'⚡', color:'gold'},
        {label:'Volatility',     val:regime.volatility_score, icon:'〜', color:'red'},
        {label:'Liquidity',      val:regime.liquidity_score,  icon:'◎', color:'grn'},
        {label:'Sentiment',      val:regime.sentiment_score,  icon:'✦', color:'gold'},
      ].map(k=>`
        <div class="kc ${k.color}" style="text-align:center">
          <div class="kc-lbl">${k.label}</div>
          <div class="kc-val" style="font-size:28px;margin:4px 0">${k.val?.toFixed(0)||'—'}</div>
          <div style="height:4px;background:var(--sur3);border-radius:2px;margin-top:6px;overflow:hidden">
            <div style="height:100%;width:${k.val||0}%;background:${k.color==='red'?'var(--red)':k.color==='grn'?'var(--green)':'var(--gold2)'};border-radius:2px;transition:width .4s"></div>
          </div>
          <div class="kc-sub" style="margin-top:4px;font-weight:700;color:${regimeColor}">${regime.regime_label?.replace('_',' ')||'—'}</div>
        </div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 340px;gap:14px">
      <!-- Planet Positions Table -->
      <div class="tbl">
        <div class="tbl-hd"><span class="tbl-ht">🪐 Planet Positions — ${date}</span></div>
        <table>
          <thead><tr>
            <th>Planet</th><th>Sign</th><th>Nakshatra</th>
            <th style="text-align:right">Strength</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${planets.map(p=>`
              <tr>
                <td><span style="font-weight:700;color:${aqPlanetColor(p.planet)}">${p.planet}</span></td>
                <td style="font-size:12px">${p.sign||'—'}</td>
                <td style="font-size:11px;color:var(--ink3)">${p.nakshatra||'—'}</td>
                <td style="text-align:right">${aqScore(p.strength,'sm')}</td>
                <td>${p.retrograde?aqRetro(true):'<span style="font-size:10px;color:var(--green)">Direct</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <!-- Right panel: upcoming events -->
      <div>
        <div class="panel" style="margin-bottom:14px">
          <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink4);margin-bottom:10px">Upcoming Events</div>
          ${upcomingEvents.length ? upcomingEvents.map(ev=>`
            <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--bdr)">
              <div style="flex-shrink:0;width:36px;text-align:center;background:var(--sur3);border-radius:5px;padding:4px 2px">
                <div style="font-size:16px">${eventIcon(ev.event_type)}</div>
                <div style="font-size:8px;color:var(--ink4);font-weight:600">${ev.event_date?.slice(5)||''}</div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:var(--ink)">${ev.description||ev.event_type}</div>
                <div style="font-size:10px;color:var(--ink4)">${ev.planet||''}${ev.planet2?' + '+ev.planet2:''}</div>
              </div>
            </div>`).join('') : '<div style="text-align:center;padding:20px;color:var(--ink4);font-size:11px">No events in next 90 days</div>'}
        </div>
      </div>
    </div>
  `;
}

function eventIcon(type) {
  const m = { RETROGRADE_START:'℞', RETROGRADE_END:'D', SIGN_CHANGE:'→',
    ECLIPSE_SOLAR:'☀', ECLIPSE_LUNAR:'🌑', CONJUNCTION:'×', MOON_CYCLE:'🌙' };
  return m[type] || '✦';
}

// ═══════════════════════════════════════════════════════════════════════
//  TAB 2 — SECTORS
// ═══════════════════════════════════════════════════════════════════════
async function aqRenderSectors(el) {
  const r = await aqFetch('/api/astro/sectors');
  const d = await r.json();
  const { scores=[], date } = d;

  el.innerHTML = `
    <div class="tbl">
      <div class="tbl-hd">
        <span class="tbl-ht">⬡ Sector Astro Scores — ${date}</span>
        <span style="font-size:10px;color:var(--ink4)">Higher = stronger planetary support for sector</span>
      </div>
      <!-- Heatmap grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1px;background:var(--bdr);padding:0">
        ${scores.map(s=>{
          const bg = s.astro_score>=65?'#ecf7f0':s.astro_score>=45?'#fdf4e6':'#fdf1ef';
          const bar = s.astro_score||0;
          return `
          <div style="background:var(--sur);padding:14px 16px;cursor:default" title="${JSON.stringify(s.factors||{})}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
              <div style="font-size:12px;font-weight:600;color:var(--ink)">${s.sector}</div>
              ${aqScore(s.astro_score,'sm')}
            </div>
            <div style="height:3px;background:var(--sur3);border-radius:2px;margin-bottom:8px;overflow:hidden">
              <div style="height:100%;width:${bar}%;background:${bar>=65?'var(--green)':bar>=45?'var(--amber)':'var(--red)'};border-radius:2px;transition:width .5s"></div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:10px;color:${aqPlanetColor(s.primary_planet)};font-weight:600">${s.primary_planet||'—'}</span>
              <div style="display:flex;gap:5px;align-items:center">
                ${s.retrograde_active?aqRetro(true):''}
                ${aqConfBadge(s.confidence)}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Sector table detail -->
    <div class="tbl" style="margin-top:14px">
      <div class="tbl-hd"><span class="tbl-ht">Detail View</span></div>
      <table>
        <thead><tr>
          <th>Sector</th><th>Astro Score</th><th>Primary Planet</th>
          <th>Planet Strength</th><th>Retrograde</th><th>Confidence</th>
        </tr></thead>
        <tbody>
          ${scores.map(s=>`
            <tr>
              <td style="font-weight:600">${s.sector}</td>
              <td>${aqScore(s.astro_score,'md')}</td>
              <td style="color:${aqPlanetColor(s.primary_planet)};font-weight:600">${s.primary_planet||'—'}</td>
              <td>${aqScore(s.planet_strength,'sm')}</td>
              <td>${s.retrograde_active?aqRetro(true):'<span style="color:var(--green);font-size:10px">No</span>'}</td>
              <td>${aqConfBadge(s.confidence)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════
//  TAB 3 — BACKTEST LAB
// ═══════════════════════════════════════════════════════════════════════
async function aqRenderBacktest(el) {
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start">
      <!-- Config panel -->
      <div class="panel" style="position:sticky;top:0">
        <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:16px;letter-spacing:.5px">⧫ BACKTEST CONFIGURATION</div>

        <div style="margin-bottom:12px">
          <label style="font-size:10px;font-weight:600;color:var(--ink3);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Astro Event</label>
          <select id="aq-bt-event" style="width:100%;padding:8px 10px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:12px;background:var(--sur);color:var(--ink)">
            ${AQ_EVENTS.map(e=>`<option value="${e.val}">${e.label}</option>`).join('')}
          </select>
        </div>

        <div style="margin-bottom:12px">
          <label style="font-size:10px;font-weight:600;color:var(--ink3);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Instrument</label>
          <select id="aq-bt-inst" style="width:100%;padding:8px 10px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:12px;background:var(--sur);color:var(--ink)">
            ${AQ_INSTRUMENTS.map(i=>`<option value="${i.val}">${i.label}</option>`).join('')}
          </select>
        </div>

        <div style="margin-bottom:12px">
          <label style="font-size:10px;font-weight:600;color:var(--ink3);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Holding Window</label>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${[7,15,30,60].map(w=>`
              <button onclick="document.querySelectorAll('.aq-win-btn').forEach(b=>b.style.background='var(--sur)');this.style.background='var(--glt)';window._aqWin=${w}"
                class="aq-win-btn"
                style="padding:7px 4px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:11px;cursor:pointer;font-weight:600;background:${w===30?'var(--glt)':'var(--sur)'}">
                ${w}d
              </button>`).join('')}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
          <div>
            <label style="font-size:10px;font-weight:600;color:var(--ink3);display:block;margin-bottom:4px">From</label>
            <input type="date" id="aq-bt-from" value="2010-01-01" style="width:100%;padding:7px 8px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:11px">
          </div>
          <div>
            <label style="font-size:10px;font-weight:600;color:var(--ink3);display:block;margin-bottom:4px">To</label>
            <input type="date" id="aq-bt-to" value="${new Date().toISOString().split('T')[0]}" style="width:100%;padding:7px 8px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:11px">
          </div>
        </div>

        <button onclick="aqRunBacktest()" class="btn btn-gold" style="width:100%;justify-content:center">
          ⧫ Run Backtest
        </button>

        <div style="margin-top:12px;font-size:10px;color:var(--ink4);line-height:1.5">
          <b>Note:</b> Backtest uses OHLC data from Kite Connect. Ensure Kite is connected for historical data access.
        </div>
      </div>

      <!-- Results panel -->
      <div id="aq-bt-results">
        <div style="text-align:center;padding:60px 20px;color:var(--ink4)">
          <div style="font-size:32px;margin-bottom:12px">⧫</div>
          <div style="font-size:13px;font-weight:600;color:var(--ink3);margin-bottom:6px">Configure & Run a Backtest</div>
          <div style="font-size:11px">Select an astro event + instrument, then click Run Backtest</div>
        </div>
      </div>
    </div>
  `;
  window._aqWin = 30;

  if (AQ.btResult) aqRenderBtResults(document.getElementById('aq-bt-results'), AQ.btResult);
}

async function aqRunBacktest() {
  const event_type  = document.getElementById('aq-bt-event')?.value;
  const instrument  = document.getElementById('aq-bt-inst')?.value;
  const window_days = window._aqWin || 30;
  const date_from   = document.getElementById('aq-bt-from')?.value;
  const date_to     = document.getElementById('aq-bt-to')?.value;
  const resEl = document.getElementById('aq-bt-results');

  resEl.innerHTML = `<div style="padding:40px;text-align:center"><div class="spin"></div><div style="margin-top:10px;font-size:11px;color:var(--ink4)">Running backtest… fetching OHLC data from Kite…</div></div>`;

  try {
    const r = await aqFetch('/api/astro/backtest', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ event_type, instrument, window_days, date_from, date_to })
    });
    const data = await r.json();
    if (data.error) { resEl.innerHTML = `<div class="panel" style="color:var(--red)">${data.error}</div>`; return; }
    AQ.btResult = data;
    aqRenderBtResults(resEl, data);
  } catch(e) {
    resEl.innerHTML = `<div class="panel" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function aqRenderBtResults(el, d) {
  const {event_type, instrument, n_observations, avg_return_pct, cagr_pct,
         win_rate_pct, max_drawdown_pct, sharpe_ratio, observations=[]} = d;

  const winColor = avg_return_pct >= 0 ? 'var(--green)' : 'var(--red)';

  el.innerHTML = `
    <!-- Summary KPIs -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
      ${[
        {label:'Avg Return',       val:`${avg_return_pct>=0?'+':''}${avg_return_pct?.toFixed(2)||0}%`, c: avg_return_pct>=0?'var(--green)':'var(--red)'},
        {label:'CAGR',             val:`${cagr_pct>=0?'+':''}${cagr_pct?.toFixed(2)||0}%`,           c: cagr_pct>=0?'var(--green)':'var(--red)'},
        {label:'Win Rate',         val:`${win_rate_pct?.toFixed(1)||0}%`,                             c:'var(--ink)'},
        {label:'Max Drawdown',     val:`${max_drawdown_pct?.toFixed(2)||0}%`,                         c:'var(--red)'},
        {label:`Sharpe (${d.window_days}d)`, val: sharpe_ratio?.toFixed(2)||'—',                     c:'var(--ink)'},
      ].map(k=>`
        <div class="kc" style="text-align:center">
          <div class="kc-lbl">${k.label}</div>
          <div style="font-family:var(--font-mono);font-size:17px;font-weight:700;color:${k.c};margin-top:4px">${k.val}</div>
        </div>`).join('')}
    </div>

    <div style="margin-bottom:10px;padding:10px 14px;background:var(--sur3);border-radius:var(--r);font-size:11px;color:var(--ink3)">
      <b style="color:var(--ink)">${event_type?.replace(/_/g,' ')} × ${instrument}</b> —
      ${n_observations} observations · ${d.window_days}-day holding window · ${d.date_from} to ${d.date_to}
    </div>

    <!-- Scatter chart -->
    <div class="panel" style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:var(--ink3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.8px">Return per Observation</div>
      <div style="position:relative;height:180px;overflow:hidden">
        <canvas id="aq-bt-chart" style="width:100%;height:180px"></canvas>
      </div>
    </div>

    <!-- Observations table -->
    <div class="tbl">
      <div class="tbl-hd"><span class="tbl-ht">All Observations (${n_observations})</span></div>
      <table>
        <thead><tr><th>Event Date</th><th>Label</th><th style="text-align:right">Return</th><th style="text-align:right">Max DD</th></tr></thead>
        <tbody>
          ${observations.slice(0,50).map(o=>`
            <tr>
              <td style="font-family:var(--font-mono);font-size:11px">${o.date}</td>
              <td style="font-size:11px;color:var(--ink3)">${o.label||'—'}</td>
              <td style="text-align:right;font-family:var(--font-mono);font-weight:600;color:${o.return_pct>=0?'var(--green)':'var(--red)'}">${o.return_pct>=0?'+':''}${o.return_pct?.toFixed(2)||0}%</td>
              <td style="text-align:right;font-family:var(--font-mono);color:var(--red)">${o.drawdown_pct?.toFixed(2)||0}%</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Chart
  setTimeout(() => {
    const ctx = document.getElementById('aq-bt-chart');
    if (!ctx || !observations.length) return;
    if (_activeCharts['aq-bt-chart']) _activeCharts['aq-bt-chart'].destroy();
    _activeCharts['aq-bt-chart'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: observations.map(o => o.date),
        datasets: [{
          label: 'Return %',
          data: observations.map(o => o.return_pct),
          backgroundColor: observations.map(o => o.return_pct >= 0 ? 'rgba(26,110,58,.7)' : 'rgba(184,50,40,.7)'),
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => `Return: ${ctx.raw >= 0 ? '+' : ''}${ctx.raw?.toFixed(2)}%` }
        }},
        scales: {
          x: { ticks: { maxTicksLimit: 12, font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { callback: v => v + '%', font: { size: 9 } }, grid: { color: 'var(--bdr)' } }
        }
      }
    });
  }, 100);
}

// ═══════════════════════════════════════════════════════════════════════
//  TAB 4 — CALENDAR
// ═══════════════════════════════════════════════════════════════════════
async function aqRenderCalendar(el) {
  const r = await aqFetch('/api/astro/events?from=' + new Date().toISOString().split('T')[0]);
  const d = await r.json();
  const { events=[] } = d;

  // Group by month
  const byMonth = {};
  for (const ev of events) {
    const m = ev.event_date?.slice(0,7);
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(ev);
  }

  const evTypeColor = {
    RETROGRADE_START:'var(--red)', RETROGRADE_END:'var(--green)',
    SIGN_CHANGE:'var(--gold)', ECLIPSE_SOLAR:'#e05020',
    ECLIPSE_LUNAR:'#4040c0', CONJUNCTION:'var(--amber)',
    MOON_CYCLE:'#8040a0', UPCOMING_EVENT:'var(--ink3)'
  };

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 260px;gap:16px">
      <div>
        ${Object.entries(byMonth).slice(0,6).map(([month, evs]) => `
          <div class="panel" style="margin-bottom:12px">
            <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">
              ${new Date(month+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}
            </div>
            ${evs.map(ev => `
              <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--bdr)">
                <div style="width:28px;text-align:center;font-size:18px;flex-shrink:0">${eventIcon(ev.event_type)}</div>
                <div style="flex:1">
                  <div style="font-size:12px;font-weight:600;color:var(--ink)">${ev.description||ev.event_type?.replace(/_/g,' ')}</div>
                  <div style="font-size:10px;color:var(--ink4)">${ev.planet||''}${ev.planet2?' + '+ev.planet2:''}</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--ink)">${ev.event_date?.slice(8)} ${new Date(ev.event_date).toLocaleDateString('en-IN',{month:'short'})}</div>
                  <div style="font-size:9px;font-weight:700;color:${evTypeColor[ev.event_type]||'var(--ink3)'};text-transform:uppercase;letter-spacing:.5px">${ev.event_type?.replace(/_/g,' ')}</div>
                </div>
              </div>`).join('')}
          </div>`).join('')}
      </div>

      <!-- Legend -->
      <div>
        <div class="panel">
          <div style="font-size:10px;font-weight:700;color:var(--ink4);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">Event Types</div>
          ${[
            {type:'RETROGRADE_START', label:'Retrograde Begins'},
            {type:'RETROGRADE_END',   label:'Retrograde Ends (Direct)'},
            {type:'SIGN_CHANGE',      label:'Planet Sign Change'},
            {type:'ECLIPSE_SOLAR',    label:'Solar Eclipse'},
            {type:'ECLIPSE_LUNAR',    label:'Lunar Eclipse'},
            {type:'CONJUNCTION',      label:'Planetary Conjunction'},
          ].map(item=>`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span style="font-size:16px">${eventIcon(item.type)}</span>
              <span style="font-size:11px;color:${evTypeColor[item.type]||'var(--ink3)'};font-weight:600">${item.label}</span>
            </div>`).join('')}
        </div>

        <div class="panel" style="margin-top:12px">
          <div style="font-size:10px;font-weight:700;color:var(--ink4);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">Total Upcoming</div>
          <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:var(--gold)">${events.length}</div>
          <div style="font-size:10px;color:var(--ink4)">events in next 90 days</div>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════
//  TAB 5 — ALERTS
// ═══════════════════════════════════════════════════════════════════════
async function aqRenderAlerts(el) {
  const r = await aqFetch('/api/astro/alerts');
  const d = await r.json();
  const { alerts=[] } = d;

  // Update sidebar badge
  const badge = document.getElementById('aq-alert-badge');
  if (badge) { badge.style.display = alerts.length ? 'inline' : 'none'; badge.textContent = alerts.length; }

  if (!alerts.length) {
    el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--ink4)">
      <div style="font-size:32px;margin-bottom:12px">🔔</div>
      <div style="font-size:13px;font-weight:600">No active alerts</div>
      <div style="font-size:11px;margin-top:4px">Alerts are generated Mon/Wed/Fri at 7 AM IST</div>
    </div>`;
    return;
  }

  const typeColor = { RETROGRADE:'var(--red)', FAVORABLE_CYCLE:'var(--green)', VOLATILITY:'var(--amber)', UPCOMING_EVENT:'var(--gold)' };
  const typeIcon  = { RETROGRADE:'℞', FAVORABLE_CYCLE:'✦', VOLATILITY:'〜', UPCOMING_EVENT:'📅' };

  el.innerHTML = alerts.map(a => `
    <div class="panel" style="margin-bottom:12px;border-left:3px solid ${typeColor[a.alert_type]||'var(--gold)'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:20px;color:${typeColor[a.alert_type]||'var(--gold)'}">${typeIcon[a.alert_type]||'✦'}</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--ink)">${a.title}</div>
            <div style="font-size:10px;color:var(--ink4);margin-top:1px">Expires ${a.expires_at||'—'}</div>
          </div>
        </div>
        ${aqConfBadge(a.confidence)}
      </div>

      <p style="font-size:12px;color:var(--ink2);margin-bottom:10px;line-height:1.6">${a.description}</p>

      ${a.historical_evidence ? `
        <div style="background:var(--sur3);border:1px solid var(--bdr);border-radius:var(--r);padding:10px 12px">
          <div style="font-size:9px;font-weight:700;color:var(--ink4);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Historical Evidence</div>
          <div style="font-size:11px;color:var(--ink3);line-height:1.5">${a.historical_evidence}</div>
        </div>` : ''}

      ${a.planets_involved?.length ? `
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          ${a.planets_involved.map(p=>`<span style="font-size:10px;font-weight:600;color:${aqPlanetColor(p)};background:var(--sur2);border:1px solid var(--bdr);padding:2px 8px;border-radius:10px">${p}</span>`).join('')}
        </div>` : ''}
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════════════
//  TAB 6 — AI ANALYST
// ═══════════════════════════════════════════════════════════════════════
async function aqRenderAnalyst(el) {
  const sugR = await aqFetch('/api/astro/ai-query/suggestions');
  const { suggestions=[] } = await sugR.json();

  el.innerHTML = `
    <div style="max-width:800px;margin:0 auto">
      <!-- Chat history -->
      <div id="aq-chat" style="min-height:200px;margin-bottom:16px">
        ${AQ.aiHistory.length === 0 ? `
          <div style="text-align:center;padding:40px 20px">
            <div style="font-size:28px;margin-bottom:12px">✦</div>
            <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px">AstroQuant AI Analyst</div>
            <div style="font-size:11px;color:var(--ink4);margin-bottom:20px">Ask me about planetary cycles and Indian market history.<br>I only answer from database evidence — no speculation.</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left">
              ${suggestions.map(q=>`
                <div onclick="aqAskQuestion('${q.replace(/'/g,"\\'")}'); "
                  style="padding:10px 12px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:11px;color:var(--ink3);cursor:pointer;background:var(--sur);transition:all .15s"
                  onmouseover="this.style.background='var(--glt)';this.style.borderColor='var(--gold)'"
                  onmouseout="this.style.background='var(--sur)';this.style.borderColor='var(--bdr)'">
                  ${q}
                </div>`).join('')}
            </div>
          </div>` : aqRenderChatHistory()}
      </div>

      <!-- Input -->
      <div style="display:flex;gap:10px;align-items:flex-end;position:sticky;bottom:0;background:var(--bg);padding:12px 0">
        <textarea id="aq-q" placeholder="Ask about planetary cycles and market history…"
          style="flex:1;padding:10px 12px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:12px;resize:none;height:64px;font-family:var(--font);background:var(--sur);color:var(--ink)"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();aqAskQuestion()}"></textarea>
        <button onclick="aqAskQuestion()" class="btn btn-gold" style="height:64px;padding:0 20px">
          Ask ✦
        </button>
      </div>
    </div>
  `;
}

function aqRenderChatHistory() {
  return AQ.aiHistory.map(m => `
    <div style="margin-bottom:14px;display:flex;${m.role==='user'?'justify-content:flex-end':''}">
      <div style="max-width:85%;padding:12px 14px;border-radius:${m.role==='user'?'12px 12px 4px 12px':'12px 12px 12px 4px'};
        background:${m.role==='user'?'var(--gold)':'var(--sur)'};color:${m.role==='user'?'#fff':'var(--ink)'};
        border:${m.role==='user'?'none':'1.5px solid var(--bdr)'};font-size:12px;line-height:1.6">
        ${m.role==='assistant'?`<div style="font-size:9px;font-weight:700;color:${m.role==='user'?'rgba(255,255,255,.6)':'var(--gold3)'};text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">✦ AstroQuant Analyst</div>`:''}
        ${m.content}
      </div>
    </div>`).join('');
}

async function aqAskQuestion(preset) {
  const input = document.getElementById('aq-q');
  const question = preset || input?.value?.trim();
  if (!question) return;
  if (input) input.value = '';

  AQ.aiHistory.push({ role: 'user', content: question });
  AQ.aiHistory.push({ role: 'assistant', content: '<span class="spin" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle"></span> Querying database…' });

  const chatEl = document.getElementById('aq-chat');
  if (chatEl) chatEl.innerHTML = aqRenderChatHistory();

  try {
    const r = await aqFetch('/api/astro/ai-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    const d = await r.json();
    AQ.aiHistory[AQ.aiHistory.length - 1] = {
      role: 'assistant',
      content: d.answer || 'No response received.'
    };
  } catch(e) {
    AQ.aiHistory[AQ.aiHistory.length - 1] = { role: 'assistant', content: 'Error: ' + e.message };
  }

  if (chatEl) chatEl.innerHTML = aqRenderChatHistory();
}

// ── Load alert count on page load ────────────────────────────────
(async function _aqInitBadge() {
  try {
    const r = await aqFetch('/api/astro/alerts');
    const { alerts=[] } = await r.json();
    const badge = document.getElementById('aq-alert-badge');
    if (badge && alerts.length) { badge.style.display = 'inline'; badge.textContent = alerts.length; }
  } catch(e) {}
})();

