// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let stream = null;
let facingMode = 'environment';
let currentPhoto = null;
let capturedTime = '';
let capturedDate = '';
let capturedSystemDate = null;
let gpsData = { lat: null, lng: null, address: 'Mendapatkan alamat...', city: 'Sragen', raw: '' };
let currentLayout = 1;
let gridPhotos = [];
let currentTime = '';
let currentDate = '';
let gridCaptureMode = false;
let pendingGridSlot = null;

let settings = {
  quickTitles: ['Patroli Keamanan', 'Pemasangan Internet','Survey Lokasi','Perbaikan Jaringan','Inspeksi Lapangan','Dokumentasi Proyek'],
  templates: getNewDefaultTemplates(),
  orgName: 'ASTEKPAM LAPAS SRAGEN',
  sst: 'PAGI',
  karupam: 'WIJOKO',
  rupam: 'RUPAM I'
};

function getNewDefaultTemplates() {
  return [
    {
      name: 'Laporan Trolling',
      body: `Assalamu'alaikum Wr. Wb.


Mohon Izin melaporkan giat trolling Blok hunian WBP yaitu Ka.rupam dan Petugas Blok di Lembaga Pemasyarakatan Kelas IIA Sragen, pada :

Hari/ tgl. : {tanggal}
Pukul       : {pukul}

Situasi dalam keadaan aman, terkendali dan kondusif. dan terima kasih.
        
                  {kota}, {tanggal_saja}

    KEPALA

 TTD

GIYONO
NIP.197010281995031001`
    },
    {
      name: 'Ringkas',
      body: `*[{judul}]*\n{tanggal} {waktu}\n📍 {alamat}\n{keterangan}`
    }
  ];
}

function loadSettings() {
  try {
    const s = localStorage.getItem('fieldcam_settings');
    if (s) {
      settings = { ...settings, ...JSON.parse(s) };
      // Force update default templates if Laporan Trolling is not present or is old version without {pukul} or {kota}
      const trollingTpl = settings.templates.find(t => t.name && t.name.includes('Trolling'));
      if (!trollingTpl || !trollingTpl.body.includes('{pukul}') || !trollingTpl.body.includes('{kota}')) {
        settings.templates = getNewDefaultTemplates();
        saveSettingsData();
      }
    } else {
      settings.templates = getNewDefaultTemplates();
      saveSettingsData();
    }
  } catch(e) {}
}
function saveSettingsData() {
  try {
    localStorage.setItem('fieldcam_settings', JSON.stringify(settings));
  } catch(e) {
    console.warn('LocalStorage is unavailable:', e);
  }
}

// ═══════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════
function goScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'settings-screen') renderSettings();
  if (id === 'cam-screen') { populateQuickTitles(); }
  if (id === 'preview-screen') {
    // Pre-fill waktu kegiatan if empty
    const waktuInp = document.getElementById('waktu-kegiatan-input');
    if (waktuInp && !waktuInp.value) {
      const pad = n => String(n).padStart(2,'0');
      const now = new Date();
      const waktuMenit = `${pad(now.getHours())}.${pad(now.getMinutes())}`;
      waktuInp.value = `${waktuMenit} WIB s.d selesai`;
    }

    populateTemplateSelect();
    updateTemplatePreview();
  }
}

// ═══════════════════════════════════════════════════
//  CAMERA
// ═══════════════════════════════════════════════════
async function startCamera() {
  try {
    if (stream) { stream.getTracks().forEach(t => t.stop()); }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    const video = document.getElementById('video');
    video.srcObject = stream;
    document.getElementById('no-cam-msg').classList.remove('show');
  } catch(e) {
    document.getElementById('no-cam-msg').classList.add('show');
    showToast('Izin kamera diperlukan');
  }
}

function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

// ═══════════════════════════════════════════════════
//  GPS
// ═══════════════════════════════════════════════════
let _lastGeocodedCoords = null;  // avoid re-geocoding same position
let _geocodeRetryTimer = null;
let _lastGoodAddress = '';       // cache last successful address
let _lastGoodCity = '';          // cache last successful city

function initGPS() {
  if (!navigator.geolocation) {
    gpsData.address = 'GPS tidak didukung';
    return;
  }

  const gpsOpts = { enableHighAccuracy: true, timeout: 8000, maximumAge: 2000 };

  // 1. Get a fast initial position first
  navigator.geolocation.getCurrentPosition(
    (pos) => _handleGPSPosition(pos),
    (err) => {
      // Try again with lower accuracy for speed
      navigator.geolocation.getCurrentPosition(
        (pos) => _handleGPSPosition(pos),
        () => _handleGPSError(),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
      );
    },
    gpsOpts
  );

  // 2. Then continuously watch for better positions
  navigator.geolocation.watchPosition(
    (pos) => _handleGPSPosition(pos),
    (err) => _handleGPSError(),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
  );
}

function _handleGPSPosition(pos) {
  const { latitude: lat, longitude: lng } = pos.coords;
  gpsData.lat = lat.toFixed(6);
  gpsData.lng = lng.toFixed(6);
  gpsData.raw = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  updateGPSUI();

  // Only re-geocode if position changed significantly (>~50m)
  const coordKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_lastGeocodedCoords !== coordKey) {
    _lastGeocodedCoords = coordKey;
    reverseGeocodeWithRetry(lat, lng, 0);
  }
}

function _handleGPSError() {
  if (!gpsData.lat) {
    gpsData.address = 'Lokasi tidak tersedia';
    gpsData.city = _lastGoodCity || 'Sragen';
    document.getElementById('gps-pill').className = 'gps-pill searching';
    document.getElementById('gps-pill-text').textContent = 'GPS Off';
    document.getElementById('hud-gps').textContent = 'Lokasi tidak tersedia';
  }
}

function updateGPSUI() {
  const pill = document.getElementById('gps-pill');
  if (pill) {
    pill.className = 'gps-pill';
    const pillText = document.getElementById('gps-pill-text');
    if (pillText) pillText.textContent = `${gpsData.lat}, ${gpsData.lng}`;
  }
  const hudGps = document.getElementById('hud-gps');
  if (hudGps) {
    hudGps.textContent = `${gpsData.address} | ${gpsData.raw}`;
  }
  
  // Automatically update template preview & active canvas watermark with new GPS info
  updateTemplatePreview();
  onWatermarkFieldChange();
}

// Retry wrapper - tries up to 3 times with increasing delay
async function reverseGeocodeWithRetry(lat, lng, attempt) {
  const success = await reverseGeocode(lat, lng);
  if (!success && attempt < 3) {
    const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
    clearTimeout(_geocodeRetryTimer);
    _geocodeRetryTimer = setTimeout(() => {
      reverseGeocodeWithRetry(lat, lng, attempt + 1);
    }, delay);
  }
}

async function reverseGeocode(lat, lng) {
  // === Provider 1: Nominatim (OpenStreetMap) ===
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=id&addressdetails=1&zoom=18`);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.display_name || data.address)) {
        const result = _parseNominatimResult(data);
        if (result.address && result.address.length > 5) {
          gpsData.address = result.address;
          gpsData.city = result.city;
          _lastGoodAddress = result.address;
          _lastGoodCity = result.city;
          updateGPSUI();
          return true;
        }
      }
    }
  } catch(e) { /* fall through to next provider */ }

  // === Provider 2: BigDataCloud (free, no key needed) ===
  try {
    const res2 = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`);
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2) {
        const result2 = _parseBigDataCloudResult(data2);
        if (result2.address && result2.address.length > 5) {
          gpsData.address = result2.address;
          gpsData.city = result2.city;
          _lastGoodAddress = result2.address;
          _lastGoodCity = result2.city;
          updateGPSUI();
          return true;
        }
      }
    }
  } catch(e) { /* fall through */ }

  // === Fallback: use cached address or build from coordinates ===
  if (_lastGoodAddress) {
    gpsData.address = _lastGoodAddress;
    gpsData.city = _lastGoodCity || 'Sragen';
  } else {
    gpsData.address = `Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)}`;
    gpsData.city = 'Sragen';
  }
  updateGPSUI();
  return false;
}

function _parseNominatimResult(data) {
  let address = '';
  let city = '';

  if (data.display_name) {
    const parts = data.display_name.split(',').map(p => p.trim());
    // Filter out postcodes, country (Indonesia), and empty entries
    const cleanParts = parts.filter(p => {
      if (/^\d{5}$/.test(p)) return false; // postcodes
      if (/Indonesia/i.test(p)) return false; // country
      if (!p) return false;
      return true;
    });
    
    // Join the clean parts to get a highly detailed address
    address = cleanParts.join(', ');

    // Find city
    if (data.address) {
      const a = data.address;
      city = a.city || a.town || a.city_district || '';
    }
    if (!city) {
      for (let part of cleanParts) {
        if (/Kabupaten|Kota|Regency/i.test(part)) {
          city = part.replace(/Kabupaten\s+/i, '')
                     .replace(/Kota\s+/i, '')
                     .replace(/\sRegency/i, '')
                     .trim();
          if (city) break;
        }
      }
    }
  }
  
  return { address: address || '', city: city || 'Sragen' };
}

function _parseBigDataCloudResult(data) {
  let address = '';
  let city = '';
  
  if (data.localityInfo && data.localityInfo.administrative) {
    // Sort administrative divisions by order descending (most specific first)
    const admins = [...data.localityInfo.administrative]
      .filter(a => a.name && !/Indonesia/i.test(a.name))
      .sort((a, b) => b.order - a.order);
      
    const parts = admins.map(a => {
      return a.name.replace(/Kabupaten\s+/i, 'Kab. ');
    });
    
    address = parts.join(', ');
    
    // Find city/kabupaten
    const kab = data.localityInfo.administrative.find(a => 
      a.name && /Kabupaten|Kota|Regency/i.test(a.name)
    );
    if (kab) {
      city = kab.name
        .replace(/Kabupaten\s+/i, '')
        .replace(/Kota\s+/i, '')
        .replace(/\sRegency/i, '')
        .trim();
    }
  }
  
  if (!address) {
    const parts = [];
    if (data.locality) parts.push(data.locality);
    if (data.city && data.city !== data.locality) parts.push(data.city);
    if (data.principalSubdivision) parts.push(data.principalSubdivision);
    address = parts.join(', ');
  }
  
  if (!city) city = data.city || data.locality || '';
  
  return { address: address || '', city: city || 'Sragen' };
}

// ═══════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  currentDate = `${days[now.getDay()]}, ${pad(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()}`;
  document.getElementById('hud-time').textContent = `${currentDate}  ${currentTime}`;
  document.getElementById('cam-date').textContent = currentDate;
}

// ═══════════════════════════════════════════════════
//  CAPTURE
// ═══════════════════════════════════════════════════
function capturePhoto() {
  const video = document.getElementById('video');
  if (!video.srcObject) { showToast('Kamera belum aktif'); return; }

  // Flash effect
  const flash = document.getElementById('flash');
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 200);

  // Draw to hidden canvas
  const canvas = document.getElementById('capture-canvas');
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');

  if (facingMode === 'user') {
    ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, vw, vh); ctx.restore();
  } else {
    ctx.drawImage(video, 0, 0, vw, vh);
  }

  const dataURL = canvas.toDataURL('image/jpeg', 0.92);

  // ── Grid capture mode ──
  if (gridCaptureMode && pendingGridSlot) {
    const { idx, n } = pendingGridSlot;
    gridPhotos[idx] = {
      dataURL: dataURL,
      time: currentTime,
      date: currentDate,
      systemDate: new Date()
    };
    if (idx === 0) {
      currentPhoto = dataURL;
      capturedTime = currentTime;
      capturedDate = currentDate;
      capturedSystemDate = gridPhotos[idx].systemDate;
    }
    gridCaptureMode = false;
    pendingGridSlot = null;
    document.getElementById('grid-capture-bar').style.display = 'none';
    document.getElementById('btn-shutter-label').textContent = '';
    goScreen('preview-screen');
    renderMultiGrid(n);
    showToast(`Foto ${idx + 1} tersimpan ke grid`);
    return;
  }

  // ── Normal capture mode ──
  currentPhoto = dataURL;
  capturedTime = currentTime;
  capturedDate = currentDate;
  capturedSystemDate = new Date();

  // Populate gridPhotos[0] so layout 1 and other layouts have the photo immediately
  gridPhotos[0] = {
    dataURL: dataURL,
    time: capturedTime,
    date: capturedDate,
    systemDate: capturedSystemDate
  };
  
  goScreen('preview-screen');
  populateTemplateSelect();
  updateTemplatePreview();
  setLayout(currentLayout);
}

function renderSinglePreview() {
  const filled = gridPhotos.filter(Boolean);
  if (!currentPhoto && !filled.length) return;
  buildGridImage().then(dataURL => {
    if (dataURL) {
      const canvas = document.getElementById('result-canvas');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
      };
      img.src = dataURL;
    }
  });
}

// ═══════════════════════════════════════════════════
//  RENDER STAMPED CANVAS
// ═══════════════════════════════════════════════════
function renderResultCanvas(photoDataURL, targetCanvas) {
  return new Promise(resolve => {
    const canvas = targetCanvas || document.getElementById('result-canvas');
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Draw the main photo
      ctx.drawImage(img, 0, 0, W, H);

      // Draw Marki Watermark
      const scale = W / 1000;
      drawMarkiWatermark(ctx, 0, 0, W, H, scale, 0);

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = photoDataURL;
  });
}

function getIndonesianDayName(dateObj) {
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  return days[dateObj.getDay()];
}

function formatIndonesianDate(dateObj) {
  const pad = n => String(n).padStart(2,'0');
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${pad(dateObj.getDate())}-${months[dateObj.getMonth()]}-${dateObj.getFullYear()}`;
}

function formatIndonesianNumericDate(dateObj) {
  const pad = n => String(n).padStart(2,'0');
  return `${pad(dateObj.getDate())}-${pad(dateObj.getMonth()+1)}-${dateObj.getFullYear()}`;
}

function drawPinIcon(ctx, x, y, size) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  // Top circle
  ctx.beginPath();
  ctx.arc(x + size/2, y + size/3 + 1, size/3.5, 0, Math.PI * 2);
  ctx.fill();
  // Pin point
  ctx.beginPath();
  ctx.moveTo(x + size/2 - size/4, y + size/3 + 2);
  ctx.lineTo(x + size/2, y + size * 0.85);
  ctx.lineTo(x + size/2 + size/4, y + size/3 + 2);
  ctx.closePath();
  ctx.fill();
  // Inner hole
  ctx.fillStyle = 'rgb(13, 40, 166)'; // background blue
  ctx.beginPath();
  ctx.arc(x + size/2, y + size/3 + 1, size/8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGlobeIcon(ctx, x, y, size) {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  // Outer circle
  ctx.arc(x + size/2, y + size/2, size/2.5, 0, Math.PI * 2);
  ctx.stroke();
  // Horizontal line (equator)
  ctx.beginPath();
  ctx.moveTo(x + size/2 - size/2.5, y + size/2);
  ctx.lineTo(x + size/2 + size/2.5, y + size/2);
  ctx.stroke();
  // Vertical ellipses (longitude lines)
  ctx.beginPath();
  ctx.ellipse(x + size/2, y + size/2, size/5, size/2.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}



function drawMarkiWatermark(ctx, px, py, pW, pH, scale, slotIndex, photoObj) {
  ctx.save();

  // Watermark box dimensions (expanded to fit much larger timestamp)
  const wW = 520 * scale;
  const wH = 220 * scale;
  const margin = 15 * scale;

  const x = px + margin;
  const y = py + pH - wH - margin;

  // 1. Draw semi-transparent dark blue background
  ctx.fillStyle = 'rgba(13, 40, 166, 0.65)';
  ctx.fillRect(x, y, wW, wH);

  // 2. Draw solid blue header bar
  const headerH = 36 * scale;
  ctx.fillStyle = 'rgb(13, 40, 166)';
  ctx.fillRect(x, y, wW, headerH);

  // 3. Draw NexaCam brand inside header permanently
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${14 * scale}px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillText('NexaCam', x + 12 * scale, y + headerH / 2);

  // 4. Draw white vertical line separator (shifted right to 160)
  const sepX = x + 160 * scale;
  const sepY1 = y + headerH + 10 * scale;
  const sepY2 = y + wH - 10 * scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.moveTo(sepX, sepY1);
  ctx.lineTo(sepX, sepY2);
  ctx.stroke();

  // 5. Left column: Time and Date (Enlarged significantly)
  const dateObj = photoObj?.systemDate || capturedSystemDate || new Date();
  const dayName = getIndonesianDayName(dateObj);
  const rawDateStr = formatIndonesianNumericDate(dateObj);
  const timeStr = (photoObj?.time || capturedTime || currentTime).split(':').slice(0, 2).join(':');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  
  // Large Time (increased from 38px to 46px)
  ctx.font = `bold ${46 * scale}px 'Share Tech Mono', monospace`;
  ctx.fillText(timeStr, x + 80 * scale, y + headerH + 52 * scale);

  // Thin horizontal separator line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1 * scale;
  ctx.beginPath();
  ctx.moveTo(x + 15 * scale, y + headerH + 68 * scale);
  ctx.lineTo(sepX - 15 * scale, y + headerH + 68 * scale);
  ctx.stroke();

  // Day and Date (increased from 12px to 15px)
  ctx.font = `bold ${15 * scale}px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillText(dayName, x + 80 * scale, y + headerH + 88 * scale);
  ctx.font = `bold ${14 * scale}px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillText(rawDateStr, x + 80 * scale, y + headerH + 108 * scale);

  // 6. Right column: Details list (scaled up details text)
  const detailX = sepX + 12 * scale;
  let detailY = y + headerH + 15 * scale;
  const rightColW = wW - (160 + 24) * scale;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Address
  const addrText = gpsData.address || 'Mendapatkan lokasi...';
  ctx.font = `bold ${15.5 * scale}px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillStyle = '#ffffff';
  
  // Icon
  drawPinIcon(ctx, detailX, detailY, 15 * scale);

  // Wrap address text
  const addrWords = addrText.split(' ');
  let line = '';
  let lines = [];
  const maxLineW = rightColW - 20 * scale;

  for (let n = 0; n < addrWords.length; n++) {
    let testLine = line + addrWords[n] + ' ';
    let testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxLineW && n > 0) {
      lines.push(line.trim());
      line = addrWords[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());

  // Draw wrapped lines (max 4 lines to fit beautifully)
  const maxAddrLines = 4;
  for (let j = 0; j < Math.min(lines.length, maxAddrLines); j++) {
    ctx.fillText(lines[j], detailX + 20 * scale, detailY);
    detailY += 18 * scale;
  }

  // Spacing before Daerah
  detailY += 6 * scale;

  // Daerah
  drawGlobeIcon(ctx, detailX, detailY, 15 * scale);
  const cityText = `Daerah ${gpsData.city || 'Sragen'}`;
  ctx.font = `bold ${15.5 * scale}px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillText(cityText, detailX + 20 * scale, detailY);
  detailY += 18 * scale;



  ctx.restore();
}



function onWatermarkFieldChange() {
  if (currentLayout === 1) {
    renderSinglePreview();
  } else {
    renderMultiGrid(currentLayout);
  }
}

// ═══════════════════════════════════════════════════
//  LAYOUT
// ═══════════════════════════════════════════════════
function setLayout(n) {
  currentLayout = n;
  document.querySelectorAll('.layout-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.layout) === n);
  });

  const single = document.getElementById('single-photo-section');
  const multi = document.getElementById('multi-photo-section');

  if (n === 1) {
    single.style.display = '';
    multi.style.display = 'none';
    renderSinglePreview();
  } else {
    single.style.display = 'none';
    multi.style.display = '';
    renderMultiGrid(n);
  }
}

function renderMultiGrid(n) {
  const grid = document.getElementById('multi-grid');
  const cols = n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 2 : n <= 6 ? 3 : 3;
  grid.className = `multi-grid grid-${cols <= 2 ? 2 : 3}`;
  grid.innerHTML = '';

  while (gridPhotos.length < n) gridPhotos.push(null);
  
  if (currentPhoto && !gridPhotos[0]) {
    gridPhotos[0] = {
      dataURL: currentPhoto,
      time: capturedTime || currentTime,
      date: currentDate,
      systemDate: capturedSystemDate || new Date()
    };
  }

  for (let i = 0; i < n; i++) {
    const slot = document.createElement('div');
    slot.className = 'grid-photo-slot' + (gridPhotos[i] ? ' has-photo' : '');
    const idx = i;

    if (gridPhotos[i]) {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;';
      slot.appendChild(c);
      renderStampedSlot(c, gridPhotos[i], i);

      const del = document.createElement('div');
      del.className = 'del-btn';
      del.textContent = '×';
      del.onclick = (e) => { 
        e.stopPropagation(); 
        gridPhotos[idx] = null; 
        if (idx === 0) currentPhoto = null; 
        renderMultiGrid(n); 
      };
      slot.appendChild(del);
    } else {
      slot.innerHTML = `<div class="add-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 4px;"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
        <span>Foto ${i+1}</span>
      </div>`;
      slot.onclick = () => selectGridPhoto(idx, n);
    }
    grid.appendChild(slot);
  }
}

function renderStampedSlot(canvas, photoDataURL, slotIndex) {
  const img = new Image();
  img.onload = () => {
    const W = 800, H = 600;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Draw photo (cover)
    const scale = Math.max(W/img.width, H/img.height);
    const dw = img.width*scale, dh = img.height*scale;
    ctx.drawImage(img, (W-dw)/2, (H-dh)/2, dw, dh);

    const photoObj = gridPhotos[slotIndex];
    drawMarkiWatermark(ctx, 0, 0, W, H, W / 1000, slotIndex, photoObj);
  };
  img.src = typeof photoDataURL === 'object' ? photoDataURL.dataURL : photoDataURL;
}

function selectGridPhoto(idx, n) {
  pendingGridSlot = { idx, n };
  gridCaptureMode = true;
  document.getElementById('btn-shutter-label').textContent = `Foto ${idx + 1} dari ${n}`;
  document.getElementById('grid-capture-bar').style.display = 'flex';
  goScreen('cam-screen');
}

// ═══════════════════════════════════════════════════
//  DOWNLOAD
// ═══════════════════════════════════════════════════
async function downloadPhoto() {
  showToast('Menyiapkan foto...');
  const dataURL = await buildGridImage();
  if (dataURL) {
    triggerDownload(dataURL, `nexacam_${Date.now()}.jpg`);
  }
}

function triggerDownload(dataURL, filename) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  a.click();
  showToast('Foto diunduh!');
}

async function buildGridImage() {
  const filled = gridPhotos.filter(Boolean);
  const count = filled.length;
  if (!count) { showToast('Belum ada foto di grid'); return null; }

  // Adjust grid layout dynamically based on the actual number of filled photos
  let n, cols;
  if (count === 1) {
    n = 1; cols = 1;
  } else if (count === 2) {
    n = 2; cols = 2;
  } else if (count === 3) {
    n = 3; cols = 3;
  } else if (count === 4) {
    n = 4; cols = 2;
  } else if (count === 5) {
    n = 6; cols = 3;
  } else if (count === 6) {
    n = 6; cols = 3;
  } else if (count === 7) {
    n = 8; cols = 2;
  } else if (count === 8) {
    n = 8; cols = 2;
  } else {
    n = 9; cols = 3;
  }
  const rows = Math.ceil(n / cols);

  // Cell size
  const cellW = 800, cellH = 600;
  const gap = 3;

  const headerH = 185;
  const yellowH = 55;
  const footerH = 50;

  const totalW = cols * cellW + (cols - 1) * gap;
  const totalH = headerH + yellowH + rows * cellH + (rows - 1) * gap + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // 1. Draw Header Background (Deep Blue)
  ctx.fillStyle = '#0b21a8';
  ctx.fillRect(0, 0, totalW, headerH);

  // 2. Draw Header Texts (Title & Description)
  const titleEl = document.getElementById('quick-title-select');
  const titleVal = (titleEl?.value && titleEl.value !== '— Pilih Judul —') ? titleEl.value : 'Patroli Keamanan';
  
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  
  // Title
  ctx.font = `bold 42px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillText(titleVal, totalW / 2, 65);
  
  // Description (Keterangan) - moved to the top header
  const ketText = document.getElementById('keterangan-input')?.value?.trim() || 'Kumpulan foto kerja lapangan';
  ctx.font = `20px 'Exo 2', 'Arial', sans-serif`;
  
  const headerWords = ketText.split(' ');
  let line = '';
  let lines = [];
  const maxHeaderLineW = totalW - 100;
  
  for (let n = 0; n < headerWords.length; n++) {
    let testLine = line + headerWords[n] + ' ';
    let testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxHeaderLineW && n > 0) {
      lines.push(line.trim());
      line = headerWords[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());
  
  // Draw wrapped lines centered under the title
  let textY = 110;
  for (let j = 0; j < Math.min(lines.length, 3); j++) {
    ctx.fillText(lines[j], totalW / 2, textY);
    textY += 26;
  }

  // 4. Draw Yellow Bar
  ctx.fillStyle = '#ffe600';
  ctx.fillRect(0, headerH, totalW, yellowH);

  // Yellow Bar Left Text (Brand name, lowercased)
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 22px 'Exo 2', 'Arial', sans-serif`;
  const barLeftText = 'nexacam';
  ctx.fillText(barLeftText, 25, headerH + yellowH / 2);

  // Yellow Bar Right Text (Date)
  ctx.textAlign = 'right';
  const firstPhotoObj = filled[0];
  const dateObj = firstPhotoObj?.systemDate || new Date();
  const dateStr = formatIndonesianDate(dateObj);
  ctx.fillText(dateStr, totalW - 25, headerH + yellowH / 2);

  // 5. Draw Photo Grid (with Gap)
  const gridY = headerH + yellowH;
  const gridH = rows * cellH + (rows - 1) * gap;
  ctx.fillStyle = '#0b21a8';
  ctx.fillRect(0, gridY, totalW, gridH);

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * (cellW + gap);
    const cy = gridY + row * (cellH + gap);

    if (filled[i]) {
      await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          // Draw photo (cover fit) with sharp cell clipping
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx, cy, cellW, cellH);
          ctx.clip();
          
          const iw = img.width, ih = img.height;
          const scale = Math.max(cellW/iw, cellH/ih);
          const dw = iw*scale, dh = ih*scale;
          const dx = cx + (cellW - dw)/2;
          const dy = cy + (cellH - dh)/2;
          ctx.drawImage(img, dx, dy, dw, dh);
          ctx.restore();

          // Draw Marki Watermark for this cell
          const photoObj = filled[i];
          drawMarkiWatermark(ctx, cx, cy, cellW, cellH, cellW / 1000, i, photoObj);

          resolve();
        };
        img.src = typeof filled[i] === 'object' ? filled[i].dataURL : filled[i];
      });
    } else {
      // Empty slot (gray placeholder)
      ctx.fillStyle = 'rgba(13, 20, 35, 0.95)';
      ctx.fillRect(cx, cy, cellW, cellH);
      
      // Draw a clean, vector camera shape instead of emoji
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      const camW = 80;
      const camH = 52;
      const camX = cx + cellW/2 - camW/2;
      const camY = cy + cellH/2 - camH/2 - 15;
      
      ctx.beginPath();
      roundRect(ctx, camX, camY, camW, camH, 8);
      ctx.fill();
      
      ctx.fillStyle = 'rgba(13, 20, 35, 0.95)';
      ctx.beginPath();
      ctx.arc(cx + cellW/2, cy + cellH/2 - 15, 16, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.arc(cx + cellW/2, cy + cellH/2 - 15, 8, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      roundRect(ctx, cx + cellW/2 - 20, camY - 10, 40, 10, 3);
      ctx.fill();
      
      ctx.font = `20px 'Exo 2'`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Foto ${i+1}`, cx + cellW/2, cy + cellH/2 + 35);
    }
  }

  // 6. Draw White Footer (simplified plain white bar)
  const footerY = gridY + gridH;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, footerY, totalW, footerH);

  // Draw footer text in red, bold, centered
  ctx.fillStyle = '#ff0000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 20px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillText('Foto ini diambil secara real-time dan akurat!', totalW / 2, footerY + footerH / 2);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncateCtxText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (ctx.measureText(t + '…').width > maxWidth && t.length > 0) t = t.slice(0, -1);
  return t + '…';
}

function cancelGridCapture() {
  gridCaptureMode = false;
  pendingGridSlot = null;
  document.getElementById('grid-capture-bar').style.display = 'none';
  document.getElementById('btn-shutter-label').textContent = '';
  goScreen('preview-screen');
}

// ═══════════════════════════════════════════════════
//  TEMPLATES & WHATSAPP
// ═══════════════════════════════════════════════════
function populateTemplateSelect() {
  const sel = document.getElementById('template-select');
  if (!sel) return;
  sel.innerHTML = settings.templates.map((t,i) =>
    `<option value="${i}">${t.name}</option>`
  ).join('');
  updateTemplatePreview();
}

function buildMessage(template) {
  const titleEl = document.getElementById('quick-title-select');
  const titleVal = titleEl ? (titleEl.value || 'Dokumentasi') : 'Dokumentasi';
  const ket = document.getElementById('keterangan-input')?.value?.trim() || '-';
  
  // Extract date without day name (e.g. "Senin, 25 Mei 2026" -> "25 Mei 2026")
  const tanggalSaja = currentDate.includes(',') ? currentDate.split(',')[1].trim() : currentDate;
  // Format time HH:MM:SS -> HH.MM
  const waktuMenit = currentTime.split(':').slice(0, 2).join('.');
  const pukulVal = document.getElementById('waktu-kegiatan-input')?.value?.trim() || '';

  return template.body
    .replace(/{judul}/g, titleVal)
    .replace(/{tanggal}/g, currentDate)
    .replace(/{tanggal_saja}/g, tanggalSaja)
    .replace(/{waktu}/g, currentTime)
    .replace(/{waktu_menit}/g, waktuMenit)
    .replace(/{pukul}/g, pukulVal)
    .replace(/{kota}/g, gpsData.city || 'Sragen')
    .replace(/{alamat}/g, gpsData.address || '-')
    .replace(/{lat}/g, gpsData.lat || '-')
    .replace(/{lng}/g, gpsData.lng || '-')
    .replace(/{keterangan}/g, ket);
}

function updateTemplatePreview() {
  const sel = document.getElementById('template-select');
  const preview = document.getElementById('template-preview');
  if (!sel || !preview) return;
  const idx = parseInt(sel.value);
  if (!isNaN(idx) && settings.templates[idx]) {
    preview.textContent = buildMessage(settings.templates[idx]);
  }
}

function setWaktuSekarang() {
  const pad = n => String(n).padStart(2,'0');
  const now = new Date();
  const waktuMenit = `${pad(now.getHours())}.${pad(now.getMinutes())}`;
  const waktuInp = document.getElementById('waktu-kegiatan-input');
  if (waktuInp) {
    waktuInp.value = `${waktuMenit} WIB s.d selesai`;
    updateTemplatePreview();
  }
}

function applyTimePreset(mode) {
  const waktuInp = document.getElementById('waktu-kegiatan-input');
  if (!waktuInp) return;
  
  const pad = n => String(n).padStart(2,'0');
  const now = new Date();
  
  let currentVal = waktuInp.value.trim();
  let startHour = now.getHours();
  let startMin = now.getMinutes();
  
  const timeRegex = /(\d{2})[.:](\d{2})/;
  const match = currentVal.match(timeRegex);
  if (match) {
    startHour = parseInt(match[1]);
    startMin = parseInt(match[2]);
  }
  
  const startTimeStr = `${pad(startHour)}.${pad(startMin)}`;
  
  if (mode === 'selesai') {
    waktuInp.value = `${startTimeStr} WIB s.d selesai`;
  } else if (typeof mode === 'number') {
    const startDate = new Date();
    startDate.setHours(startHour);
    startDate.setMinutes(startMin);
    
    const endDate = new Date(startDate.getTime() + mode * 60 * 1000);
    const endTimeStr = `${pad(endDate.getHours())}.${pad(endDate.getMinutes())}`;
    
    waktuInp.value = `${startTimeStr} WIB s.d ${endTimeStr} WIB`;
  }
  updateTemplatePreview();
}

async function shareWA() {
  const filled = gridPhotos.filter(Boolean);
  if (!currentPhoto && !filled.length) { showToast('Belum ada foto'); return; }

  // Reset modal step states
  document.getElementById('wa-modal-step1').style.display = 'block';
  document.getElementById('wa-modal-step2').style.display = 'none';

  // Build message preview
  const sel = document.getElementById('template-select');
  const idx = parseInt(sel?.value);
  let msg = '';
  if (!isNaN(idx) && settings.templates[idx]) {
    msg = buildMessage(settings.templates[idx]);
  }
  document.getElementById('wa-msg-preview').textContent = msg;

  // Draw thumbnail
  const thumb = document.getElementById('wa-thumb');
  let thumbSrc = currentPhoto;
  if (!thumbSrc && filled.length > 0) {
    thumbSrc = typeof filled[0] === 'object' ? filled[0].dataURL : filled[0];
  }
  if (thumbSrc) {
    const img = new Image();
    img.onload = () => {
      const ctx = thumb.getContext('2d');
      ctx.drawImage(img, 0, 0, thumb.width, thumb.height);
    };
    img.src = thumbSrc;
  }

  // Photo count label
  const labelSpan = document.querySelector('#wa-photo-label span');
  if (labelSpan) {
    labelSpan.textContent = currentLayout === 1 ? '1 foto siap dilampirkan' : `${filled.length} foto siap dilampirkan`;
  }

  // Show modal
  const modal = document.getElementById('wa-modal');
  modal.style.display = 'flex';
}

function closeWAModal() {
  document.getElementById('wa-modal').style.display = 'none';
}

async function doShareWA() {
  const sel = document.getElementById('template-select');
  const idx = parseInt(sel?.value);
  let msg = '';
  if (!isNaN(idx) && settings.templates[idx]) {
    msg = buildMessage(settings.templates[idx]);
  }

  // Build the photo dataURL using buildGridImage for all layouts
  let photoDataURL = await buildGridImage();

  // Copy text to clipboard so it can be pasted as caption on WhatsApp
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(msg);
    } else {
      const ta = document.createElement('textarea');
      ta.value = msg;
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  } catch(e) {
    console.warn('Gagal menyalin teks ke clipboard:', e);
  }

  // ── Coba Web Share API (kirim foto + teks sekaligus) ──
  if (photoDataURL && navigator.share && navigator.canShare) {
    try {
      // Convert dataURL → Blob → File
      const res = await fetch(photoDataURL);
      const blob = await res.blob();
      const file = new File([blob], `nexacam_${Date.now()}.jpg`, { type: 'image/jpeg' });

      if (navigator.canShare({ files: [file] })) {
        closeWAModal();
        // Share foto + teks via share sheet native HP
        await navigator.share({
          files: [file],
          text: msg,
          title: 'Laporan NexaCam'
        });
        showToast('Berhasil dibagikan!');
        return;
      }
    } catch(e) {
      if (e.name !== 'AbortError') {
        // Fallback ke metode manual
      } else {
        closeWAModal();
        return; // User membatalkan share
      }
    }
  }

  // ── Fallback: unduh foto + buka WA dengan petunjuk ──
  if (photoDataURL) {
    triggerDownload(photoDataURL, `nexacam_${Date.now()}.jpg`);
  }
  
  // Transition to step 2 for manual paste guidance
  document.getElementById('wa-modal-step1').style.display = 'none';
  document.getElementById('wa-modal-step2').style.display = 'block';
  showToast('📋 Foto diunduh & laporan disalin!');
}

function openDesktopWA() {
  window.open('https://web.whatsapp.com/', '_blank');
}

// ═══════════════════════════════════════════════════
//  SETTINGS UI
// ═══════════════════════════════════════════════════
function populateQuickTitles() {
  const sel = document.getElementById('quick-title-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Pilih Judul —</option>' +
    settings.quickTitles.map(t => `<option value="${t}">${t}</option>`).join('');
  if (current && settings.quickTitles.includes(current)) sel.value = current;
}

function renderSettings() {
  // Quick titles chips
  const wrap = document.getElementById('quick-titles-wrap');
  wrap.innerHTML = settings.quickTitles.map((t, i) =>
    `<div class="quick-title-tag">
      <span>${t}</span>
      <span class="del" onclick="removeTitle(${i})">×</span>
    </div>`
  ).join('');

  // Templates
  const list = document.getElementById('templates-list');
  list.innerHTML = settings.templates.map((t, i) =>
    `<div class="template-item">
      <div style="padding:8px 10px;display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border)">
        <input class="setting-block-name" value="${escHTML(t.name)}" oninput="settings.templates[${i}].name=this.value" placeholder="Nama template">
        <div class="btn-icon" style="font-size:13px; display: flex; align-items: center; justify-content: center;" onclick="removeTemplate(${i})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
        </div>
      </div>
      <div style="padding:8px 10px;">
        <textarea class="setting-textarea" rows="4" oninput="settings.templates[${i}].body=this.value">${escHTML(t.body)}</textarea>
      </div>
    </div>`
  ).join('');

}

function escHTML(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addQuickTitle() {
  const inp = document.getElementById('new-title-input');
  const val = inp.value.trim();
  if (!val) return;
  if (!settings.quickTitles.includes(val)) {
    settings.quickTitles.push(val);
    saveSettingsData();
    inp.value = '';
    renderSettings();
    populateQuickTitles();
  }
}

function removeTitle(i) {
  settings.quickTitles.splice(i, 1);
  saveSettingsData();
  renderSettings();
  populateQuickTitles();
}

function addTemplate() {
  settings.templates.push({ name: 'Template Baru', body: '*{judul}*\n{tanggal} {waktu}\n📍 {alamat}\n{keterangan}' });
  renderSettings();
}

function removeTemplate(i) {
  settings.templates.splice(i, 1);
  renderSettings();
}

function saveSettings() {
  saveSettingsData();
  populateQuickTitles();
  showToast('Pengaturan disimpan!');
}

// ═══════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Check if context is secure
  const isSecure = window.isSecureContext !== false && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  if (!isSecure || location.protocol === 'file:') {
    const warningBanner = document.getElementById('secure-context-warning');
    if (warningBanner) {
      warningBanner.style.display = 'block';
    }
  }

  loadSettings();
  startCamera();
  initGPS();
  populateQuickTitles();

  setInterval(() => {
    updateClock();
    updateTemplatePreview();
  }, 1000);
  updateClock();

  // Close WA modal on backdrop click
  document.getElementById('wa-modal').addEventListener('click', function(e) {
    if (e.target === this) closeWAModal();
  });

  // Handle title select change — update HUD
  document.getElementById('quick-title-select').addEventListener('change', function() {
    const title = this.value || 'NexaCam';
    document.getElementById('hud-title').textContent = title;
    onWatermarkFieldChange();
  });
});
