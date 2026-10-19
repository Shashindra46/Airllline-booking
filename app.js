'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AERONEXUS — APPLICATION CORE
   Corporate airline booking platform (API Integrated)
   ═══════════════════════════════════════════════════════════════════ */

const API_BASE = 'http://localhost:3000/api';

/* ── APP STATE ───────────────────────────────────────────────────── */
const STATE = {
  airports: [],
  airlines: [],
  departures: [],
  from: null,
  to: null,
  tripType: 'round',
  adults: 1, children: 0, infants: 0,
  cabin: 'Economy',
  airline: '',
  flights: [],
  depBoardTimer: null,
  gateChangeTimer: null,
  mapPollTimer: null,
  flightMap: null,
  mapMarker: null,
  radarPollTimer: null,
  radarMap: null,
  radarMarkers: {},
};

/* ── HELPERS ─────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function toast(title, msg, type='info'){
  const r = $('toastRegion');
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<div class="toast__body"><div class="toast__title">${title}</div><div class="toast__msg">${msg}</div></div>`;
  r.appendChild(t);
  setTimeout(()=>{t.style.animation='toastOut .25s ease forwards';setTimeout(()=>t.remove(),250)},4200);
}

function dateFmt(str){
  if(!str)return'';
  const d=new Date(str);
  return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}
function dowStr(str){
  if(!str)return'';
  return['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(str).getDay()];
}
function minsToHM(m){return`${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`}
function pad2(n){return String(n).padStart(2,'0')}

/* ── INITIAL DATA FETCH ──────────────────────────────────────────── */
async function fetchInitialData() {
  try {
    const [apRes, alRes] = await Promise.all([
      fetch(`${API_BASE}/airports`),
      fetch(`${API_BASE}/airlines`)
    ]);
    STATE.airports = await apRes.json();
    STATE.airlines = await alRes.json();
    
    // Set defaults
    if (STATE.airports.length > 0) {
      STATE.from = STATE.airports[0];
      STATE.to = STATE.airports[1] || STATE.airports[0];
      
      setupAutocomplete('fromCity','fromAC','fromCode','fromDetail','from');
      setupAutocomplete('toCity','toAC','toCode','toDetail','to');
    }
  } catch (e) {
    console.error('API Error:', e);
    toast('API Error', 'Could not connect to backend server. Please run node server.js', 'error');
  }
}

/* ── NAVIGATION ──────────────────────────────────────────────────── */
function showView(name){
  $$('.view').forEach(v=>{v.hidden=true;v.classList.remove('view--active')});
  $$('.pnav__link').forEach(l=>l.classList.remove('active'));
  const v=document.getElementById(`view-${name}`);
  if(v){v.hidden=false;v.classList.add('view--active')}
  const link=document.querySelector(`.pnav__link[data-view="${name}"]`);
  if(link)link.classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});

  if (name !== 'dashboard') {
    if (STATE.mapPollTimer) { clearInterval(STATE.mapPollTimer); STATE.mapPollTimer = null; }
    if (STATE.flightMap) { STATE.flightMap.remove(); STATE.flightMap = null; STATE.mapMarker = null; }
  }
  
  if (name !== 'radar') {
    if (STATE.radarPollTimer) { clearInterval(STATE.radarPollTimer); STATE.radarPollTimer = null; }
    if (STATE.radarMap) { STATE.radarMap.remove(); STATE.radarMap = null; STATE.radarMarkers = {}; }
  } else {
    // If switching to radar, init map after DOM layout
    setTimeout(initPublicRadar, 50);
  }
}

function initNav(){
  $$('.pnav__link[data-view]').forEach(l=>{
    l.addEventListener('click',e=>{e.preventDefault();showView(l.dataset.view)});
  });
  $$('.mobile-drawer__link[data-view]').forEach(l=>{
    l.addEventListener('click',e=>{
      e.preventDefault();
      closeMobileDrawer();
      showView(l.dataset.view);
    });
  });
  $('logoBtn')?.addEventListener('click',()=>showView('search'));
  $('hdrLiveRadar')?.addEventListener('click',()=>showView('radar'));

  // Hamburger
  $('hamburger')?.addEventListener('click',openMobileDrawer);
  $('drawerClose')?.addEventListener('click',closeMobileDrawer);
  $('drawerBackdrop')?.addEventListener('click',closeMobileDrawer);

  window.addEventListener('scroll',()=>{
    $('siteHeader')?.classList.toggle('site-header--scrolled',window.scrollY>8);
  },{passive:true});
}

function openMobileDrawer(){
  $('mobileDrawer')?.classList.add('open');
  $('drawerBackdrop').style.opacity='1';
  $('drawerBackdrop').style.pointerEvents='all';
}
function closeMobileDrawer(){
  $('mobileDrawer')?.classList.remove('open');
  $('drawerBackdrop').style.opacity='0';
  $('drawerBackdrop').style.pointerEvents='none';
}

/* ── AUTOCOMPLETE ENGINE ─────────────────────────────────────────── */
async function searchAirports(q){
  try {
    const res = await fetch(`${API_BASE}/airports?q=${encodeURIComponent(q)}`);
    return await res.json();
  } catch(e) {
    return [];
  }
}

function buildAcItem(ap, q){
  const lq=q.toLowerCase();
  const isCountryMatch=ap.country.toLowerCase().includes(lq)&&!ap.city.toLowerCase().includes(lq)&&!ap.c.toLowerCase().includes(lq);
  const item=document.createElement('div');
  item.className='ac-item';
  item.setAttribute('role','option');
  item.innerHTML=`
    <div class="ac-item__code">${ap.c}</div>
    <div class="ac-item__info">
      <div class="ac-item__city">${ap.city}${isCountryMatch?`<span class="ac-match-tag">${ap.country}</span>`:''}</div>
      <div class="ac-item__apt">${ap.name}</div>
    </div>
    <div class="ac-item__country">${ap.country}</div>`;
  return item;
}

function setupAutocomplete(inputId, acListId, codeId, detailId, field){
  const input=$(inputId);
  const list=$(acListId);
  const codeEl=$(codeId);
  const detailEl=$(detailId);
  let activeIdx=-1;

  function setAirport(ap){
    STATE[field]=ap;
    input.value=`${ap.city}`;
    codeEl.textContent=ap.c;
    if(detailEl)detailEl.textContent=`${ap.name} — ${ap.city}, ${ap.country}`;
    list.hidden=true;
    activeIdx=-1;
  }

  async function render(q){
    const results = await searchAirports(q);
    if(!results.length){list.hidden=true;return}
    list.innerHTML='';
    list.hidden=false;
    activeIdx=-1;
    results.slice(0,9).forEach(ap=>{
      const item=buildAcItem(ap,q);
      item.addEventListener('click',()=>setAirport(ap));
      item.addEventListener('mouseenter',()=>{
        $$(`#${acListId} .ac-item`).forEach((el,i)=>el.setAttribute('aria-selected',i===results.indexOf(ap)?'true':'false'));
        activeIdx=results.indexOf(ap);
      });
      list.appendChild(item);
    });
  }

  input.addEventListener('focus',()=>{if(input.value)render(input.value)});
  
  let debounce;
  input.addEventListener('input',()=>{
    codeEl.textContent='';
    if(detailEl)detailEl.textContent='';
    const v=input.value.trim();
    if(v.length<1){list.hidden=true;return}
    clearTimeout(debounce);
    debounce = setTimeout(() => render(v), 200);
  });
  
  input.addEventListener('keydown', async e=>{
    const items=[...$$(`.ac-list#${acListId} .ac-item`)];
    if(!items.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();activeIdx=Math.min(activeIdx+1,items.length-1);items.forEach((el,i)=>el.setAttribute('aria-selected',i===activeIdx?'true':'false'))}
    if(e.key==='ArrowUp'){e.preventDefault();activeIdx=Math.max(activeIdx-1,0);items.forEach((el,i)=>el.setAttribute('aria-selected',i===activeIdx?'true':'false'))}
    if(e.key==='Enter'&&activeIdx>=0){
      const results = await searchAirports(input.value);
      if(results[activeIdx])setAirport(results[activeIdx]);
    }
    if(e.key==='Escape')list.hidden=true;
  });
  document.addEventListener('click',e=>{
    if(!input.contains(e.target)&&!list.contains(e.target))list.hidden=true;
  });

  if(STATE[field]) setAirport(STATE[field]);
}

/* ── TRIP TABS ───────────────────────────────────────────────────── */
function initTripTabs(){
  $$('.trip-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('.trip-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      STATE.tripType=btn.dataset.trip;
      const rw=$('retDateWrap');
      if(rw)rw.style.opacity=STATE.tripType==='one'?'0.4':'1';
    });
  });
}

/* ── DATES ───────────────────────────────────────────────────────── */
function initDates(){
  const today=new Date();
  const dep=new Date(today);dep.setDate(today.getDate()+14);
  const ret=new Date(dep);ret.setDate(dep.getDate()+7);
  const fmt=d=>d.toISOString().split('T')[0];

  $('depDate').value=fmt(dep);
  $('retDate').value=fmt(ret);
  $('statusDate').value=fmt(today);

  const updateHint=(id,hintId)=>{
    const el=$(id);
    const hint=$(hintId);
    if(el&&hint)hint.textContent=el.value?dowStr(el.value):'';
    el?.addEventListener('change',()=>{if(hint)hint.textContent=el.value?dowStr(el.value):''});
  };
  updateHint('depDate','depDow');
  updateHint('retDate','retDow');
}

/* ── PASSENGERS & CABIN ──────────────────────────────────────────── */
function initPassengers(){
  const trigger=$('paxTrigger');
  const panel=$('paxPanel');

  trigger?.addEventListener('click',e=>{
    e.stopPropagation();
    const open=!panel.hidden;
    panel.hidden=open;
    trigger.setAttribute('aria-expanded',!open);
  });

  $$('.pax-dec,.pax-inc').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const type=btn.dataset.type;
      const isInc=btn.classList.contains('pax-inc');
      const min=type==='adults'?1:0;
      STATE[type]=Math.max(min,Math.min(9,STATE[type]+(isInc?1:-1)));
      const n=$(`${type}N`);
      if(n)n.textContent=STATE[type];
      updatePaxLabel();
    });
  });

  $$('.cabin-opt').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('.cabin-opt').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      STATE.cabin=btn.dataset.cabin;
      updatePaxLabel();
    });
  });

  $('paxDone')?.addEventListener('click',()=>{panel.hidden=true});

  document.addEventListener('click',e=>{
    if(!trigger?.contains(e.target)&&!panel?.contains(e.target))panel.hidden=true;
  });
}

function updatePaxLabel(){
  const total=STATE.adults+STATE.children+STATE.infants;
  const lbl=$('paxLabel');
  if(lbl)lbl.textContent=`${total} ${total===1?'Passenger':'Passengers'} · ${STATE.cabin}`;
}

/* ── AIRLINE SELECT ──────────────────────────────────────────────── */
function initAirlineSelect(){
  $('airlineSel')?.addEventListener('change',e=>{STATE.airline=e.target.value});
}

/* ── SEARCH ──────────────────────────────────────────────────────── */
function initSearch(){
  $('searchSubmit')?.addEventListener('click', doSearch);

  // Price slider — label update + live filter
  $('priceRange')?.addEventListener('input', e => {
    const pv = $('priceVal');
    if (pv) pv.textContent = `$${parseInt(e.target.value).toLocaleString()}`;
    applyFilters();
  });

  // Departure time buttons
  $$('.time-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.time-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  // Stops checkboxes — "All" is mutually exclusive with the others
  $('fAll')?.addEventListener('change', e => {
    if (e.target.checked) {
      const fNon = $('fNon'); if (fNon) fNon.checked = false;
      const fOne = $('fOne'); if (fOne) fOne.checked = false;
    }
    applyFilters();
  });
  ['fNon','fOne'].forEach(id => {
    $(id)?.addEventListener('change', e => {
      if (e.target.checked) {
        const fAll = $('fAll'); if (fAll) fAll.checked = false;
      }
      applyFilters();
    });
  });

  // Sort dropdown
  $('sortBy')?.addEventListener('change', applyFilters);
}


async function doSearch(){
  if(!STATE.from || !STATE.to) {
    toast('Error', 'Please select both departure and arrival airports.', 'error');
    return;
  }

  const btn=$('searchSubmit');
  const origHTML=btn.innerHTML;
  btn.innerHTML='<div class="spinner"></div> Searching...';
  btn.disabled=true;

  // Reset sidebar filters to defaults before a new search
  resetFilters();

  try {
    const url = new URL(`${API_BASE}/flights/search`);
    url.searchParams.append('from',   STATE.from.c);
    url.searchParams.append('to',     STATE.to.c);
    url.searchParams.append('cabin',  STATE.cabin);
    // Pass the selected airline so the server guarantees a result for it
    if (STATE.airline) url.searchParams.append('airline', STATE.airline);

    const res = await fetch(url);
    if (!res.ok) throw new Error('API Error');
    STATE.flights = await res.json();

    // Update price slider max to highest fare in results
    const maxFare = Math.max(...STATE.flights.map(f => f.price));
    const slider  = $('priceRange');
    if (slider) {
      slider.max   = Math.ceil(maxFare / 100) * 100 + 200;
      slider.value = slider.max;
      const pv = $('priceVal');
      if (pv) pv.textContent = `$${parseInt(slider.value).toLocaleString()}`;
    }

    renderAirlineFilters();  // build checkboxes BEFORE first render
    applyFilters();           // render with all filters applied

    const sec=$('resultsSection');
    if(sec){sec.hidden=false;sec.scrollIntoView({behavior:'smooth',block:'start'})}
    toast('Search complete', `${STATE.flights.length} flights found for ${STATE.from.c} → ${STATE.to.c}`, 'success');
  } catch(e) {
    toast('Search Failed', 'Could not fetch flights from the server.', 'error');
  } finally {
    btn.innerHTML=origHTML;
    btn.disabled=false;
  }
}

/**
 * applyFilters() — the single source of truth for what is displayed.
 * Reads all sidebar controls and re-renders the flight list.
 */
function applyFilters(){
  if (!STATE.flights.length) return;

  let filtered = [...STATE.flights];

  // 1. Price filter
  const slider    = $('priceRange');
  const maxPrice  = slider ? parseInt(slider.value) : Infinity;
  filtered = filtered.filter(f => f.price <= maxPrice);

  // 2. Stops filter
  const fAll = $('fAll');
  const fNon = $('fNon');
  const fOne = $('fOne');
  // Only apply stops filter when "All" is NOT checked
  if (fAll && !fAll.checked) {
    const allowNonStop = fNon?.checked;
    const allowOneStop = fOne?.checked;
    filtered = filtered.filter(f => {
      if (allowNonStop && f.stops === 0) return true;
      if (allowOneStop && f.stops <= 1) return true;
      return false;
    });
  }

  // 3. Departure time filter
  const activeTimBtn = document.querySelector('.time-filter-btn.active');
  const tf = activeTimBtn?.dataset?.tf || 'all';
  if (tf !== 'all') {
    const ranges = {
      early:    [0,   6],
      morning:  [6,  12],
      afternoon:[12, 18],
      evening:  [18, 24],
    };
    const [lo, hi] = ranges[tf] || [0, 24];
    filtered = filtered.filter(f => {
      const h = parseInt(f.dep.split(':')[0], 10);
      return h >= lo && h < hi;
    });
  }

  // 4. Airline checkboxes (generated dynamically by renderAirlineFilters)
  const airlineCheckboxes = $$('#airlineFiltersBox input[type="checkbox"]');
  if (airlineCheckboxes.length) {
    const checked = new Set(
      [...airlineCheckboxes]
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.airline)
    );
    if (checked.size < airlineCheckboxes.length) {
      // Only filter if at least one airline is UNCHECKED
      filtered = filtered.filter(f => checked.has(f.airline));
    }
  }

  // 5. Sort
  const sortVal = $('sortBy')?.value || 'price';
  filtered.sort((a, b) => {
    if (sortVal === 'price') return a.price - b.price;
    if (sortVal === 'dur')   return a.durMin - b.durMin;
    if (sortVal === 'dep')   return a.dep.localeCompare(b.dep);
    if (sortVal === 'arr')   return a.arr.localeCompare(b.arr);
    return 0;
  });

  renderFlights(filtered, STATE.flights.length);
}

function resetFilters(){
  // Reset price slider
  const slider = $('priceRange');
  if (slider) { slider.value = slider.max; }
  const pv = $('priceVal');
  if (pv) pv.textContent = '$8,000';

  // Reset stops to "All"
  const fAll = $('fAll'); if (fAll) fAll.checked = true;
  const fNon = $('fNon'); if (fNon) fNon.checked = false;
  const fOne = $('fOne'); if (fOne) fOne.checked = false;

  // Reset departure time to "Any"
  $$('.time-filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.time-filter-btn[data-tf="all"]')?.classList.add('active');

  // Sort back to price
  const sortEl = $('sortBy');
  if (sortEl) sortEl.value = 'price';
}

function renderFlights(flights, totalCount = flights.length){
  // Update heading
  $('resultsHeading').textContent = `Flights: ${STATE.from?.c} → ${STATE.to?.c}`;
  const pax = STATE.adults + STATE.children + STATE.infants;
  $('resultsSub').textContent    =
    `${flights.length} of ${totalCount} shown · ${pax} passenger(s) · ${STATE.cabin}`;

  const list = $('flightList');
  if (!list) return;

  if (!flights.length) {
    list.innerHTML = `
      <div class="no-results">
        <div class="no-results__icon">✈️</div>
        <h3>No flights match your filters</h3>
        <p>Try adjusting the price range, stops, or departure time filters.</p>
        <button class="btn btn--outline btn--sm" onclick="resetFilters();applyFilters();">Clear All Filters</button>
      </div>`;
    return;
  }

  list.innerHTML = flights.map(f => `
    <div class="flight-card" id="fc-${f.id}" onclick="AN.selectFlight(${f.id})">
      ${f.badge ? `<div class="fc-badge ${f.badge==='Best Value'||f.badge===STATE.flights[0]?.airline ? 'fc-badge--value' : 'fc-badge--fast'}">
        ${f.badge === 'Best Value' || f.badge === STATE.flights[0]?.airline ? '⭐ ' + f.badge : '⚡ Fastest'}</div>` : ''}
      <div class="flight-card__inner">
        <div class="fc-airline">
          <div class="fc-logo" style="background:${f.alColor}">${f.alCode}</div>
          <div class="fc-airline-name">${f.airline}</div>
          <div class="fc-flight-id">${f.flightId} · ${f.aircraft}</div>
        </div>
        <div class="fc-route">
          <div class="fc-point">
            <div class="fc-time">${f.dep}</div>
            <div class="fc-code">${f.from}</div>
          </div>
          <div class="fc-mid">
            <div class="fc-dur">${f.dur}</div>
            <div class="fc-bar"><div class="fc-plane">✈</div></div>
            <div class="fc-stops${f.stops===0?' fc-stops--nonstop':''}">
              ${f.stops===0 ? '✓ Non-stop' : f.stops===1 ? '1 stop' : '2 stops'}
            </div>
          </div>
          <div class="fc-point">
            <div class="fc-time">${f.arr}</div>
            <div class="fc-code">${f.to}</div>
          </div>
        </div>
        <div class="fc-price-col">
          <div class="fc-price">$${f.price.toLocaleString()}</div>
          <div class="fc-price-note">per person</div>
          <div class="fc-tags">${(f.amenities || []).slice(0,3).map(a=>`<span class="fc-tag">${a}</span>`).join('')}</div>
          <button class="btn btn--primary btn--sm" onclick="event.stopPropagation();AN.selectFlight(${f.id})">Select →</button>
        </div>
      </div>
    </div>`).join('');
}

function renderAirlineFilters(){
  const box = $('airlineFiltersBox');
  if (!box) return;

  const names = [...new Set(STATE.flights.map(f => f.airline))];

  box.innerHTML = names.map(name => `
    <label class="fc-check">
      <input type="checkbox" checked data-airline="${name}"/>
      ${name}
    </label>`).join('');

  // Attach live change listeners to each new checkbox
  $$('#airlineFiltersBox input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', applyFilters);
  });
}


/* ── MANAGE BOOKING ──────────────────────────────────────────────── */
function initManageBooking(){
  $('findBtn')?.addEventListener('click',findBooking);
  $('demoBtn')?.addEventListener('click',()=>{
    const ri=$('refInput');const li=$('lnInput');
    if(ri)ri.value='AN-859204';
    if(li)li.value='Doe';
    findBooking();
  });

  // Quick actions
  $('aBoardingPass')?.addEventListener('click',openBP);
  $('aCheckin')?.addEventListener('click',()=>toast('Check-In Complete','You are now checked in. Your boarding pass is ready.','success'));
  $('aSeat')?.addEventListener('click',()=>toast('Seat Change','Seat map will open in the seat selection portal.','info'));
  $('aBaggage')?.addEventListener('click',()=>toast('Baggage Added','+23 kg checked baggage added. Charge: $0 (Elite benefit).','success'));
  $('aMeal')?.addEventListener('click',()=>toast('Meal Preference','Vegetarian meal preference saved for all segments.','info'));
  $('aCancel')?.addEventListener('click',()=>{
    if(confirm('Are you sure you want to cancel booking AN-859204? This action cannot be undone.'))
      toast('Cancellation Requested','Your request is being processed. Refund within 5–7 business days.','warn');
  });

  $('dcDismiss')?.addEventListener('click',()=>{
    $('disruptionCard').style.transition='opacity .3s ease';
    $('disruptionCard').style.opacity='0';
    setTimeout(()=>$('disruptionCard').style.display='none',300);
  });

  $$('[data-rb]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const rb=btn.dataset.rb;
      $$('.rebook-option').forEach(o=>o.style.opacity='.5');
      $$('[data-rb]').forEach(b=>{b.textContent='Select';b.className='btn btn--outline btn--sm'});
      const opt=$(`rbOpt${rb}`);
      if(opt)opt.style.opacity='1';
      btn.textContent='✓ Selected';
      btn.className='btn btn--primary btn--sm';
      const names={1:'KL 1013 at 17:15 → LHR 18:25',2:'BA 0432 at 19:45 → LHR 20:55',3:'AN 3302 at 21:30 → LHR 22:40'};
      toast('Rebooking Confirmed',`You are now rebooked on ${names[rb]}. Confirmation sent to your email.`,'success');
    });
  });

  $('dlVoucher')?.addEventListener('click',()=>toast('Voucher Downloaded','Hotel voucher HV-AMS-72941 saved to your downloads.','success'));
  $('mapHotel')?.addEventListener('click',()=>toast('Hotel Location','Hilton Amsterdam Airport Schiphol — Connected walkway from Terminal B.','info'));
}

async function findBooking(){
  const ref=$('refInput')?.value?.trim();
  const ln=$('lnInput')?.value?.trim();
  if(!ref||!ln){toast('Missing Fields','Please enter your booking reference and last name.','error');return}

  const btn=$('findBtn');
  const orig=btn.textContent;
  btn.innerHTML='<div class="spinner"></div> Searching...';
  btn.disabled=true;

  try {
    const res = await fetch(`${API_BASE}/booking/${ref}?ln=${ln}`);
    const data = await res.json();

    $('lookupBlock').style.display='none';
    $('bookingDashboard').hidden=false;

    if(data.hasLayover){
      $('layoverStrip').hidden=false;
      $('seg2').hidden=false;
      $('layoverTimeRow').hidden=false;
      $('itinBadge').textContent='Outbound · 2 Segments · 1 Stop';
      $('totalJourney').textContent='10h 45m';
      if($('s1ArrCode'))$('s1ArrCode').textContent='AMS';
      if($('s1ArrApt'))$('s1ArrApt').textContent='Amsterdam Schiphol Airport';
      if($('s1ArrCity'))$('s1ArrCity').textContent='Amsterdam, Netherlands';
    }

    startCountdowns();
    scheduleGateChange();
    toast('Booking Found',`Showing itinerary for ${data.ref}`,'success');
  } catch(e) {
    toast('Lookup Failed', 'Could not retrieve booking from server.', 'error');
  } finally {
    btn.textContent=orig;btn.disabled=false;
  }
}

function startCountdowns(){
  let ciMins=78,gateMins=108;
  const ciEl=$('ciCountdown'),gateEl=$('gateCountdown');
  const tick=()=>{
    ciMins--;gateMins--;
    if(ciMins<=0){if(ciEl)ciEl.textContent='CLOSED';return}
    if(ciEl)ciEl.textContent=minsToHM(ciMins);
    if(gateEl)gateEl.textContent=minsToHM(gateMins);
  };
  if(ciEl)ciEl.textContent=minsToHM(ciMins);
  if(gateEl)gateEl.textContent=minsToHM(gateMins);
  setInterval(tick,60000);
}

function scheduleGateChange(){
  clearTimeout(STATE.gateChangeTimer);
  STATE.gateChangeTimer=setTimeout(()=>{
    const gateEl=$('s1Gate');
    const dispEl=$('gateDisplay');
    const oldGate=gateEl?.textContent||'B22';
    const newGate='C09';
    if(gateEl){gateEl.textContent=newGate;gateEl.classList.add('live-gate--changed')}
    if(dispEl){dispEl.textContent=newGate;dispEl.style.color='var(--red)'}
    const log=$('gateLog');
    if(log){
      const now=new Date();
      const t=`${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      const entry=document.createElement('div');
      entry.className='gate-log__entry gate-log__entry--change';
      entry.innerHTML=`<span class="gle-time">${t}</span><span>⟶ Changed to Gate ${newGate} (CURRENT)</span>`;
      log.appendChild(entry);
    }
    toast('⚠ Gate Change Alert',`Gate changed from ${oldGate} to ${newGate}. Terminal 4, Level 2, Pier C.`,'warn');
  },18000);
}

/* ── BOARDING PASS ───────────────────────────────────────────────── */
function openBP(){
  buildBarcode();
  $('bpModal').hidden=false;
}

function buildBarcode(){
  const bc=$('bpBarcode');
  if(!bc)return;
  bc.innerHTML=Array.from({length:88},()=>{
    const w=Math.random()<0.3?Math.floor(Math.random()*3)+1:2;
    const dark=Math.random()>.38;
    return `<div style="width:${w}px;flex-shrink:0;background:${dark?'#0C2340':'transparent'};height:100%"></div>`;
  }).join('');
}

function initBoardingPass(){
  $('closeBpModal')?.addEventListener('click',()=>{$('bpModal').hidden=true});
  $('bpModal')?.addEventListener('click',e=>{if(e.target===$('bpModal'))$('bpModal').hidden=true});
  $('dlBP')?.addEventListener('click',()=>toast('Downloaded','Boarding pass PDF saved to your downloads.','success'));
  $('walletBP')?.addEventListener('click',()=>toast('Added to Wallet','Boarding pass added to Apple Wallet / Google Pay.','success'));
}

/* ── FLIGHT STATUS ───────────────────────────────────────────────── */
function initFlightStatus(){
  $('trackBtn')?.addEventListener('click',trackFlight);
}

function trackFlight(){
  const btn=$('trackBtn');
  btn.innerHTML='<div class="spinner" style="border-top-color:white"></div> Tracking...';
  btn.disabled=true;
  setTimeout(()=>{
    btn.textContent='Track Flight';btn.disabled=false;
    $('statusResults').hidden=false;
    let pct=36;
    const fill=$('ptFill'),plane=$('ptPlane');
    const anim=setInterval(()=>{
      pct=Math.min(pct+.5,42);
      if(fill)fill.style.width=pct+'%';
      if(plane)plane.style.left=pct+'%';
      if(pct>=42)clearInterval(anim);
    },40);
    fetchDepartures();
    startDepBoardUpdates();
    toast('Flight Tracked','Now monitoring AN 2847 in real-time.','success');
  },1300);
}

async function fetchDepartures() {
  try {
    const res = await fetch(`${API_BASE}/departures`);
    STATE.departures = await res.json();
    renderDepBoard();
  } catch(e) {
    console.error('Failed to fetch departures');
  }
}

function renderDepBoard(){
  const body=$('depBoardBody');
  if(!body)return;
  const labels={
    'on-time':'On Time','boarding':'Boarding','delayed':'Delayed','departed':'Departed'
  };
  body.innerHTML=STATE.departures.map(d=>`
    <div class="dep-row">
      <span class="dep-flight">${d.f}</span>
      <span>${d.dest}</span>
      <span>${d.time}</span>
      <span><span class="dep-chip dep-chip--${d.status}">${labels[d.status]||d.status}</span></span>
      <span>${d.gate}</span>
    </div>`).join('');
}

function startDepBoardUpdates(){
  clearInterval(STATE.depBoardTimer);
  STATE.depBoardTimer=setInterval(fetchDepartures, 9000);
}

/* ── CHECK-IN ────────────────────────────────────────────────────── */
function initCheckin(){
  $('startCiBtn')?.addEventListener('click',()=>{
    const ref=$('ciRef')?.value?.trim();
    const ln=$('ciLn')?.value?.trim();
    if(!ref||!ln){toast('Required','Please enter your booking reference and last name.','error');return}
    const btn=$('startCiBtn');
    btn.innerHTML='<div class="spinner"></div> Checking you in...';
    btn.disabled=true;
    setTimeout(()=>{
      btn.textContent='Begin Check-In';btn.disabled=false;
      toast('Check-In Successful!','You are now checked in for flight AN 2847. Boarding pass generated.','success');
      setTimeout(openBP,800);
    },1400);
  });
}

/* ── GLOBAL HELPERS ──────────────────────────────────────────────── */
const AN={

  selectFlight(id){
    const f = STATE.flights.find(f => f.id === id);
    if (!f) return;
    STATE.selectedFlight = f;

    // Hide results, show booking flow
    const rs = $('resultsSection');
    if (rs) rs.hidden = true;
    const bf = $('bookingFlow');
    if (bf) { bf.hidden = false; bf.scrollIntoView({ behavior:'smooth', block:'start' }); }

    // Reset form
    const form = $('passengerForm');
    if (form) form.reset();
    $('visaPanel').hidden = true;

    // Populate flight summary
    const al = f.alCode || 'AN';
    const logoEl = $('bfAlLogo');
    if (logoEl) { logoEl.textContent = al; logoEl.style.background = f.alColor || 'var(--navy)'; }
    setText('bfAlName',    f.airline);
    setText('bfFlightId',  f.flightId);
    setText('bfAircraft',  f.aircraft);
    setText('bfDep',       f.dep);
    setText('bfArr',       f.arr);
    setText('bfFrom',      f.from);
    setText('bfTo',        f.to);
    setText('bfFromCity',  f.fromCity || '');
    setText('bfToCity',    f.toCity   || '');
    setText('bfDur',       f.dur);
    setText('bfStops',     f.stops === 0 ? '✓ Non-stop' : f.stops === 1 ? '1 stop' : '2 stops');
    setText('bfCabinBadge', f.cabin);

    const amenEl = $('bfAmenities');
    if (amenEl && f.amenities) {
      amenEl.innerHTML = f.amenities.map(a => `<span class="bff-tag">✓ ${a}</span>`).join('');
    }

    // Populate price summary
    const pax   = STATE.adults + STATE.children + STATE.infants;
    const taxes = Math.round(f.price * pax * 0.18);
    const total = f.price * pax + taxes;
    setText('bfPaxCount',  `(${pax} passenger${pax > 1 ? 's' : ''})`);
    setText('bfBasePrice', `$${(f.price * pax).toLocaleString()}`);
    setText('bfTaxes',     `$${taxes.toLocaleString()}`);
    setText('bfTotal',     `$${total.toLocaleString()}`);
    STATE.bookingTotal = total;
  },

  printPage:    () => window.print(),
  downloadPDF:  () => toast('Downloaded','Itinerary PDF saved to your downloads.','success'),
  emailDoc:     () => toast('Email Sent','Itinerary sent to your registered email address.','success'),
};

function setText(id, val) { const el = $(id); if (el) el.textContent = val || ''; }

/* ── BOOKING FLOW ────────────────────────────────────────────────── */
function initBookingFlow(){

  // Back to results
  $('bfBackBtn')?.addEventListener('click', () => {
    $('bookingFlow').hidden = true;
    const rs = $('resultsSection');
    if (rs) { rs.hidden = false; rs.scrollIntoView({ behavior:'smooth' }); }
  });

  // Nationality change → trigger visa check
  $('pfNationality')?.addEventListener('change', e => {
    const nationality = e.target.value;
    const toCountry   = STATE.selectedFlight?.toCountry || '';
    if (nationality && toCountry) doVisaCheck(nationality, toCountry);
  });

  // Confirm button
  $('bfConfirmBtn')?.addEventListener('click', doConfirmBooking);

  // PNR action buttons
  $('pnrViewTrip')?.addEventListener('click', () => {
    $('pnrConfirmation').hidden = true;
    showView('manage');
  });
  $('pnrNewSearch')?.addEventListener('click', () => {
    $('pnrConfirmation').hidden = true;
    $('bookingFlow').hidden     = true;
    const rs = $('resultsSection');
    if (rs) rs.hidden = true;
    window.scrollTo({ top:0, behavior:'smooth' });
  });
}

/* ── VISA CHECK ──────────────────────────────────────────────────── */
async function doVisaCheck(nationality, destinationCountry){
  const panel    = $('visaPanel');
  const checking = $('visaChecking');
  const result   = $('visaResult');

  panel.hidden    = false;
  checking.hidden = false;
  result.hidden   = true;

  try {
    const url = new URL(`${API_BASE}/visa-check`);
    url.searchParams.append('nationality',        nationality);
    url.searchParams.append('destinationCountry', destinationCountry);

    const res  = await fetch(url);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    checking.hidden = true;
    result.hidden   = false;

    // Style the badge
    const badge    = $('visaBadge');
    const colorMap = { 'visa-free':'green', 'evisa':'amber', 'visa-required':'red' };
    const icons    = { 'visa-free':'✓', 'evisa':'⚠', 'visa-required':'⛔' };
    badge.className = `visa-badge visa-badge--${colorMap[data.status] || 'amber'}`;
    setText('visaBadgeIcon',  icons[data.status] || '•');
    setText('visaBadgeLabel', data.label);
    setText('visaNotes',      data.notes);
    setText('visaTime',       data.processingTime);
    setText('visaFee',        data.fee);
    setText('visaStay',       data.allowedStay);

    const reqList = $('visaReqList');
    if (reqList && Array.isArray(data.requirements)) {
      reqList.innerHTML = data.requirements
        .map(r => `<li>${r}</li>`)
        .join('');
    }
  } catch(e) {
    checking.hidden = true;
    panel.hidden    = true;
    toast('Visa Check','Could not retrieve visa data. Please check manually.','warn');
  }
}

/* ── CONFIRM BOOKING ─────────────────────────────────────────────── */
async function doConfirmBooking(){
  const errors = validatePassengerForm();
  if (errors.length) {
    toast('Form Incomplete', errors[0], 'error');
    return;
  }

  const f          = STATE.selectedFlight;
  const firstName  = $('pfFirstName').value.trim();
  const lastName   = $('pfLastName').value.trim();
  const passport   = $('pfPassport').value.trim();
  const nationality = $('pfNationality').value;

  const btn = $('bfConfirmBtn');
  const orig = btn.innerHTML;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;border-top-color:#fff"></div> Processing…';
  btn.disabled  = true;

  try {
    const res = await fetch(`${API_BASE}/book`, {
      method:  'POST',
      headers: { 'Content-Type':'application/json' },
      body:    JSON.stringify({
        flight:     f,
        passenger:  { firstName, lastName, passport, nationality },
        totalPrice: STATE.bookingTotal,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Booking failed');
    }

    const booking = await res.json();
    showPNRConfirmation(booking);

  } catch(e) {
    toast('Booking Error', e.message || 'Could not complete booking. Please try again.', 'error');
    btn.innerHTML = orig;
    btn.disabled  = false;
  }
}

function validatePassengerForm(){
  const errors = [];
  const firstName  = $('pfFirstName').value.trim();
  const lastName   = $('pfLastName').value.trim();
  const passport   = $('pfPassport').value.trim();
  const nationality = $('pfNationality').value;

  const setErr = (id, msg) => {
    const el = $(id); if (el) el.textContent = msg;
  };
  // Clear all errors
  ['pfFirstNameErr','pfLastNameErr','pfPassportErr','pfNatErr'].forEach(id => setErr(id,''));

  if (!firstName) { errors.push('First name is required.'); setErr('pfFirstNameErr','Required'); }
  if (!lastName)  { errors.push('Last name is required.');  setErr('pfLastNameErr','Required'); }
  if (passport.length < 6) { errors.push('Passport number must be at least 6 characters.'); setErr('pfPassportErr','Min. 6 characters'); }
  if (!/^[A-Za-z0-9]+$/.test(passport) && passport.length > 0) { errors.push('Passport may only contain letters and numbers.'); setErr('pfPassportErr','Letters & numbers only'); }
  if (!nationality) { errors.push('Nationality is required.'); setErr('pfNatErr','Please select your nationality'); }

  return errors;
}

/* ── PNR CONFIRMATION ────────────────────────────────────────────── */
function showPNRConfirmation(booking){
  $('bookingFlow').hidden     = true;
  const conf = $('pnrConfirmation');
  conf.hidden = false;
  conf.scrollIntoView({ behavior:'smooth', block:'start' });

  setText('pnrCode',      booking.pnr);
  setText('pnrPassenger', `${booking.passenger.firstName} ${booking.passenger.lastName}`);
  setText('pnrRoute',     `${booking.flight?.from || '—'} → ${booking.flight?.to || '—'}`);
  setText('pnrDep',       booking.flight?.dep || '—');
  setText('pnrArr',       booking.flight?.arr || '—');
  setText('pnrCabin',     booking.flight?.cabin || STATE.cabin);
  setText('pnrBaggage',   booking.baggageAllowance || '—');
  setText('pnrPrice',     `$${Number(booking.totalPrice).toLocaleString()}`);

  toast('✓ Booking Confirmed!', `Your PNR is ${booking.pnr}. E-ticket sent to your email.`, 'success');
}

/* ── PNR MODAL ────────────────────────────────────────────────────── */
function initPnrModal(){
  const modal    = $('pnrModal');
  const input    = $('pnrInput');
  const lookupBtn= $('pnrLookupBtn');
  const demoBtn  = $('pnrDemoBtn');
  const closeBtn = $('pnrModalClose');
  const errBox   = $('pnrModalError');
  const errMsg   = $('pnrModalErrorMsg');

  if (!modal) return; // guard if element missing

  /** Show modal: add .is-open class (CSS handles display:flex) */
  function openModal(){
    modal.removeAttribute('hidden');          // strip any residual hidden attribute
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden'; // prevent background scroll
    if (input)  input.value = '';
    if (errBox) errBox.hidden = true;
    setTimeout(() => input?.focus(), 80);
  }

  /** Hide modal: remove .is-open class */
  function closeModal(){
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  // Open: "Manage Booking" button in the nav header
  $('hdrManageBooking')?.addEventListener('click', e => {
    e.preventDefault();
    openModal();
  });

  // Close: ✕ button
  closeBtn?.addEventListener('click', e => {
    e.stopPropagation();
    closeModal();
  });

  // Close: click on the dark backdrop (not on the white modal card)
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  // Close: Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  // Enter key in input → trigger lookup
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });

  // Demo PNR shortcut
  demoBtn?.addEventListener('click', () => {
    if (input) input.value = 'AN-859204';
    doLookup();
  });

  lookupBtn?.addEventListener('click', doLookup);

  async function doLookup(){
    const raw = (input?.value || '').trim().toUpperCase();
    if (!raw) { showErr('Please enter a booking reference.'); return; }

    // Normalise: accept both "AN-K7PX3Q" and "ANK7PX3Q"
    const pnr = raw.includes('-') ? raw : raw.slice(0,2) + '-' + raw.slice(2);

    if (lookupBtn) lookupBtn.disabled = true;
    if (lookupBtn) lookupBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Searching…';
    if (errBox) errBox.hidden = true;

    try {
      const res = await fetch(`${API_BASE}/book/${encodeURIComponent(pnr)}`);
      if (!res.ok){
        const body = await res.json().catch(() => ({}));
        showErr(body.error || 'Booking not found. Please check the reference.');
        return;
      }
      const booking = await res.json();
      closeModal();
      loadDashboard(booking);
    } catch(e){
      showErr('Could not connect to the server. Is server.js running?');
    } finally {
      if (lookupBtn) {
        lookupBtn.disabled = false;
        lookupBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="margin-right:6px"><circle cx="6.5" cy="6.5" r="5" stroke="#fff" stroke-width="1.4"/><path d="M10 10l4 4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg> Find My Booking`;
      }
    }
  }

  function showErr(msg){
    if (errMsg) errMsg.textContent = msg;
    if (errBox) errBox.hidden = false;
  }
}


/* ── PASSENGER DASHBOARD ─────────────────────────────────────────── */
function loadDashboard(b){
  // Store booking in STATE for delay simulation
  STATE.currentBooking = b;
  STATE.delayActive    = false;

  const f  = b.flight  || {};
  const p  = b.passenger || {};

  // Hero
  setText('dbPassengerName', `${p.firstName || ''} ${p.lastName || ''}`);
  setText('dbPnrChip',       `PNR: ${b.pnr}`);
  const sc = $('dbStatusChip');
  if(sc){
    sc.textContent = b.status === 'Confirmed' ? '✓ Confirmed' : b.status;
    sc.className   = `db-status-chip db-status-chip--${b.status === 'Confirmed' ? 'confirmed' : 'delayed'}`;
  }

  // Flight itinerary
  setText('dbDepTime',    f.dep  || '—');
  setText('dbFromCode',   f.from || '—');
  setText('dbFromCity',   f.fromCity    || '—');
  setText('dbFromCountry',f.fromCountry || '—');
  setText('dbDur',        f.dur  || '—');
  setText('dbStops',      f.stops === 0 ? '✓ Non-stop' : f.stops === 1 ? '1 Stop' : `${f.stops} Stops`);
  setText('dbArrTime',    f.arr  || '—');
  setText('dbToCode',     f.to   || '—');
  setText('dbToCity',     f.toCity    || '—');
  setText('dbToCountry',  f.toCountry || '—');

  // Airline badge
  setText('dbAlLogo',     f.alCode   || (f.airline||'').slice(0,2).toUpperCase());
  setText('dbAirlineName',f.airline  || '—');
  const logo = $('dbAlLogo');
  if(logo && f.alColor) logo.style.background = f.alColor;

  // Timeline values
  setText('dbCheckinDeadline', f.checkInDeadline || derivedTime(f.dep, -90));
  setText('dbBoardingTime',    f.boardingTime    || derivedTime(f.dep, -30));
  setText('dbDepScheduled',    f.dep || '—');
  setText('dbArrScheduled',    f.arr ? f.arr + ' +1' : '—');

  // Status panel
  setText('dbGate',          f.gate     || 'TBA');
  setText('dbTerminal',      f.terminal || 'TBA');
  setText('dbStatusDepTime', f.dep || '—');
  setText('dbStatusArrTime', f.arr || '—');

  // Passenger details
  setText('dbFullName',   `${p.firstName||''} ${p.lastName||''}`);
  setText('dbNationality',p.nationality || '—');
  setText('dbPassport',   p.passport    || '—');
  setText('dbCabin',      f.cabin       || '—');
  setText('dbSeat',       f.seat        || 'Not assigned');
  setText('dbBaggage',    b.baggageAllowance || '—');
  setText('dbAircraft',   f.aircraft    || '—');
  setText('dbTotalPaid',  b.totalPrice  ? `$${Number(b.totalPrice).toLocaleString()}` : '—');

  // Reset delay state
  const delayBanner = $('delayBanner');
  const delayDetail = $('dbDelayDetail');
  const alertTips   = $('dbAlertTips');
  if(delayBanner) delayBanner.hidden = true;
  if(delayDetail) delayDetail.hidden = true;
  if(alertTips)   alertTips.hidden   = true;
  $('dbClearDelay')?.setAttribute('hidden','');
  resetFlightStatusChip();

  // Show dashboard
  showView('dashboard');

  // Wire delay buttons (do each time so refs are fresh)
  $('dbSimulateDelay')?.addEventListener('click', simulateDelay, { once: false });
  $('dbClearDelay')?.addEventListener('click', clearDelay, { once: false });
  $('delayBannerDismiss')?.addEventListener('click', ()=>{ if($('delayBanner')) $('delayBanner').hidden = true; });
  $('dbBackToSearch')?.addEventListener('click', ()=>{ showView('search'); });

  toast('Dashboard Loaded', `Booking ${b.pnr} retrieved successfully.`, 'success');

  // Initialize map
  initFlightMap(b);
}

/** Compute a time offset from a HH:MM string (e.g. -30 minutes) */
function derivedTime(hhmm, offsetMin){
  if(!hhmm || !hhmm.includes(':')) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const total  = ((h * 60 + m + offsetMin) + 1440) % 1440;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}

const DELAY_SCENARIOS = [
  { reason:'Air traffic control congestion — holding pattern required.',          min:45 },
  { reason:'Late arriving inbound aircraft from previous sector.',                min:70 },
  { reason:'Severe weather at origin airport — de-icing procedures in progress.', min:120},
  { reason:'Technical inspection required — engineering team on standby.',        min:55 },
  { reason:'Crew rest requirements per aviation regulations.',                    min:95 },
  { reason:'Ground equipment fault — refueling delay.',                           min:35 },
  { reason:'Thunderstorm activity on flight route — awaiting clearance.',         min:150},
];

function simulateDelay(){
  if(STATE.delayActive) return;
  STATE.delayActive = true;

  const scenario = DELAY_SCENARIOS[Math.floor(Math.random() * DELAY_SCENARIOS.length)];
  const f        = (STATE.currentBooking || {}).flight || {};
  const origDep  = f.dep || '22:15';
  const newDep   = derivedTime(origDep, scenario.min);
  const delayStr = `${Math.floor(scenario.min/60) > 0 ? Math.floor(scenario.min/60)+'h ' : ''}${scenario.min % 60 > 0 ? scenario.min%60+'m' : ''}`.trim() || `${scenario.min} min`;

  // Banner
  const banner = $('delayBanner');
  if(banner){ banner.hidden = false; }
  const nd = $('delayNewDep');
  if(nd) nd.textContent = newDep;

  // Status chip → delayed
  const chip = $('dbFlightStatusChip');
  if(chip){
    chip.className = 'db-flight-status-chip db-flight-status-chip--delayed';
    setText('dbFlightStatusIcon','⚠');
    setText('dbFlightStatusLabel','Delayed');
  }

  // Update departure in gate grid
  setText('dbStatusDepTime', newDep);

  // Timeline: departure row → delayed style
  const tlDep = $('tlDep');
  if(tlDep){
    tlDep.className = 'db-timeline__item db-timeline__item--delayed';
    setText('dbDepScheduled', `${newDep}  (+${delayStr})`);
  }

  // Delay detail card
  const dd = $('dbDelayDetail');
  if(dd){ dd.hidden = false; }
  setText('dbDelayReason', scenario.reason);
  setText('dbOrigDep',     origDep);
  setText('dbNewDep',      newDep);
  setText('dbDelayDur',    `+${delayStr}`);

  // Passenger rights
  const tips = $('dbAlertTips');
  if(tips) tips.hidden = false;

  // Hero status chip
  const sc = $('dbStatusChip');
  if(sc){ sc.textContent = '⚠ Delayed'; sc.className = 'db-status-chip db-status-chip--delayed'; }

  // Show Clear button
  const clr = $('dbClearDelay');
  if(clr) clr.removeAttribute('hidden');

  toast('⚠ Flight Delay Alert',
    `${f.airline || 'Your flight'} ${f.flightId || ''} delayed by ${delayStr}. New departure: ${newDep}`,
    'warn');
}

function clearDelay(){
  STATE.delayActive = false;
  const f = (STATE.currentBooking || {}).flight || {};

  // Hide banner
  const banner = $('delayBanner');
  if(banner) banner.hidden = true;

  // Reset gate dep time
  setText('dbStatusDepTime', f.dep || '—');

  // Reset status chip
  resetFlightStatusChip();

  // Reset timeline
  const tlDep = $('tlDep');
  if(tlDep){ tlDep.className = 'db-timeline__item db-timeline__item--active'; }
  setText('dbDepScheduled', f.dep || '—');

  // Hide detail & tips
  const dd = $('dbDelayDetail');  if(dd) dd.hidden = true;
  const tips = $('dbAlertTips'); if(tips) tips.hidden = true;

  // Hero chip
  const sc = $('dbStatusChip');
  if(sc){ sc.textContent = '✓ Confirmed'; sc.className = 'db-status-chip db-status-chip--confirmed'; }

  // Hide clear button
  $('dbClearDelay')?.setAttribute('hidden','');
  toast('Alert cleared','Flight status reset to On Time.','info');
}

function resetFlightStatusChip(){
  const chip = $('dbFlightStatusChip');
  if(chip){
    chip.className = 'db-flight-status-chip db-flight-status-chip--ontime';
    setText('dbFlightStatusIcon','✓');
    setText('dbFlightStatusLabel','On Time');
  }
}

/* helper: safely set element text */
function setText(id, val){
  const el = $(id);
  if(el) el.textContent = val ?? '—';
}

/* ── LIVE FLIGHT MAP ─────────────────────────────────────────────── */
function initFlightMap(b) {
  const container = $('flight-map');
  if (!container || typeof L === 'undefined') return;
  const statusEl = $('dbMapStatus');
  
  if (STATE.flightMap) {
    STATE.flightMap.remove();
    STATE.flightMap = null;
  }
  if (STATE.mapPollTimer) {
    clearInterval(STATE.mapPollTimer);
    STATE.mapPollTimer = null;
  }
  
  // Create map focused on LHR (London Heathrow)
  const map = L.map('flight-map', { zoomControl: false, attributionControl: false }).setView([51.4700, -0.4543], 8);
  STATE.flightMap = map;
  
  // Custom dark-ish clean tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(map);

  // SVG Airplane
  const planeSvg = `<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
  
  STATE.mapMarker = null;
  let trackedIcao24 = null;
  
  const fetchFlightData = async () => {
    try {
      // Bounding box around LHR: lamin, lomin, lamax, lomax
      const res = await fetch('https://opensky-network.org/api/states/all?lamin=50.5&lomin=-2.0&lamax=52.5&lomax=1.0');
      if (!res.ok) throw new Error('OpenSky API error');
      const data = await res.json();
      
      const states = data.states;
      if (!states || states.length === 0) {
        if (statusEl) statusEl.innerHTML = `<span></span>No live flights nearby`;
        return;
      }
      
      // If we don't have a tracked flight, pick a commercial one (with a callsign) that has valid pos + heading
      let flight = null;
      if (trackedIcao24) {
        flight = states.find(s => s[0] === trackedIcao24);
      }
      if (!flight) {
        flight = states.find(s => s[1] && s[1].trim().length > 2 && s[5] !== null && s[6] !== null && s[10] !== null);
      }
      
      if (flight) {
        trackedIcao24 = flight[0];
        const lon = flight[5];
        const lat = flight[6];
        const heading = flight[10] || 0;
        const callsign = flight[1] ? flight[1].trim() : 'Unknown';
        
        if (!STATE.mapMarker) {
          const icon = L.divIcon({
            html: `<div class="plane-marker-icon" style="transform: rotate(${heading}deg)">${planeSvg}</div>`,
            className: 'plane-marker',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          });
          STATE.mapMarker = L.marker([lat, lon], { icon }).addTo(map);
          map.setView([lat, lon], 9);
        } else {
          STATE.mapMarker.setLatLng([lat, lon]);
          const iconEl = STATE.mapMarker.getElement().querySelector('.plane-marker-icon');
          if (iconEl) iconEl.style.transform = `rotate(${heading}deg)`;
        }
        
        if (statusEl) {
          statusEl.innerHTML = `<span></span>Live: ${callsign} (Alt: ${Math.round(flight[7] || 0)}m)`;
          statusEl.classList.add('tracking'); // could add green dot styling
        }
      } else {
         if (statusEl) statusEl.innerHTML = `<span></span>Signal lost`;
      }
    } catch (e) {
      console.warn('Flight map fetch error:', e);
      if (statusEl && !STATE.mapMarker) statusEl.innerHTML = `<span></span>Map offline`;
    }
  };

  // Initial fetch
  fetchFlightData();
  // Poll every 12 seconds
  STATE.mapPollTimer = setInterval(fetchFlightData, 12000);
}

/* ── PUBLIC FLIGHT RADAR ─────────────────────────────────────────── */
function initPublicRadar() {
  const container = $('public-radar-map');
  if (!container || typeof L === 'undefined') return;
  
  if (STATE.radarMap) return; // already initialized
  
  // Center on Sri Lanka initially (CMB)
  const map = L.map('public-radar-map', { 
    zoomControl: true, 
    attributionControl: false,
    minZoom: 6 // Critical: prevent zooming out too far which crashes OpenSky API
  }).setView([7.18, 79.88], 7);
  
  STATE.radarMap = map;
  STATE.radarMarkers = {};
  
  // Dark/premium vector-like map
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(map);
  
  const planeSvg = `<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
  
  let isFetching = false;
  
  const fetchRadarData = async () => {
    if (isFetching || !STATE.radarMap) return;
    
    // Get visible bounding box
    const bounds = STATE.radarMap.getBounds();
    const lamin = bounds.getSouth();
    const lomin = bounds.getWest();
    const lamax = bounds.getNorth();
    const lomax = bounds.getEast();
    
    isFetching = true;
    try {
      const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      
      const states = data.states || [];
      const currentIcaos = new Set();
      
      states.forEach(s => {
        const icao = s[0];
        const callsign = s[1] ? s[1].trim() : '';
        const lon = s[5];
        const lat = s[6];
        const alt = s[7] || 0;
        const heading = s[10] || 0;
        
        // Skip invalid positions
        if (lon === null || lat === null) return;
        currentIcaos.add(icao);
        
        if (STATE.radarMarkers[icao]) {
          // Update existing marker
          STATE.radarMarkers[icao].setLatLng([lat, lon]);
          const iconEl = STATE.radarMarkers[icao].getElement()?.querySelector('.plane-marker-icon');
          if (iconEl) iconEl.style.transform = `rotate(${heading}deg)`;
        } else {
          // Create new marker
          const icon = L.divIcon({
            html: `<div class="plane-marker-icon" style="transform: rotate(${heading}deg)" title="${callsign} | Alt: ${Math.round(alt)}m">${planeSvg}</div>`,
            className: 'plane-marker',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });
          const marker = L.marker([lat, lon], { icon }).addTo(STATE.radarMap);
          STATE.radarMarkers[icao] = marker;
        }
      });
      
      // Cleanup stale markers (planes that left the bounds)
      Object.keys(STATE.radarMarkers).forEach(icao => {
        if (!currentIcaos.has(icao)) {
          STATE.radarMap.removeLayer(STATE.radarMarkers[icao]);
          delete STATE.radarMarkers[icao];
        }
      });
      
    } catch (e) {
      console.warn('Radar fetch failed:', e);
    } finally {
      isFetching = false;
    }
  };

  // Initial load
  fetchRadarData();
  
  // Refresh when map stops moving
  map.on('moveend', fetchRadarData);
  
  // Auto-poll
  STATE.radarPollTimer = setInterval(fetchRadarData, 15000);
}

/* ── INIT ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded',()=>{
  fetchInitialData();
  initNav();
  initDates();
  initTripTabs();
  initPassengers();
  initAirlineSelect();
  initSearch();
  initManageBooking();
  initBoardingPass();
  initFlightStatus();
  initCheckin();
  initBookingFlow();
  initPnrModal();

  showView('search');

  setTimeout(()=>toast('Welcome to AeroNexus','Backend API connected successfully.','info'),700);
});
