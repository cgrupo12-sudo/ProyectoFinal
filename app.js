'use strict';

// Utilidades
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Elementos UI
const chartTypeSel = $('#chart-type');
const countriesBox = $('#countries');
const searchCountryInp = $('#search-country');
const selectAllBtn = $('#select-all');
const clearAllBtn = $('#clear-all');
const yearMinInp = $('#year-min');
const yearMaxInp = $('#year-max');
const sliderMin = $('#slider-min');
const sliderMax = $('#slider-max');
const yearsLabel = $('#years-label');
const applyYearsBtn = $('#apply-years');
const exportBtn = $('#btn-export');
const resetZoomBtn = $('#btn-reset-zoom');
const kpis = $('#quick-stats');

// Estado global
let RAW = [];
let DATA = []; // { pais, year, valuePct }

function getDoughnutConfig(labels, data, colors) {
  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => hexToRgba(c, 0.8)),
        borderColor: colors,
        borderWidth: 1
      }]
    },
    options: {
      plugins: {
        legend: { labels: { color: '#e5e7eb' } }
      }
    }
  };
}

function hasBoxplotSupport() {
  try {
    return !!(Chart && Chart.registry && Chart.registry.getController('boxplot'));
  } catch (_) {
    return false;
  }
}

function getBoxplotConfig(labels, data, colors, asType) {
  const type = asType || (hasBoxplotSupport() ? 'boxplot' : 'bar');
  return {
    type,
    data: {
      labels,
      datasets: [{
        label: type === 'boxplot' ? 'Distribución %' : 'Promedio %',
        backgroundColor: colors.map(c => hexToRgba(c, 0.35)),
        borderColor: colors,
        ...(type === 'boxplot' ? { outlierColor: '#eab308' } : {}),
        data
      }]
    },
    options: {
      plugins: {
        legend: { labels: { color: '#e5e7eb' } }
      },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: { ticks: { color: '#cbd5e1', callback: (v)=> v + '%' }, grid: { color: 'rgba(255,255,255,0.06)'} }
      }
    }
  };
}

function initSecondaryCharts() {
  const doughnutCanvas = document.getElementById('doughnutChart');
  const boxplotCanvas = document.getElementById('boxplotChart');
  if (doughnutCanvas && !doughnut) {
    doughnut = new Chart(doughnutCanvas.getContext('2d'), getDoughnutConfig([], [], []));
  }
  if (boxplotCanvas && !boxplot) {
    // Si no hay soporte de boxplot, se creará como 'bar'
    boxplot = new Chart(boxplotCanvas.getContext('2d'), getBoxplotConfig([], [], []));
  }
}
let YEARS = []; // únicos ordenados
let COUNTRIES = []; // únicos ordenados
let selectedCountries = new Set();
let currentYears = { min: null, max: null };
let chart = null;
let doughnut = null;
let boxplot = null;

// Paleta de colores
const palette = [
  '#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#60a5fa', '#f472b6', '#10b981', '#fbbf24', '#93c5fd',
  '#c084fc', '#4ade80', '#fca5a5', '#fde047', '#38bdf8', '#f97316', '#84cc16', '#e879f9'
];

function colorFor(idx) {
  return palette[idx % palette.length];
}

async function init() {
  try {
    RAW = await fetchJson('inflation_data.json');
    normalizeData();
    buildDomains();
    initUI();
    buildCountryPills();
    initChart();
    updateAll();
  } catch (err) {
    console.error('Error inicializando:', err);
    // Evitar interrumpir la experiencia con un alert; mostrar en consola
    console.warn('No se pudo cargar inflation_data.json. Sirve el sitio con un servidor local (ej. Python http.server o Live Server).');
  }
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// El JSON mezcla fracciones (0.045 = 4.5%) con porcentajes ya expresados (p.ej. 1300.6)
// Regla: si |valor| < 3, lo interpretamos como fracción y multiplicamos por 100; en caso contrario lo tomamos tal cual.
function toPercent(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) < 3 ? n * 100 : n;
}

function normalizeData() {
  DATA = RAW.map(r => {
    const paisRaw = (r['País'] ?? r['Pais'] ?? '').toString().trim();
    const pais = paisRaw.replace(/\s+/g, ' ').replace(/\s+$/g, '');
    const year = Number(r['Año'] ?? r['Ano'] ?? r['Anio']);
    const v = toPercent(Number(r['Inflación Anual'] ?? r['Inflacion Anual'] ?? r['Inflación anual']));
    return { pais, year, valuePct: v };
  }).filter(d => d.pais && Number.isFinite(d.year) && d.valuePct !== null);
}

function buildDomains() {
  YEARS = Array.from(new Set(DATA.map(d => d.year))).sort((a,b) => a-b);
  COUNTRIES = Array.from(new Set(DATA.map(d => d.pais))).sort((a,b) => a.localeCompare(b, 'es'));

  currentYears.min = YEARS[0];
  currentYears.max = YEARS[YEARS.length - 1];

  // sliders trabajan por índice para evitar huecos de años
  sliderMin.min = 0;
  sliderMax.min = 0;
  sliderMin.max = YEARS.length - 1;
  sliderMax.max = YEARS.length - 1;
  sliderMin.value = 0;
  sliderMax.value = YEARS.length - 1;

  yearMinInp.value = currentYears.min;
  yearMaxInp.value = currentYears.max;
  updateYearsLabel();
}

function initUI() {
  chartTypeSel.addEventListener('change', () => updateChartType());

  sliderMin.addEventListener('input', () => {
    let minIdx = Math.min(Number(sliderMin.value), Number(sliderMax.value));
    sliderMin.value = String(minIdx);
    currentYears.min = YEARS[minIdx];
    yearMinInp.value = currentYears.min;
    updateAll();
  });

  sliderMax.addEventListener('input', () => {
    let maxIdx = Math.max(Number(sliderMin.value), Number(sliderMax.value));
    sliderMax.value = String(maxIdx);
    currentYears.max = YEARS[maxIdx];
    yearMaxInp.value = currentYears.max;
    updateAll();
  });

  applyYearsBtn.addEventListener('click', () => {
    let minY = Number(yearMinInp.value);
    let maxY = Number(yearMaxInp.value);
    if (!YEARS.includes(minY) || !YEARS.includes(maxY)) {
      // ajustar al más cercano existente
      minY = nearestYear(minY);
      maxY = nearestYear(maxY);
    }
    if (minY > maxY) [minY, maxY] = [maxY, minY];
    currentYears.min = minY;
    currentYears.max = maxY;
    sliderMin.value = String(YEARS.indexOf(minY));
    sliderMax.value = String(YEARS.indexOf(maxY));
    updateAll();
  });

  searchCountryInp.addEventListener('input', () => filterCountryPills(searchCountryInp.value));
  selectAllBtn.addEventListener('click', () => { selectedCountries = new Set(COUNTRIES); syncPills(); updateAll(); });
  clearAllBtn.addEventListener('click', () => { selectedCountries.clear(); syncPills(); updateAll(); });

  exportBtn.addEventListener('click', exportPNG);
  resetZoomBtn.addEventListener('click', () => chart?.resetZoom());
}

function nearestYear(y) {
  // devuelve el año de YEARS más cercano a y
  let best = YEARS[0];
  let bestDist = Math.abs(y - YEARS[0]);
  for (const yr of YEARS) {
    const d = Math.abs(y - yr);
    if (d < bestDist) { best = yr; bestDist = d; }
  }
  return best;
}

function buildCountryPills() {
  countriesBox.innerHTML = '';
  // Selección por defecto: top 8 países por orden
  const defaultSelection = new Set(
    COUNTRIES.slice(0, Math.min(8, COUNTRIES.length))
  );
  if (selectedCountries.size === 0) selectedCountries = defaultSelection;

  COUNTRIES.forEach((c, idx) => {
    const pill = document.createElement('button');
    pill.className = 'pill' + (selectedCountries.has(c) ? ' selected' : '');
    pill.textContent = c;
    pill.dataset.country = c;
    pill.style.borderColor = colorFor(idx);
    pill.addEventListener('click', () => {
      if (selectedCountries.has(c)) selectedCountries.delete(c); else selectedCountries.add(c);
      pill.classList.toggle('selected');
      updateAll();
    });
    countriesBox.appendChild(pill);
  });
}

function filterCountryPills(query) {
  const q = query.trim().toLowerCase();
  $$('#countries .pill').forEach(p => {
    const show = p.textContent.toLowerCase().includes(q);
    p.style.display = show ? '' : 'none';
  });
}

function syncPills() {
  $$('#countries .pill').forEach(p => {
    const c = p.dataset.country;
    p.classList.toggle('selected', selectedCountries.has(c));
  });
}

function initChart() {
  const ctx = document.getElementById('inflationChart').getContext('2d');
  chart = new Chart(ctx, getChartConfig('line', [], []));
  // Inicializar charts inferiores si existen en el DOM
  initSecondaryCharts();
}

function getChartConfig(type, labels, datasets) {
  // Para scatter, labels se ignora, los datasets llevan pares {x:year, y:val}
  return {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.0, // ancho/alto. Ajusta 1.8–2.4 según gusto
      scales: {
        x: {
          // Clave: usar escala lineal para scatter
          type: type === 'scatter' ? 'linear' : 'category',
          ticks: { color: '#cbd5e1' },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          ticks: {
            color: '#cbd5e1',
            callback: (v) => v + '%'
          },
          grid: { color: 'rgba(255,255,255,0.06)' },
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e5e7eb' },
          onClick: (e, legendItem, legend) => {
            const ci = legend.chart;
            const idx = legendItem.datasetIndex;
            const meta = ci.getDatasetMeta(idx);
            meta.hidden = meta.hidden === null ? !ci.data.datasets[idx].hidden : null;
            ci.update();
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw?.y ?? ctx.raw ?? ctx.parsed.y ?? ctx.parsed;
              const y = ctx.raw?.x ?? ctx.label;
              return `${ctx.dataset.label} - ${y}: ${formatPct(v)}`;
            }
          }
        },
        zoom: {
          pan: { enabled: true, mode: 'x', modifierKey: 'ctrl' },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
        }
      }
    }
  };
}

function formatPct(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(Math.abs(v) < 10 ? 2 : 1) + '%';
}

function buildDatasets(filtered, type) {
  const years = YEARS.filter(y => y >= currentYears.min && y <= currentYears.max);
  const byCountry = groupBy(filtered, d => d.pais);
  const datasets = [];
  let cIdx = 0;
  for (const [pais, arr] of Object.entries(byCountry)) {
    if (!selectedCountries.has(pais)) continue;
    const color = colorFor(cIdx++);
    if (type === 'scatter') {
      const points = arr
        .filter(d => d.year >= currentYears.min && d.year <= currentYears.max)
        .sort((a,b) => a.year - b.year)
        .map(d => ({ x: d.year, y: d.valuePct }));
      datasets.push({
        label: pais,
        data: points,
        showLine: true,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.25),
        pointRadius: 3,
        tension: 0.2
      });
    } else {
      const map = new Map(arr.map(d => [d.year, d.valuePct]));
      const series = years.map(y => map.get(y) ?? null);
      datasets.push({
        label: pais,
        data: series,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.25),
        pointRadius: 3,
        tension: 0.2
      });
    }
  }
  return { labels: years, datasets };
}

function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const el of arr) {
    const k = keyFn(el);
    (out[k] ||= []).push(el);
  }
  return out;
}

function updateAll() {
  updateYearsLabel();
  const filtered = DATA.filter(d => d.year >= currentYears.min && d.year <= currentYears.max);
  const type = chartTypeSel.value;
  const { labels, datasets } = buildDatasets(filtered, type);

  if (type === 'scatter') {
    chart.config.type = 'scatter';
    chart.data.labels = [];
  } else {
    chart.config.type = type;
    chart.data.labels = labels;
  }
  // Ajustar tipo de eje X dinámicamente
  if (chart.options && chart.options.scales && chart.options.scales.x) {
    chart.options.scales.x.type = (type === 'scatter') ? 'linear' : 'category';
  }
  chart.data.datasets = datasets;
  chart.update();

  updateKPIs(filtered);
  if (typeof updateSecondaryCharts === 'function') {
    updateSecondaryCharts(filtered);
  }
}

function updateChartType() {
  updateAll();
}

function updateYearsLabel() {
  yearsLabel.textContent = `${currentYears.min} – ${currentYears.max}`;
}

function exportPNG() {
  if (!chart) return;
  const link = document.createElement('a');
  link.download = `inflacion_latam_${currentYears.min}-${currentYears.max}.png`;
  link.href = chart.toBase64Image('image/png', 1.0);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function updateKPIs(filtered) {
  // KPI: promedio, mínimo, máximo del período seleccionado (sobre países seleccionados)
  const values = filtered.filter(d => selectedCountries.has(d.pais)).map(d => d.valuePct).filter(v => v !== null);
  const avg = values.length ? values.reduce((a,b) => a+b, 0) / values.length : null;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  kpis.innerHTML = `
    <div class="kpi"><div class="label">Promedio seleccionado</div><div class="value">${formatPct(avg)}</div></div>
    <div class="kpi"><div class="label">Mínimo</div><div class="value">${formatPct(min)}</div></div>
    <div class="kpi"><div class="label">Máximo</div><div class="value">${formatPct(max)}</div></div>
  `;
}

// Actualiza los gráficos de la sección "Resumen adicional"
function updateSecondaryCharts(filtered) {
  const labels = [];
  const colors = [];
  const avgData = [];
  const boxData = [];

  let colorIdx = 0;
  for (const pais of COUNTRIES) {
    if (!selectedCountries.has(pais)) continue;
    const vals = filtered.filter(d => d.pais === pais).map(d => d.valuePct).filter(v => Number.isFinite(v));
    if (!vals.length) continue;
    labels.push(pais);
    const c = colorFor(colorIdx++);
    colors.push(c);
    // Para la dona usamos promedios de valores absolutos para garantizar suma positiva
    const avgAbs = vals.reduce((a,b)=> a + Math.abs(b), 0) / vals.length;
    avgData.push(avgAbs);
    // Para boxplot usamos los valores crudos (pueden ser negativos)
    boxData.push(vals);
  }

  // Doughnut (promedio por país)
  if (doughnut) {
    const total = avgData.reduce((a,b)=> a + (Number.isFinite(b) ? b : 0), 0);
    if (labels.length === 0 || total <= 0) {
      doughnut.data.labels = ['Sin datos'];
      doughnut.data.datasets[0].data = [1];
      doughnut.data.datasets[0].backgroundColor = ['#64748b'];
      doughnut.data.datasets[0].borderColor = ['#64748b'];
    } else {
      doughnut.data.labels = labels;
      doughnut.data.datasets[0].data = avgData;
      doughnut.data.datasets[0].backgroundColor = colors.map(hex => hexToRgba(hex, 0.8));
      doughnut.data.datasets[0].borderColor = colors;
    }
    doughnut.update();
  }

  // Boxplot (distribución por país) o fallback a barras con promedio
  if (boxplot) {
    const isBoxplot = hasBoxplotSupport();
    boxplot.data.labels = labels.length ? labels : ['Sin datos'];
    boxplot.data.datasets[0].backgroundColor = (labels.length ? colors : ['#64748b']).map(hex => hexToRgba(hex, 0.35));
    boxplot.data.datasets[0].borderColor = labels.length ? colors : ['#64748b'];
    if (isBoxplot) {
      boxplot.config.type = 'boxplot';
      boxplot.data.datasets[0].label = 'Distribución %';
      boxplot.data.datasets[0].data = labels.length ? boxData : [[0]];
    } else {
      boxplot.config.type = 'bar';
      boxplot.data.datasets[0].label = 'Promedio %';
      const totals = avgData.length ? avgData : [1];
      boxplot.data.datasets[0].data = totals;
    }
    boxplot.update();
  }
}

// Iniciar
window.addEventListener('DOMContentLoaded', init);