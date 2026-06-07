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
    // Populate the new watermark fields from settings
    if (document.getElementById('watermark-sst')) {
      document.getElementById('watermark-sst').value = settings.sst || 'PAGI';
    }
    if (document.getElementById('watermark-karupam')) {
      document.getElementById('watermark-karupam').value = settings.karupam || 'WIJOKO';
    }
    if (document.getElementById('watermark-rupam')) {
      document.getElementById('watermark-rupam').value = settings.rupam || 'RUPAM I';
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
function initGPS() {
  if (!navigator.geolocation) {
    gpsData.address = 'GPS tidak didukung';
    return;
  }
  navigator.geolocation.watchPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    gpsData.lat = lat.toFixed(6);
    gpsData.lng = lng.toFixed(6);
    gpsData.raw = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    updateGPSUI();
    await reverseGeocode(lat, lng);
  }, (err) => {
    gpsData.address = 'Lokasi tidak tersedia';
    gpsData.city = 'Sragen';
    document.getElementById('gps-pill').className = 'gps-pill searching';
    document.getElementById('gps-pill-text').textContent = 'GPS Off';
    document.getElementById('hud-gps').textContent = 'Lokasi tidak tersedia';
  }, { enableHighAccuracy: true, maximumAge: 10000 });
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

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=id`);
    const data = await res.json();
    
    let foundCity = '';
    if (data && data.display_name) {
      const parts = data.display_name.split(',');
      gpsData.address = parts.slice(0, 4).join(',').trim();
      
      // Look for city/kabupaten in display_name parts
      for (let part of parts) {
        part = part.trim();
        if (/Kabupaten|Kota/i.test(part)) {
          let c = part.replace(/Kabupaten\s+/i, '')
                      .replace(/Kota\s+/i, '')
                      .trim();
          if (c) {
            foundCity = c;
            break;
          }
        }
      }
    }
    
    // Backup check in data.address if display_name loop did not find it
    if (!foundCity && data && data.address) {
      let city = data.address.city || 
                 data.address.town || 
                 data.address.village || 
                 data.address.municipality ||
                 data.address.suburb ||
                 data.address.city_district ||
                 data.address.county || 
                 'Sragen';
      foundCity = city.replace(/Kabupaten\s+/i, '')
                      .replace(/Kota\s+/i, '')
                      .replace(/\sRegency/i, '')
                      .replace(/Kecamatan\s+/i, '')
                      .trim();
    }
    
    gpsData.city = foundCity || 'Sragen';
    updateGPSUI();
  } catch(e) {
    gpsData.address = `${gpsData.lat}, ${gpsData.lng}`;
    gpsData.city = 'Sragen';
    updateGPSUI();
  }
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
  
  renderResultCanvas(currentPhoto);
  goScreen('preview-screen');
  populateTemplateSelect();
  updateTemplatePreview();
  setLayout(currentLayout);
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

  // 3. Draw organization name inside header
  const orgName = (settings.orgName || 'ASTEKPAM LAPAS SRAGEN').toUpperCase();
  const words = orgName.split(' ');
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  
  if (words.length > 2) {
    ctx.font = `bold ${10.5 * scale}px 'Exo 2', 'Arial', sans-serif`;
    ctx.fillText(words.slice(0, 2).join(' '), x + 12 * scale, y + headerH / 2 - 6 * scale);
    ctx.fillText(words.slice(2).join(' '), x + 12 * scale, y + headerH / 2 + 7 * scale);
  } else {
    ctx.font = `bold ${13 * scale}px 'Exo 2', 'Arial', sans-serif`;
    ctx.fillText(orgName, x + 12 * scale, y + headerH / 2);
  }

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
  ctx.font = `bold ${12.5 * scale}px 'Exo 2', 'Arial', sans-serif`;
  ctx.fillStyle = '#ffffff';
  
  // Icon
  ctx.fillText('📍', detailX, detailY);

  // Wrap address text
  const addrWords = addrText.split(' ');
  let line = '';
  let lines = [];
  const maxLineW = rightColW - 16 * scale;

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

  // Draw wrapped lines (max 3 lines to fit beautifully)
  const maxAddrLines = 3;
  for (let j = 0; j < Math.min(lines.length, maxAddrLines); j++) {
    ctx.fillText(lines[j], detailX + 16 * scale, detailY);
    detailY += 15 * scale;
  }

  // Daerah
  ctx.fillText('🌐', detailX, detailY);
  const cityText = `Daerah ${gpsData.city || 'Sragen'}`;
  ctx.fillText(cityText, detailX + 16 * scale, detailY);
  detailY += 16 * scale;

  // SST
  ctx.fillText('⏱️', detailX, detailY);
  const sstVal = document.getElementById('watermark-sst')?.value?.trim() || settings.sst || 'PAGI';
  ctx.fillText(`SST: ${sstVal}`, detailX + 16 * scale, detailY);
  detailY += 16 * scale;

  // KARUPAM
  ctx.fillText('👤', detailX, detailY);
  const karupamVal = document.getElementById('watermark-karupam')?.value?.trim() || settings.karupam || 'WIJOKO';
  ctx.fillText(`KARUPAM ${karupamVal}`, detailX + 16 * scale, detailY);
  detailY += 16 * scale;

  // RUPAM
  ctx.fillText('👥', detailX, detailY);
  const rupamVal = document.getElementById('watermark-rupam')?.value?.trim() || settings.rupam || 'RUPAM I';
  ctx.fillText(rupamVal, detailX + 16 * scale, detailY);

  ctx.restore();
}



function onWatermarkFieldChange() {
  settings.sst = document.getElementById('watermark-sst').value.trim();
  settings.karupam = document.getElementById('watermark-karupam').value.trim();
  settings.rupam = document.getElementById('watermark-rupam').value.trim();
  saveSettingsData();

  if (currentLayout === 1) {
    if (currentPhoto) renderResultCanvas(currentPhoto);
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
    if (currentPhoto) renderResultCanvas(currentPhoto);
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
      slot.innerHTML = `<div class="add-icon">📷<span>Foto ${i+1}</span></div>`;
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
  if (currentLayout === 1) {
    if (!currentPhoto) { showToast('Belum ada foto'); return; }
    const dataURL = await renderResultCanvas(currentPhoto);
    triggerDownload(dataURL, `fieldcam_${Date.now()}.jpg`);
  } else {
    // Download composite grid
    const dataURL = await buildGridImage();
    triggerDownload(dataURL, `fieldcam_grid_${Date.now()}.jpg`);
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
  if (!filled.length) { showToast('Belum ada foto di grid'); return null; }

  const n = currentLayout;
  const cols = n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 2 : n <= 6 ? 3 : 3;
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

  // Yellow Bar Left Text (Lapas name, lowercased)
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 22px 'Exo 2', 'Arial', sans-serif`;
  const barLeftText = (settings.orgName || 'Lapas IIA Sragen').toLowerCase();
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

    if (gridPhotos[i]) {
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
          const photoObj = gridPhotos[i];
          drawMarkiWatermark(ctx, cx, cy, cellW, cellH, cellW / 1000, i, photoObj);

          resolve();
        };
        img.src = typeof gridPhotos[i] === 'object' ? gridPhotos[i].dataURL : gridPhotos[i];
      });
    } else {
      // Empty slot (gray placeholder)
      ctx.fillStyle = 'rgba(13, 20, 35, 0.95)';
      ctx.fillRect(cx, cy, cellW, cellH);
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.font = `48px 'Exo 2'`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📷', cx + cellW/2, cy + cellH/2 - 20);
      
      ctx.font = `20px 'Exo 2'`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillText(`Foto ${i+1}`, cx + cellW/2, cy + cellH/2 + 25);
    }
  }

  // 6. Draw White Footer (simplified plain white bar)
  const footerY = gridY + gridH;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, footerY, totalW, footerH);

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
  if (!currentPhoto && currentLayout === 1) { showToast('Belum ada foto'); return; }

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
  if (currentPhoto) {
    const img = new Image();
    img.onload = () => {
      const ctx = thumb.getContext('2d');
      ctx.drawImage(img, 0, 0, thumb.width, thumb.height);
    };
    img.src = currentPhoto;
  }

  // Photo count label
  if (currentLayout === 1) {
    document.getElementById('wa-photo-label').textContent = '📎 1 foto siap dilampirkan';
  } else {
    const n = gridPhotos.filter(Boolean).length;
    document.getElementById('wa-photo-label').textContent = `📎 ${n} foto siap dilampirkan`;
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

  // Build the photo dataURL
  let photoDataURL = null;
  if (currentLayout === 1 && currentPhoto) {
    photoDataURL = await renderResultCanvas(currentPhoto);
  } else if (currentLayout > 1) {
    photoDataURL = await buildGridImage();
  }

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
      const file = new File([blob], `fieldcam_${Date.now()}.jpg`, { type: 'image/jpeg' });

      if (navigator.canShare({ files: [file] })) {
        closeWAModal();
        // Share foto + teks via share sheet native HP
        await navigator.share({
          files: [file],
          text: msg,
          title: 'Laporan FieldCam'
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
    triggerDownload(photoDataURL, `fieldcam_${Date.now()}.jpg`);
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
        <div class="btn-icon" style="font-size:13px;" onclick="removeTemplate(${i})">🗑</div>
      </div>
      <div style="padding:8px 10px;">
        <textarea class="setting-textarea" rows="4" oninput="settings.templates[${i}].body=this.value">${escHTML(t.body)}</textarea>
      </div>
    </div>`
  ).join('');

  document.getElementById('org-name').value = settings.orgName || '';
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
  settings.orgName = document.getElementById('org-name').value.trim();
  if (document.getElementById('watermark-sst')) settings.sst = document.getElementById('watermark-sst').value.trim();
  if (document.getElementById('watermark-karupam')) settings.karupam = document.getElementById('watermark-karupam').value.trim();
  if (document.getElementById('watermark-rupam')) settings.rupam = document.getElementById('watermark-rupam').value.trim();
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
    const title = this.value || 'FieldCam';
    document.getElementById('hud-title').textContent = title;
    onWatermarkFieldChange();
  });
});
