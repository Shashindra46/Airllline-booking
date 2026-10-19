/**
 * AeroNexus — Mock Backend API Server (v2)
 * Now powered by a global airports dataset (400+ airports / all countries)
 *
 * Run: node server.js
 * API base: http://localhost:3000/api
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ── LOAD GLOBAL AIRPORTS DATASET ───────────────────────────────────
   We load airports.json once at startup and build an in-memory
   lowercase lookup cache for ultra-fast prefix / substring matching.
   ─────────────────────────────────────────────────────────────────── */
const AIRPORTS_PATH = path.join(__dirname, 'airports.json');
let ALL_AIRPORTS = [];

try {
  const raw = fs.readFileSync(AIRPORTS_PATH, 'utf8');
  ALL_AIRPORTS = JSON.parse(raw);
  console.log(`✅ Loaded ${ALL_AIRPORTS.length} airports from airports.json`);
} catch (err) {
  console.error('❌ Failed to load airports.json:', err.message);
  process.exit(1);
}

/**
 * Build a pre-processed cache for fast search.
 * Each airport gets a single lowercase "search blob" combining all
 * searchable fields. This avoids redundant .toLowerCase() calls on
 * every request.
 */
const AIRPORTS_CACHE = ALL_AIRPORTS.map(a => ({
  ...a,
  _blob: [a.c, a.city, a.country, a.name, a.region]
            .join(' ')
            .toLowerCase()
}));

/**
 * Search airports — returns up to `limit` results sorted by relevance:
 *   1. Exact IATA code match (highest priority)
 *   2. City / country starts-with
 *   3. Any field substring match
 *
 * @param {string} query - Raw user input
 * @param {number} limit - Max results to return (default 10)
 */
function searchAirports(query, limit = 10) {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 1) return [];

  const exact   = [];  // IATA code exact match
  const starts  = [];  // city/country starts with query
  const partial = [];  // any other substring match

  for (const ap of AIRPORTS_CACHE) {
    if (!ap._blob.includes(q)) continue;

    if (ap.c.toLowerCase() === q) {
      exact.push(ap);
    } else if (
      ap.city.toLowerCase().startsWith(q) ||
      ap.country.toLowerCase().startsWith(q)
    ) {
      starts.push(ap);
    } else {
      partial.push(ap);
    }

    // Early exit once we have enough candidates
    if (exact.length + starts.length + partial.length >= limit * 3) break;
  }

  // Merge in priority order and strip the internal _blob field
  return [...exact, ...starts, ...partial]
    .slice(0, limit)
    .map(({ _blob, ...ap }) => ap);
}

/* ── STATIC DATA ─────────────────────────────────────────────────── */
const AIRLINES = [
  { code:'AN', name:'AeroNexus',             color:'#0C2340' },
  { code:'BA', name:'British Airways',        color:'#1D4E89' },
  { code:'AA', name:'American Airlines',      color:'#1C3E6E' },
  { code:'UA', name:'United Airlines',        color:'#1B3A6B' },
  { code:'DL', name:'Delta Air Lines',        color:'#8B1A2D' },
  { code:'LH', name:'Lufthansa',              color:'#0D3880' },
  { code:'EK', name:'Emirates',              color:'#6A1B9A' },
  { code:'QR', name:'Qatar Airways',          color:'#5C0A33' },
  { code:'SQ', name:'Singapore Airlines',    color:'#1B5E20' },
  { code:'AF', name:'Air France',            color:'#1A237E' },
  { code:'KL', name:'KLM Royal Dutch',       color:'#0072C6' },
  { code:'UL', name:'SriLankan Airlines',    color:'#005DAA' },
  { code:'AI', name:'Air India',             color:'#B22234' },
  { code:'TK', name:'Turkish Airlines',      color:'#B71C1C' },
  { code:'CX', name:'Cathay Pacific',        color:'#2C5F7A' },
  { code:'ET', name:'Ethiopian Airlines',    color:'#078930' },
  { code:'NH', name:'All Nippon Airways',    color:'#1565C0' },
];

let DEPARTURES = [
  { f:'AN 2847', dest:'London LHR',      time:'09:45', status:'boarding',  gate:'B22', terminal:'T4' },
  { f:'UL 0501', dest:'Colombo CMB',     time:'10:30', status:'on-time',   gate:'D15', terminal:'T3' },
  { f:'BA 0175', dest:'New York JFK',    time:'10:20', status:'on-time',   gate:'A14', terminal:'T5' },
  { f:'LH 0761', dest:'Frankfurt FRA',   time:'11:00', status:'delayed',   gate:'C08', terminal:'T2' },
  { f:'EK 0003', dest:'Dubai DXB',       time:'11:45', status:'on-time',   gate:'D31', terminal:'T3' },
  { f:'QR 0004', dest:'Doha DOH',        time:'13:15', status:'on-time',   gate:'E07', terminal:'T4' },
  { f:'SQ 0321', dest:'Singapore SIN',   time:'14:30', status:'boarding',  gate:'F11', terminal:'T5' },
  { f:'AI 0101', dest:'Delhi DEL',       time:'15:05', status:'on-time',   gate:'G03', terminal:'T1' },
  { f:'AF 1680', dest:'Paris CDG',       time:'15:10', status:'departed',  gate:'A22', terminal:'T2' },
  { f:'AN 3301', dest:'Toronto YYZ',     time:'16:40', status:'on-time',   gate:'B17', terminal:'T4' },
  { f:'KL 1009', dest:'Amsterdam AMS',   time:'17:25', status:'delayed',   gate:'C03', terminal:'T3' },
  { f:'TK 0011', dest:'Istanbul IST',    time:'18:55', status:'on-time',   gate:'D29', terminal:'T1' },
  { f:'ET 0500', dest:'Addis Ababa ADD', time:'20:10', status:'on-time',   gate:'H02', terminal:'T2' },
];

/* ── HELPERS ──────────────────────────────────────────────────────── */
const pad2      = n => String(n).padStart(2, '0');
const minsToHM  = m => `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`;
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick      = arr => arr[randomInt(0, arr.length - 1)];

/* ── ROUTE: GET /api/airports ────────────────────────────────────────
   Query params:
     q     – search string (city, country, IATA code, name)
     limit – max results (default 10, max 20)
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/airports', (req, res) => {
  const { q = '', limit = '10' } = req.query;
  const maxResults = Math.min(parseInt(limit, 10) || 10, 20);

  if (!q.trim()) {
    // Return first 20 major airports as defaults when no query
    return res.json(ALL_AIRPORTS.slice(0, 20));
  }

  const results = searchAirports(q, maxResults);
  res.json(results);
});

/* ── ROUTE: GET /api/airports/:iata ─────────────────────────────────
   Look up a single airport by exact IATA code.
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/airports/:iata', (req, res) => {
  const iata   = req.params.iata.toUpperCase();
  const airport = ALL_AIRPORTS.find(a => a.c === iata);
  if (!airport) return res.status(404).json({ error: `Airport ${iata} not found` });
  res.json(airport);
});

/* ── ROUTE: GET /api/airlines ────────────────────────────────────── */
app.get('/api/airlines', (req, res) => {
  res.json(AIRLINES);
});

/* ── ROUTE: GET /api/flights/search ──────────────────────────────────
   Query params:
     from   – IATA code of departure airport
     to     – IATA code of arrival airport
     cabin  – Economy | Premium Economy | Business | First
     adults – number of adult passengers (default 1)
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/flights/search', (req, res) => {
  const { from, to, cabin = 'Economy', adults = '1', airline = '' } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: '`from` and `to` query params are required.' });
  }

  // Verify both airports exist
  const fromAp = ALL_AIRPORTS.find(a => a.c === from.toUpperCase());
  const toAp   = ALL_AIRPORTS.find(a => a.c === to.toUpperCase());
  if (!fromAp || !toAp) {
    return res.status(400).json({ error: 'One or both airport codes are not recognised.' });
  }

  const cabinMultipliers = {
    'Economy':         1.0,
    'Premium Economy': 1.85,
    'Business':        3.4,
    'First':           6.5,
  };
  const cabinMult  = cabinMultipliers[cabin] || 1.0;
  const adultCount = Math.max(1, parseInt(adults, 10) || 1);
  const basePrice  = 180 + Math.random() * 280;

  const AIRCRAFT_TYPES = [
    'Boeing 787-9 Dreamliner',
    'Airbus A350-900',
    'Boeing 777-300ER',
    'Airbus A380-800',
    'Boeing 737 MAX 9',
    'Airbus A320neo',
  ];

  // If an airline code was specified, find that airline record (fallback to random)
  const requestedAirline = airline
    ? AIRLINES.find(a => a.code === airline.toUpperCase()) || null
    : null;

  const results = Array.from({ length: 8 }, (_, i) => {
    // First result is ALWAYS the requested airline when one was specified
    const airlineEntry = (i === 0 && requestedAirline) ? requestedAirline : pick(AIRLINES);
    const depH     = randomInt(5, 22);
    const depM     = pick([0, 5, 10, 15, 20, 25, 30, 40, 45, 50]);
    const durH     = randomInt(2, 14);
    const durM     = pick([0, 15, 30, 45]);
    const durTotal = durH * 60 + durM;
    const arrTotal = depH * 60 + depM + durTotal;
    const price    = Math.round(basePrice * cabinMult * (1 + Math.random() * 0.9) / 5) * 5;
    const stops    = Math.random() < 0.42 ? 0 : Math.random() < 0.7 ? 1 : 2;

    return {
      id:         i,
      airline:    airlineEntry.name,
      alCode:     airlineEntry.code,
      alColor:    airlineEntry.color,
      flightId:   `${airlineEntry.code} ${randomInt(1000, 9999)}`,
      from:       fromAp.c,
      fromCity:   fromAp.city,
      fromCountry:fromAp.country,
      to:         toAp.c,
      toCity:     toAp.city,
      toCountry:  toAp.country,
      dep:        `${pad2(depH)}:${pad2(depM)}`,
      arr:        `${pad2(Math.floor(arrTotal / 60) % 24)}:${pad2(arrTotal % 60)}`,
      dur:        minsToHM(durTotal),
      durMin:     durTotal,
      stops,
      price,
      priceTotal: price * adultCount,
      cabin,
      aircraft:   pick(AIRCRAFT_TYPES),
      amenities:  stops === 0
                    ? ['Wi-Fi', 'Meal', 'USB', 'Entertainment', 'Lounge access']
                    : ['Wi-Fi', 'Meal', 'USB'],
      badge:      i === 0 ? (requestedAirline ? `${requestedAirline.name}` : 'Best Value') : (i === 1 && stops === 0 ? 'Fastest' : null),
    };
  });

  // Simulate realistic API latency (600ms – 1.4s)
  const delay = randomInt(600, 1400);
  setTimeout(() => res.json(results), delay);
});


/* ── ROUTE: GET /api/booking/:ref ────────────────────────────────────
   Returns mock booking details for a given reference.
   Query params:
     ln – passenger last name (used for validation simulation)
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/booking/:ref', (req, res) => {
  const { ref } = req.params;
  const { ln = 'DOE' } = req.query;
  const hasLayover = Math.random() > 0.5;

  setTimeout(() => {
    res.json({
      ref:         ref.toUpperCase(),
      status:      'Confirmed',
      passenger:   `${ln.toUpperCase()}, J.`,
      hasLayover,
      flight: {
        id:       'AN 2847',
        from:     'JFK',
        to:       'LHR',
        dep:      '09:45',
        arr:      '21:15',
        gate:     'B22',
        terminal: 'T4',
        seat:     '22A',
        cabin:    'Economy',
        aircraft: 'Boeing 787-9 Dreamliner',
      },
    });
  }, randomInt(800, 1200));
});

/* ── ROUTE: GET /api/departures ──────────────────────────────────────
   Returns the live departures board, randomly mutating statuses to
   simulate a real airport FIDS (Flight Information Display System).
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/departures', (req, res) => {
  const STATUSES = ['on-time', 'boarding', 'delayed'];
  DEPARTURES = DEPARTURES.map(d => {
    if (d.status !== 'departed' && Math.random() < 0.18) {
      return { ...d, status: pick(STATUSES) };
    }
    return d;
  });
  res.json(DEPARTURES);
});

/* ── ROUTE: GET /api/weather/:iata ──────────────────────────────────
   Returns simulated weather for an airport city.
   (In production you'd call a real weather API like OpenWeather)
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/weather/:iata', (req, res) => {
  const CONDITIONS = [
    { condition:'Clear', icon:'☀', tempC: randomInt(18,36), windKph: randomInt(8,25), vis:'10 km', humidity: randomInt(30,60) },
    { condition:'Partly Cloudy', icon:'⛅', tempC: randomInt(14,28), windKph: randomInt(12,30), vis:'8 km', humidity: randomInt(45,70) },
    { condition:'Overcast', icon:'☁', tempC: randomInt(10,22), windKph: randomInt(15,40), vis:'6 km', humidity: randomInt(60,80) },
    { condition:'Rain Showers', icon:'🌧', tempC: randomInt(8,20), windKph: randomInt(20,55), vis:'4 km', humidity: randomInt(75,95) },
    { condition:'Thunderstorm', icon:'⛈', tempC: randomInt(15,28), windKph: randomInt(40,80), vis:'2 km', humidity: randomInt(85,100) },
    { condition:'Fog', icon:'🌫', tempC: randomInt(4,16), windKph: randomInt(5,20), vis:'0.5 km', humidity: randomInt(90,100) },
    { condition:'Snow', icon:'❄', tempC: randomInt(-12,2), windKph: randomInt(15,45), vis:'3 km', humidity: randomInt(70,90) },
  ];

  const iata = req.params.iata.toUpperCase();
  const airport = ALL_AIRPORTS.find(a => a.c === iata);
  const weather = pick(CONDITIONS);

  res.json({
    iata,
    city:       airport ? airport.city : iata,
    country:    airport ? airport.country : '',
    ...weather,
    tempF:      Math.round(weather.tempC * 9/5 + 32),
    updatedAt:  new Date().toISOString(),
  });
});

/* ── ROUTE: GET /api/stats ───────────────────────────────────────── */
app.get('/api/stats', (req, res) => {
  res.json({
    totalAirports:  ALL_AIRPORTS.length,
    totalAirlines:  AIRLINES.length,
    totalBookings:  BOOKINGS_DB.length,
    serverTime:     new Date().toISOString(),
    version:        '3.0.0',
  });
});

/* ═══════════════════════════════════════════════════════════════════
   VISA INTELLIGENCE ENGINE
   A simplified but realistic rules engine. Uses passport power tiers
   and destination groups to determine visa requirements.
   In production, this would query IATA Timatic or similar.
   ═══════════════════════════════════════════════════════════════════ */

// Tier 1 — Powerful passports (visa-free to most OECD nations)
const VISA_TIER1 = new Set([
  'United States','United Kingdom','Canada','Australia','New Zealand',
  'Japan','South Korea','Singapore','Germany','France','Italy','Spain',
  'Netherlands','Sweden','Norway','Finland','Denmark','Switzerland',
  'Austria','Belgium','Portugal','Ireland','Luxembourg','Iceland',
  'Greece','Poland','Czech Republic','Hungary','Slovakia','Slovenia',
  'Croatia','Estonia','Latvia','Lithuania','Malta','Cyprus','Romania',
  'Bulgaria','Liechtenstein','Monaco','San Marino','Andorra',
  'Hong Kong','Taiwan','Israel','Chile','UAE','Bahrain','Kuwait',
  'Qatar','Oman','Saudi Arabia','Malaysia','Brunei','Mauritius','Barbados',
]);

// Tier 2 — Medium-strength passports
const VISA_TIER2 = new Set([
  'Brazil','Mexico','Argentina','Colombia','Peru','Ecuador',
  'China','Turkey','Russia','Ukraine','Georgia','Armenia','Azerbaijan',
  'Thailand','Indonesia','Philippines','Vietnam','India',
  'South Africa','Morocco','Tunisia','Egypt','Jordan',
  'Kazakhstan','Uzbekistan','Malaysia','Serbia','Albania',
  'Bosnia and Herzegovina','North Macedonia','Montenegro','Moldova',
]);

// Schengen Area countries
const SCHENGEN = new Set([
  'Austria','Belgium','Czech Republic','Denmark','Estonia','Finland',
  'France','Germany','Greece','Hungary','Iceland','Italy','Latvia',
  'Liechtenstein','Lithuania','Luxembourg','Malta','Netherlands',
  'Norway','Poland','Portugal','Slovakia','Slovenia','Spain','Sweden',
  'Switzerland',
]);

// Countries that offer visa-on-arrival or e-visa to many visitors
const EVISA_DESTINATIONS = new Set([
  'India','Sri Lanka','Turkey','Egypt','Cambodia','Vietnam',
  'Myanmar','Laos','Nepal','Bhutan','Ethiopia','Kenya','Tanzania',
  'Uganda','Rwanda','Maldives','Thailand','Indonesia','Jordan',
]);

/**
 * Core visa rules engine.
 * Returns a structured visa requirement object.
 */
function getVisaStatus(nationality, destinationCountry) {
  if (!nationality || !destinationCountry) return null;

  // Same country — no visa needed
  if (nationality === destinationCountry) {
    return build('visa-free', 'Visa Free', 'No entry document required — you are travelling to your home country.', 'N/A', 'Free', 'Unlimited');
  }

  const natSchengen  = SCHENGEN.has(nationality);
  const destSchengen = SCHENGEN.has(destinationCountry);
  const isT1 = VISA_TIER1.has(nationality);
  const isT2 = VISA_TIER2.has(nationality);
  // Tier 3 = everything else

  // ── Intra-Schengen travel ──
  if (natSchengen && destSchengen) {
    return build('visa-free', 'Visa Free', 'No visa required. Freedom of movement applies within the Schengen Area.', 'N/A', 'Free', '90 days per 180 days');
  }

  // ── EU/Schengen passport to UK ──
  if ((natSchengen || nationality === 'Ireland') && destinationCountry === 'United Kingdom') {
    return build('evisa', 'ETA Required', 'UK Electronic Travel Authorisation (ETA) required. Apply online before travelling. Takes ~24 hours.', '24 hours', '£10 GBP', '6 months');
  }

  // ── UK passport to Schengen ──
  if (nationality === 'United Kingdom' && destSchengen) {
    return build('evisa', 'ETIAS Required (2025+)', 'European Travel Information and Authorisation System (ETIAS) required for post-Brexit UK passport holders.', '10 minutes online', '€7 EUR', '90 days per 180 days');
  }

  // ── Tier-1 passport specific destination overrides ──
  if (isT1) {
    const dest = destinationCountry;
    if (dest === 'United States') {
      // Non-US T1 passports still need ESTA
      return build('evisa', 'ESTA Required', 'Electronic System for Travel Authorization (ESTA) required. Apply via the official CBP website before travelling.', 'Up to 72 hours', '$21 USD', '90 days / 2 years validity');
    }
    if (dest === 'Canada') {
      return build('evisa', 'eTA Required', 'Electronic Travel Authorization required for visa-exempt foreign nationals flying to or transiting through Canada.', 'Minutes to days', 'CAD $7', '5 years or passport expiry');
    }
    if (dest === 'Australia') {
      return build('evisa', 'ETA/eVisitor Required', 'Australian Electronic Travel Authority (ETA) or eVisitor visa required. Apply online via the Australian ETA app.', '24–72 hours', 'AUD $20 (ETA) / Free (eVisitor)', '12 months, max 3 months per stay');
    }
    if (dest === 'India') {
      return build('evisa', 'e-Visa Required', 'Indian e-Visa available for tourist, business, and medical purposes. Apply at indianvisaonline.gov.in.', '72–96 hours', '$25–$80 USD (by nationality)', '30–180 days');
    }
    if (dest === 'China') {
      return build('evisa', '15-Day Visa-Free (2024)', 'China offers 15-day visa-free entry for nationals of many countries including EU, US, and UK. Apply for standard visa for longer stays.', 'No prior application needed', 'Free', '15 days');
    }
    if (dest === 'Russia') {
      return build('visa-required', 'Visa Required', 'A tourist or business visa issued by a Russian consulate or embassy is required. Processing times vary.', '2–4 weeks', '$80–$160 USD', '30–90 days (visa dependent)');
    }
    if (dest === 'Sri Lanka') {
      return build('evisa', 'ETA Required', 'Electronic Travel Authorization required. Apply at eta.gov.lk. Simple online process.', '24–48 hours', '$35 USD', '30 days (extendable to 90)');
    }
    if (dest === 'Saudi Arabia') {
      return build('evisa', 'e-Visa Available', 'Online tourist visa available for most nationalities. Apply at visa.visitsaudi.com.', 'Instant–24 hours', '$80 USD', '90 days within 1 year');
    }
    if (dest === 'Brazil') {
      return build('visa-free', 'Visa Free', 'Most Western passport holders enjoy visa-free entry to Brazil for stays up to 90 days.', 'N/A', 'Free', '90 days (extendable)');
    }
    if (dest === 'Argentina') {
      return build('visa-free', 'Visa Free', 'Visa-free entry for most nationalities for tourism or business for up to 90 days.', 'N/A', 'Free', '90 days');
    }
    if (EVISA_DESTINATIONS.has(dest)) {
      return build('evisa', 'e-Visa / Visa on Arrival', `e-Visa or visa-on-arrival available for ${dest}. Apply online or obtain at the port of entry.`, '24–72 hours or on arrival', '$20–$50 USD', '15–30 days (extendable)');
    }
    // Default for Tier 1 — mostly visa-free to each other
    return build('visa-free', 'Visa Free', `${nationality} passport holders enjoy visa-free access to ${destinationCountry} for short stays.`, 'N/A', 'Free', '90 days');
  }

  // ── Tier-2 passport rules ──
  if (isT2) {
    const dest = destinationCountry;
    // T2 to Schengen — generally needs a Schengen visa
    if (destSchengen || dest === 'United Kingdom' || dest === 'United States' || dest === 'Canada' || dest === 'Australia') {
      return build('visa-required', 'Visa Required', `A visa is required for ${nationality} passport holders travelling to ${destinationCountry}. Apply at the nearest embassy or consulate well in advance.`, '2–8 weeks', '$80–$200 USD (consulate fee)', 'As per visa approval');
    }
    if (dest === 'Japan' || dest === 'South Korea') {
      return build('visa-required', 'Visa Required', `A visa is required. Apply at the ${destinationCountry} consulate or embassy. Some nationalities may qualify for e-visa.`, '3–5 business days', '¥3,000 / ₩40,000', '15–90 days');
    }
    if (EVISA_DESTINATIONS.has(dest)) {
      return build('evisa', 'e-Visa / Visa on Arrival', `e-Visa available. Apply online or at the airport on arrival.`, '24–72 hours', '$20–$50 USD', '15–30 days');
    }
    // Default T2 — e-visa or visa required
    return build('evisa', 'E-Visa Eligible', `An e-visa may be available for ${destinationCountry}. Check the destination country's official immigration website.`, '24–96 hours', 'Varies', '30–90 days');
  }

  // ── Tier-3 passport (all remaining nationalities) ──
  const dest = destinationCountry;
  if (destSchengen || dest === 'United Kingdom' || dest === 'United States' || dest === 'Canada' || dest === 'Australia' || dest === 'New Zealand' || dest === 'Japan' || dest === 'South Korea' || dest === 'Singapore') {
    return build('visa-required', 'Visa Required', `A visa is required. You must apply in person at the ${destinationCountry} embassy or consulate. Early application is strongly recommended as processing times can be lengthy.`, '4–12 weeks', '$100–$250 USD + supporting documents', 'As per visa approval');
  }
  if (EVISA_DESTINATIONS.has(dest)) {
    return build('evisa', 'Visa on Arrival / e-Visa', `Visa on arrival or e-visa may be available. Confirm on the official immigration portal of ${destinationCountry}.`, 'On arrival or 24–72 hours', '$20–$50 USD', '15–30 days');
  }
  // Default T3
  return build('visa-required', 'Visa Required', `A visa is required for travel from ${nationality} to ${destinationCountry}. Contact the nearest embassy for requirements and processing times.`, '4–8 weeks', 'Varies', 'As per visa approval');
}

/** Helper to build a consistent visa result object */
function build(status, label, notes, processingTime, fee, allowedStay) {
  const colorMap = { 'visa-free': 'green', 'evisa': 'amber', 'visa-required': 'red' };
  return { status, label, color: colorMap[status] || 'grey', notes, processingTime, fee, allowedStay,
    requirements: status === 'visa-free'
      ? ['Valid passport (min. 6 months validity)', 'Return or onward ticket', 'Proof of accommodation']
      : status === 'evisa'
      ? ['Valid passport (min. 6 months validity)', 'Digital passport photo', 'Credit/debit card for payment', 'Return or onward ticket']
      : ['Valid passport (min. 6 months validity)', 'Completed visa application form', 'Passport-sized photographs', 'Proof of accommodation & travel itinerary', 'Bank statements (last 3–6 months)', 'Travel insurance', 'Sponsorship letter (if applicable)'],
  };
}

/* ── ROUTE: GET /api/visa-check ─────────────────────────────────────
   Returns visa requirements for a nationality / destination pair.
   Query params:
     nationality        – passenger's passport country
     destinationCountry – country of the TO airport
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/visa-check', (req, res) => {
  const { nationality, destinationCountry } = req.query;
  if (!nationality || !destinationCountry) {
    return res.status(400).json({ error: '`nationality` and `destinationCountry` are required.' });
  }
  const result = getVisaStatus(nationality.trim(), destinationCountry.trim());
  if (!result) return res.status(400).json({ error: 'Could not determine visa status.' });
  setTimeout(() => res.json(result), randomInt(200, 500)); // realistic latency
});

/* ═══════════════════════════════════════════════════════════════════
   BOOKINGS DATABASE
   In-memory store for booked itineraries. In production this would be
   a PostgreSQL / MongoDB database.
   ═══════════════════════════════════════════════════════════════════ */
const BOOKINGS_DB = [];

/** Generate a PNR: AN- + 6 alphanumeric characters */
function generatePNR() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const suffix = Array.from({ length: 6 }, () => chars[randomInt(0, chars.length - 1)]).join('');
  return `AN-${suffix}`;
}

/* ── ROUTE: POST /api/book ───────────────────────────────────────────
   Creates a new booking and returns a PNR.
   Body: { flight, passenger: { firstName, lastName, passport, nationality }, totalPrice }
   ─────────────────────────────────────────────────────────────────── */
app.post('/api/book', (req, res) => {
  const { flight, passenger, totalPrice } = req.body;

  // Validation
  if (!flight || !passenger) {
    return res.status(400).json({ error: 'flight and passenger details are required.' });
  }
  const { firstName, lastName, passport, nationality } = passenger;
  if (!firstName || !lastName || !passport || !nationality) {
    return res.status(400).json({ error: 'All passenger fields (firstName, lastName, passport, nationality) are required.' });
  }
  if (passport.length < 6) {
    return res.status(422).json({ error: 'Passport number must be at least 6 characters.' });
  }

  const pnr = generatePNR();
  const booking = {
    pnr,
    status:    'Confirmed',
    flight,
    passenger: { firstName: firstName.trim().toUpperCase(), lastName: lastName.trim().toUpperCase(), passport: passport.trim().toUpperCase(), nationality },
    totalPrice,
    issuedAt:  new Date().toISOString(),
    ticketType:'E-Ticket',
    baggageAllowance: flight.cabin === 'Economy'    ? '1 × 23 kg checked + 7 kg cabin'
                    : flight.cabin === 'Business'   ? '2 × 32 kg checked + 18 kg cabin'
                    : flight.cabin === 'First'      ? '3 × 32 kg checked + 18 kg cabin'
                    :                                 '2 × 23 kg checked + 10 kg cabin',
  };

  BOOKINGS_DB.push(booking);
  console.log(`✅ New booking: ${pnr} — ${firstName} ${lastName} — ${flight.from} → ${flight.to}`);

  // Simulate processing time
  setTimeout(() => res.status(201).json(booking), randomInt(800, 1600));
});

/* ── ROUTE: GET /api/book/:pnr ───────────────────────────────────────
   Retrieves a booking from BOOKINGS_DB by PNR.
   Falls back to a realistic mock booking for demo/testing.
   ─────────────────────────────────────────────────────────────────── */
app.get('/api/book/:pnr', (req, res) => {
  const pnr = req.params.pnr.toUpperCase();

  // First: look in the real in-memory DB (bookings made this session)
  const real = BOOKINGS_DB.find(b => b.pnr === pnr);
  if (real) {
    return setTimeout(() => res.json(real), randomInt(300, 600));
  }

  // Fallback: demo booking for testing (accepts any AN-XXXXXX format)
  if (/^AN-[A-Z0-9]{6}$/.test(pnr) || pnr === 'AN-859204') {
    const demo = {
      pnr,
      status:    'Confirmed',
      ticketType:'E-Ticket',
      issuedAt:  new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
      baggageAllowance: '1 × 23 kg checked + 7 kg cabin',
      totalPrice: 874,
      passenger: {
        firstName:   'JAMES',
        lastName:    'MITCHELL',
        passport:    'GB4829105',
        nationality: 'United Kingdom',
      },
      flight: {
        id:          'AN 2847',
        flightId:    'AN 2847',
        airline:     'AeroNexus',
        alCode:      'AN',
        alColor:     '#0C2340',
        from:        'LHR',
        fromCity:    'London',
        fromCountry: 'United Kingdom',
        to:          'CMB',
        toCity:      'Colombo',
        toCountry:   'Sri Lanka',
        dep:         '22:15',
        arr:         '10:45',
        dur:         '10h 30m',
        durMin:      630,
        stops:       0,
        gate:        'B22',
        terminal:    'T4',
        seat:        '22A',
        cabin:       'Economy',
        aircraft:    'Boeing 787-9 Dreamliner',
        amenities:   ['Wi-Fi', 'Meal', 'USB', 'Entertainment'],
        boardingTime: '21:45',
        checkInDeadline: '20:45',
      },
    };
    return setTimeout(() => res.json(demo), randomInt(300, 600));
  }

  return res.status(404).json({ error: `Booking "${pnr}" not found. Please check the reference and try again.` });
});

/* ── ROUTE: GET /api/stats ───────────────────────────────────────── */
app.get('/api/stats', (req, res) => {
  res.json({
    totalAirports: ALL_AIRPORTS.length,
    totalAirlines: AIRLINES.length,
    totalBookings: BOOKINGS_DB.length,
    serverTime:    new Date().toISOString(),
    version:       '3.1.0',
  });
});


/* ── START ───────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║       AeroNexus Mock API Server v3                ║');
  console.log(`║   Running on  http://localhost:${PORT}                 ║`);
  console.log('║                                                   ║');
  console.log(`║   ✈  ${ALL_AIRPORTS.length} airports  |  🛫 ${AIRLINES.length} airlines            ║`);
  console.log('║                                                   ║');
  console.log('║  Booking Endpoints:                               ║');
  console.log('║   GET  /api/visa-check?nationality=India&...      ║');
  console.log('║   POST /api/book                                  ║');
  console.log('║   GET  /api/flights/search?from=CMB&to=LHR        ║');
  console.log('║   GET  /api/airports?q=colombo                    ║');
  console.log('║   GET  /api/weather/CMB                           ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
});
