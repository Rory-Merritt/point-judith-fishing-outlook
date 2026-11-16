'use strict';

const SPOT = { latitude: 41.36, longitude: -71.49, name: 'Point Judith' };
const SPECIES = [
  { key: 'bass', name: 'Striped bass', minTemp: 52, maxTemp: 68, emoji: '🐟' },
  { key: 'fluke', name: 'Fluke (summer flounder)', minTemp: 60, maxTemp: 72, emoji: '🐠' },
  { key: 'seaBass', name: 'Black sea bass', minTemp: 55, maxTemp: 72, emoji: '🐟' },
  { key: 'scup', name: 'Scup', minTemp: 58, maxTemp: 72, emoji: '🐡' },
  { key: 'tautog', name: 'Tautog', minTemp: 48, maxTemp: 65, emoji: '🐟' }
];
const DAY_COUNT = 3;

// ======================= EDITABLE SCORING RULES =======================
// Tune these weights, cutoffs, and species temperature bands to match your experience.
// The component weights are normalized automatically, so their total need not equal 1.
const SCORING_RULES = {
  weights: { tide: 0.30, wind: 0.30, waves: 0.25, temperature: 0.15 },
  tide: { movingRangeFeet: 1.0, strongRangeFeet: 2.5, slackScore: 2, strongScore: 10 },
  wind: { favorableKnots: 10, limitKnots: 15, favorableScore: 10, limitScore: 5, roughScore: 2 },
  waves: { favorableFeet: 2, limitFeet: 4, favorableScore: 10, limitScore: 5, roughScore: 2 },
  temperature: { inRangeScore: 10, nearRangeScore: 6, farScore: 3, nearByDegrees: 5 }
};
// Species temperature preferences (°F) are listed in SPECIES above.
// =====================================================================

const $ = (selector) => document.querySelector(selector);
const dateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' });

function dateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function addDays(date, count) { const result = new Date(date); result.setUTCDate(result.getUTCDate() + count); return result; }
function average(values) { const good = values.filter(Number.isFinite); return good.length ? good.reduce((a, b) => a + b, 0) / good.length : null; }
function maximum(values) { const good = values.filter(Number.isFinite); return good.length ? Math.max(...good) : null; }
function cToF(value) { return Number.isFinite(value) ? value * 9 / 5 + 32 : null; }
function knotsFromKmh(value) { return Number.isFinite(value) ? value / 1.852 : null; }
function round(value, places = 0) { const factor = 10 ** places; return Math.round(value * factor) / factor; }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

function moonPhase(date) {
  // Synodic month approximation; phase is between 0 (new) and 1 (next new).
  const synodicMonth = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const phase = ((date.getTime() - knownNewMoon) / 86400000 % synodicMonth + synodicMonth) % synodicMonth / synodicMonth;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const index = Math.round(phase * 8) % 8;
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  return `${icons[index]} ${names[index]}`;
}

function getDailyMarine(marine, forecast, dayKey) {
  const marineTimes = marine.hourly?.time || [];
  const forecastTimes = forecast.hourly?.time || [];
  const marineIndexes = marineTimes.map((time, index) => time.slice(0, 10) === dayKey ? index : -1).filter((index) => index >= 0);
  const forecastIndexes = forecastTimes.map((time, index) => time.slice(0, 10) === dayKey ? index : -1).filter((index) => index >= 0);
  const windKmh = forecastIndexes.map((i) => forecast.hourly.wind_speed_10m?.[i]).filter(Number.isFinite);
  const waveM = marineIndexes.map((i) => marine.hourly.wave_height?.[i]).filter(Number.isFinite);
  const tempC = marineIndexes.map((i) => marine.hourly.sea_surface_temperature?.[i]).filter(Number.isFinite);
  return {
    wind: windKmh.length ? knotsFromKmh(average(windKmh)) : null,
    gust: forecastIndexes.map((i) => forecast.hourly.wind_gusts_10m?.[i]).filter(Number.isFinite).length ? knotsFromKmh(maximum(forecastIndexes.map((i) => forecast.hourly.wind_gusts_10m?.[i]))) : null,
    wave: waveM.length ? maximum(waveM) * 3.28084 : null,
    temp: tempC.length ? cToF(average(tempC)) : null
  };
}

function scoreTide(range) {
  const rules = SCORING_RULES.tide;
  if (!Number.isFinite(range)) return null;
  if (range <= rules.movingRangeFeet) return rules.slackScore;
  const fraction = Math.min(1, (range - rules.movingRangeFeet) / (rules.strongRangeFeet - rules.movingRangeFeet));
  return rules.slackScore + fraction * (rules.strongScore - rules.slackScore);
}
function scoreWind(knots) {
  const r = SCORING_RULES.wind;
  if (!Number.isFinite(knots)) return null;
  if (knots <= r.favorableKnots) return r.favorableScore;
  if (knots <= r.limitKnots) return r.favorableScore - (knots - r.favorableKnots) / (r.limitKnots - r.favorableKnots) * (r.favorableScore - r.limitScore);
  return Math.max(r.roughScore, r.limitScore - (knots - r.limitKnots) * 0.4);
}
function scoreWaves(feet) {
  const r = SCORING_RULES.waves;
  if (!Number.isFinite(feet)) return null;
  if (feet <= r.favorableFeet) return r.favorableScore;
  if (feet <= r.limitFeet) return r.favorableScore - (feet - r.favorableFeet) / (r.limitFeet - r.favorableFeet) * (r.favorableScore - r.limitScore);
  return Math.max(r.roughScore, r.limitScore - (feet - r.limitFeet) * 1.2);
}
function scoreTemperature(temp, species) {
  const r = SCORING_RULES.temperature;
  if (!Number.isFinite(temp)) return null;
  if (temp >= species.minTemp && temp <= species.maxTemp) return r.inRangeScore;
  const distance = temp < species.minTemp ? species.minTemp - temp : temp - species.maxTemp;
  return distance <= r.nearByDegrees ? r.nearRangeScore : r.farScore;
}
function makeSpeciesScore(species, day, tideScore) {
  const components = [
    { name: 'tide', score: tideScore },
    { name: 'wind', score: scoreWind(day.wind) },
    { name: 'waves', score: scoreWaves(day.wave) },
    { name: 'temperature', score: scoreTemperature(day.temp, species) }
  ].filter((item) => Number.isFinite(item.score));
  const weightSum = components.reduce((sum, item) => sum + SCORING_RULES.weights[item.name], 0);
  const score = weightSum ? Math.max(1, Math.min(10, Math.round(components.reduce((sum, item) => sum + item.score * SCORING_RULES.weights[item.name], 0) / weightSum))) : 5;
  const reason = buildReason(species, day, tideScore);
  return { score, reason };
}
function buildReason(species, day, tideScore) {
  const facts = [];
  if (Number.isFinite(day.wind)) facts.push(`${round(day.wind)} kt wind ${day.wind <= SCORING_RULES.wind.favorableKnots ? 'is light' : day.wind <= SCORING_RULES.wind.limitKnots ? 'is manageable' : 'may be sporty'}`);
  if (Number.isFinite(day.wave)) facts.push(`${round(day.wave, 1)} ft seas ${day.wave <= SCORING_RULES.waves.favorableFeet ? 'are calm' : day.wave <= SCORING_RULES.waves.limitFeet ? 'are moderate' : 'are choppy'}`);
  if (Number.isFinite(tideScore)) facts.push(tideScore >= 7 ? 'good tide movement' : tideScore <= 3 ? 'a slower tide' : 'some tide movement');
  if (Number.isFinite(day.temp)) {
    const inRange = day.temp >= species.minTemp && day.temp <= species.maxTemp;
    facts.push(`${round(day.temp)}°F water ${inRange ? 'fits' : 'is outside'} its preferred range`);
  }
  return facts.length ? facts.slice(0, 3).join(' · ') + '.' : 'Some conditions are unavailable; score is a neutral estimate.';
}
function overallLabel(score) {
  if (score >= 8) return 'Looks like a fine day to make a run.';
  if (score >= 6) return 'A promising window—keep an eye on the breeze.';
  if (score >= 4) return 'Mixed conditions; pick your window.';
  return 'A challenging forecast. Use extra caution.';
}
function scoreClass(score) { return score >= 7 ? '' : score >= 4 ? 'mixed' : 'challenging'; }
function fmt(value, digits = 0) { return Number.isFinite(value) ? round(value, digits) : '—'; }
function tideSummary(events, key) {
  const dayEvents = events.filter((event) => event.time.slice(0, 10) === key);
  const highs = dayEvents.filter((event) => event.type === 'H');
  const lows = dayEvents.filter((event) => event.type === 'L');
  const label = (event) => `${event.type === 'H' ? 'High' : 'Low'} ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(event.time))}`;
  return { events: dayEvents, text: [...highs.slice(0, 1), ...lows.slice(0, 1)].map(label).join(' · ') || 'Tide predictions unavailable' };
}
function tideRange(events) {
  const heights = events.map((event) => Number(event.height)).filter(Number.isFinite);
  return heights.length >= 2 ? Math.max(...heights) - Math.min(...heights) : null;
}

function render(days) {
  const today = days[0];
  $('#overall-score').textContent = today.overall;
  $('#overall-summary').textContent = overallLabel(today.overall);
  $('#updated-at').textContent = `UPDATED ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date())}`;
  $('#forecast-cards').innerHTML = days.map((day, index) => `
    <article class="forecast-card ${index === 0 ? 'today' : ''}">
      <div class="card-top"><div><p class="day-name">${index === 0 ? 'Today' : escapeHTML(dateFormatter.format(day.date).split(',')[0])}</p><p class="day-date">${escapeHTML(dateFormatter.format(day.date))}</p></div><div class="card-score ${scoreClass(day.overall)}">${day.overall}<small> / 10</small></div></div>
      <div class="conditions">
        <div class="condition"><span class="condition-icon">↗</span><span>${fmt(day.wind)} kt wind</span></div>
        <div class="condition"><span class="condition-icon">〰</span><span>${fmt(day.wave, 1)} ft waves</span></div>
        <div class="condition"><span class="condition-icon">🌡</span><span>${fmt(day.temp)}°F water</span></div>
        <div class="condition"><span class="condition-icon">☾</span><span>${escapeHTML(moonPhase(day.date))}</span></div>
      </div>
      <div class="tide-info"><strong>Tide:</strong> ${escapeHTML(day.tideText)}${Number.isFinite(day.tideRange) ? ` <span>(${round(day.tideRange, 1)} ft range)</span>` : ''}</div>
      <p class="card-species">Best outlook: ${escapeHTML(day.bestSpecies)}</p>
    </article>`).join('');
  $('#species-rows').innerHTML = SPECIES.map((species) => `<tr><td>${species.emoji} ${escapeHTML(species.name)}</td>${days.map((day) => `<td><span class="score-pill ${scoreClass(day.speciesScores[species.key].score)}">${day.speciesScores[species.key].score}</span></td>`).join('')}<td class="reason">${escapeHTML(today.speciesScores[species.key].reason)}</td></tr>`).join('');
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.reason || 'The data provider returned an error.');
  return data;
}
async function loadOutlook() {
  const start = new Date();
  const end = addDays(start, DAY_COUNT - 1);
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
  marineUrl.search = new URLSearchParams({ latitude: SPOT.latitude, longitude: SPOT.longitude, hourly: 'wave_height,sea_surface_temperature', temperature_unit: 'celsius', timezone: 'America/New_York', forecast_days: '4' });
  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.search = new URLSearchParams({ latitude: SPOT.latitude, longitude: SPOT.longitude, hourly: 'wind_speed_10m,wind_gusts_10m', wind_speed_unit: 'kn', timezone: 'America/New_York', forecast_days: '4' });
  const tideUrl = new URL('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter');
  tideUrl.search = new URLSearchParams({ product: 'predictions', application: 'point_judith_fishing_outlook', begin_date: startKey.replaceAll('-', ''), end_date: endKey.replaceAll('-', ''), datum: 'MLLW', station: '8455083', time_zone: 'lst_ldt', units: 'english', interval: 'hilo', format: 'json' });

  // Fail as a group rather than displaying a misleading outlook built from incomplete data.
  const [marine, forecast, tideData] = await Promise.all([fetchJSON(marineUrl), fetchJSON(forecastUrl), fetchJSON(tideUrl)]);
  if (!marine.hourly || !forecast.hourly || !Array.isArray(tideData.predictions)) throw new Error('One of the data services returned incomplete conditions.');
  const tideEvents = tideData.predictions;
  const days = [];
  for (let offset = 0; offset < DAY_COUNT; offset++) {
    const date = addDays(start, offset);
    const key = dateKey(date);
    if (key < startKey || key > endKey) continue;
    const conditions = getDailyMarine(marine, forecast, key);
    const tide = tideSummary(tideEvents, key);
    const range = tideRange(tide.events);
    const tScore = scoreTide(range);
    const day = { date, ...conditions, tideText: tide.text, tideRange: range, speciesScores: {} };
    SPECIES.forEach((species) => { day.speciesScores[species.key] = makeSpeciesScore(species, day, tScore); });
    const scores = SPECIES.map((species) => day.speciesScores[species.key].score);
    day.overall = Math.round(average(scores));
    day.bestSpecies = [...SPECIES].sort((a, b) => day.speciesScores[b.key].score - day.speciesScores[a.key].score)[0].name;
    days.push(day);
  }
  if (days.length !== DAY_COUNT) throw new Error('The forecast did not include all three local dates.');
  render(days);
}

loadOutlook().catch((error) => {
  console.error('Unable to load Point Judith outlook:', error);
  $('#error-message').hidden = false;
  $('#error-message').textContent = 'We couldn’t get the latest conditions just now. Please check your connection and try refreshing. The outlook needs tide, wind, and marine data to calculate a useful estimate.';
  $('#forecast-cards').innerHTML = '<article class="forecast-card loading-card"><p>Forecast temporarily unavailable</p></article>';
  $('#species-rows').innerHTML = '<tr><td colspan="5" class="table-loading">Species scores will appear when the data is back.</td></tr>';
  $('#overall-score').textContent = '—';
  $('#overall-summary').textContent = 'Conditions are temporarily unavailable.';
});
