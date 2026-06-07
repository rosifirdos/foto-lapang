// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let stream = null;
let facingMode = 'environment';
let currentPhoto = null;
let gpsData = { lat: null, lng: null, address: 'Mendapatkan alamat...', city: 'Sragen', raw: '' };
let currentLayout = 1;
let gridPhotos = [];
let currentTime = '';
let currentDate = '';
let gridCaptureMode = false;
let pendingGridSlot = null;

let settings = {
  quickTitles: ['Pemasangan Internet','Survey Lokasi','Perbaikan Jaringan','Inspeksi Lapangan','Dokumentasi Proyek'],
  templates: getNewDefaultTemplates(),
  orgName: 'FieldCam'
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
  pill.className = 'gps-pill';
  document.getElementById('gps-pill-text').textContent = `${gpsData.lat}, ${gpsData.lng}`;
  document.getElementById('hud-gps').textContent = `${gpsData.address} | ${gpsData.raw}`;
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=id`);
    const data = await res.json();
    if (data && data.display_name) {
      const parts = data.display_name.split(',');
      gpsData.address = parts.slice(0, 4).join(',').trim();
    }
    if (data && data.address) {
      let city = data.address.city || 
                 data.address.town || 
                 data.address.village || 
                 data.address.municipality ||
                 data.address.suburb ||
                 data.address.city_district ||
                 data.address.county || 
                 'Sragen';
      gpsData.city = city.replace(/Kabupaten\s+/i, '')
                         .replace(/Kota\s+/i, '')
                         .replace(/\sRegency/i, '')
                         .replace(/Kecamatan\s+/i, '')
                         .trim();
    } else {
      gpsData.city = 'Sragen';
    }
    updateGPSUI();
  } catch(e) {
    gpsData.address = `${gpsData.lat}, ${gpsData.lng}`;
    gpsData.city = 'Sragen';
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
    gridPhotos[idx] = dataURL;
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

      ctx.drawImage(img, 0, 0, W, H);

      // Bottom overlay bar height
      const scale = Math.min(W, H) / 360;
      const barH = Math.max(Math.floor(H * 0.22), Math.floor(115 * scale));
      const barY = H - barH;

      // Dark overlay
      const grad = ctx.createLinearGradient(0, barY - barH*0.5, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.4, 'rgba(0,0,0,0.75)');
      grad.addColorStop(1, 'rgba(0,0,0,0.92)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, barY - barH*0.5, W, H - (barY - barH*0.5));

      // Accent line
      ctx.fillStyle = '#00d4ff';
      ctx.fillRect(0, barY, W, 2);

      const titleEl = document.getElementById('quick-title-select');
      const titleVal = titleEl ? (titleEl.value || titleEl.options[titleEl.selectedIndex]?.text || 'FieldCam') : 'FieldCam';

      const pad = 14 * scale;
      let y = barY + 20 * scale;

      // Org name
      const orgName = settings.orgName || 'FieldCam';
      ctx.font = `bold ${11 * scale}px 'Arial'`;
      ctx.fillStyle = '#00d4ff';
      ctx.fillText(orgName.toUpperCase(), pad, y);
      y += 16 * scale;

      // Title
      ctx.font = `bold ${17 * scale}px 'Arial'`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(titleVal !== '— Pilih Judul —' ? titleVal : 'Dokumentasi', pad, y);
      y += 20 * scale;

      // Date time
      ctx.font = `${11 * scale}px 'Courier New'`;
      ctx.fillStyle = '#a8c8d8';
      ctx.fillText(`${currentDate}  ${currentTime}`, pad, y);
      y += 15 * scale;

      // Address
      ctx.font = `${11 * scale}px 'Courier New'`;
      ctx.fillStyle = '#00ff9d';
      const addr = gpsData.address || 'Lokasi tidak tersedia';
      const maxW = W - pad * 2;
      ctx.fillText(truncateText(ctx, addr, maxW), pad, y);
      y += 14 * scale;

      // Coords
      ctx.font = `${10 * scale}px 'Courier New'`;
      ctx.fillStyle = '#88bbcc';
      const coordText = gpsData.lat ? `${gpsData.lat}, ${gpsData.lng}` : 'GPS tidak tersedia';
      ctx.fillText(coordText, pad, y);
      y += 14 * scale;

      // Keterangan
      const ket = document.getElementById('keterangan-input')?.value?.trim();
      if (ket) {
        ctx.font = `${10 * scale}px 'Arial'`;
        ctx.fillStyle = '#ccddee';
        ctx.fillText(truncateText(ctx, ket, maxW), pad, y);
      }

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = photoDataURL;
  });
}

function truncateText(ctx, text, maxWidth) {
  return truncateCtxText(ctx, text, maxWidth);
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
  if (currentPhoto && !gridPhotos[0]) gridPhotos[0] = currentPhoto;

  for (let i = 0; i < n; i++) {
    const slot = document.createElement('div');
    slot.className = 'grid-photo-slot' + (gridPhotos[i] ? ' has-photo' : '');
    const idx = i;

    if (gridPhotos[i]) {
      // Render stamped mini canvas per slot
      const c = document.createElement('canvas');
      c.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;';
      slot.appendChild(c);
      renderStampedSlot(c, gridPhotos[i], i);

      const del = document.createElement('div');
      del.className = 'del-btn';
      del.textContent = '×';
      del.onclick = (e) => { e.stopPropagation(); gridPhotos[idx] = null; if (idx === 0) currentPhoto = null; renderMultiGrid(n); };
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
    const W = 600, H = 450;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Draw photo (cover)
    const scale = Math.max(W/img.width, H/img.height);
    const dw = img.width*scale, dh = img.height*scale;
    ctx.drawImage(img, (W-dw)/2, (H-dh)/2, dw, dh);

    // Bottom gradient
    const gr = ctx.createLinearGradient(0, H*0.52, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);

    // Accent line
    const lineGr = ctx.createLinearGradient(0, 0, W, 0);
    lineGr.addColorStop(0, '#00d4ff');
    lineGr.addColorStop(0.5, '#00ff9d');
    lineGr.addColorStop(1, '#00d4ff');
    ctx.fillStyle = lineGr;
    ctx.fillRect(0, H - 3, W, 3);

    const titleEl = document.getElementById('quick-title-select');
    const titleVal = (titleEl?.value && titleEl.value !== '— Pilih Judul —') ? titleEl.value : 'Dokumentasi';
    const orgName = (settings.orgName || 'FieldCam').toUpperCase();
    const addr = gpsData.address || 'Lokasi tidak tersedia';

    const p = 10;
    let y = H - 120;

    // Org + slot number badge
    ctx.font = `bold 11px Arial`;
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(orgName, p, y);
    // Badge
    ctx.fillStyle = 'rgba(0,212,255,0.7)';
    ctx.beginPath(); ctx.arc(W - p - 14, y - 7, 14, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold 13px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(slotIndex + 1, W - p - 14, y - 2);
    ctx.textAlign = 'left';
    y += 18;

    // Title
    ctx.font = `bold 15px Arial`;
    ctx.fillStyle = '#fff';
    ctx.fillText(truncateText(ctx, titleVal, W - p*2), p, y);
    y += 18;

    // Datetime
    ctx.font = `10px 'Courier New'`;
    ctx.fillStyle = 'rgba(168,200,216,0.9)';
    ctx.fillText(`${currentDate}  ${currentTime}`, p, y);
    y += 15;

    // GPS
    ctx.font = `10px 'Courier New'`;
    ctx.fillStyle = 'rgba(0,255,157,0.9)';
    ctx.fillText(truncateText(ctx, addr, W - p*2), p, y);
    y += 14;

    // Coords
    if (gpsData.lat) {
      ctx.font = `9px 'Courier New'`;
      ctx.fillStyle = 'rgba(136,187,204,0.8)';
      ctx.fillText(`${gpsData.lat}, ${gpsData.lng}`, p, y);
    }
  };
  img.src = photoDataURL;
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

  const ket = document.getElementById('keterangan-input')?.value?.trim() || '';

  const n = currentLayout;
  const cols = n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 2 : n <= 6 ? 3 : 3;
  const rows = Math.ceil(n / cols);

  // Cell size
  const cellW = 900, cellH = 680;
  const gap = 8;
  const pad = 20; // outer padding

  // Bottom info panel
  const panelH = ket ? 280 : 220;

  const totalW = pad*2 + cols*cellW + (cols-1)*gap;
  const totalH = pad*2 + rows*cellH + (rows-1)*gap + gap + panelH;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // ── Background ──
  // Dark gradient bg
  const bgGrad = ctx.createLinearGradient(0, 0, 0, totalH);
  bgGrad.addColorStop(0, '#0a0f16');
  bgGrad.addColorStop(1, '#060a0e');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, totalW, totalH);

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(0,212,255,0.04)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < totalW; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, totalH); ctx.stroke();
  }
  for (let gy = 0; gy < totalH; gy += 40) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(totalW, gy); ctx.stroke();
  }

  // Top accent bar
  const topBarGrad = ctx.createLinearGradient(0, 0, totalW, 0);
  topBarGrad.addColorStop(0, '#00d4ff');
  topBarGrad.addColorStop(0.5, '#00ff9d');
  topBarGrad.addColorStop(1, '#00d4ff');
  ctx.fillStyle = topBarGrad;
  ctx.fillRect(0, 0, totalW, 4);

  // ── Draw each photo cell with mini stamp ──
  const titleEl = document.getElementById('quick-title-select');
  const titleVal = (titleEl?.value && titleEl.value !== '— Pilih Judul —') ? titleEl.value : 'Dokumentasi';
  const orgName = (settings.orgName || 'FieldCam').toUpperCase();
  const addr = gpsData.address || 'Lokasi tidak tersedia';
  const coords = gpsData.lat ? `${gpsData.lat}, ${gpsData.lng}` : 'GPS tidak tersedia';

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = pad + col * (cellW + gap);
    const cy = pad + row * (cellH + gap);

    // Cell background
    ctx.fillStyle = '#111820';
    roundRect(ctx, cx, cy, cellW, cellH, 10);
    ctx.fill();

    if (gridPhotos[i]) {
      await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          // Clip to rounded rect
          ctx.save();
          roundRect(ctx, cx, cy, cellW, cellH, 10);
          ctx.clip();

          // Draw photo (cover fit)
          const iw = img.width, ih = img.height;
          const scale = Math.max(cellW/iw, cellH/ih);
          const dw = iw*scale, dh = ih*scale;
          const dx = cx + (cellW - dw)/2;
          const dy = cy + (cellH - dh)/2;
          ctx.drawImage(img, dx, dy, dw, dh);

          // Bottom gradient overlay per cell
          const cellGrad = ctx.createLinearGradient(0, cy + cellH*0.55, 0, cy + cellH);
          cellGrad.addColorStop(0, 'rgba(0,0,0,0)');
          cellGrad.addColorStop(1, 'rgba(0,0,0,0.82)');
          ctx.fillStyle = cellGrad;
          ctx.fillRect(cx, cy, cellW, cellH);

          // Accent line at bottom of cell
          ctx.fillStyle = '#00d4ff';
          ctx.fillRect(cx, cy + cellH - 3, cellW, 3);

          ctx.restore();

          // Mini stamp: photo number badge
          const bR = 22;
          ctx.fillStyle = 'rgba(0,212,255,0.85)';
          ctx.beginPath();
          ctx.arc(cx + 16 + bR, cy + 16 + bR, bR, 0, Math.PI*2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.font = `bold ${18}px Arial`;
          ctx.textAlign = 'center';
          ctx.fillText(i+1, cx + 16 + bR, cy + 16 + bR + 6);
          ctx.textAlign = 'left';

          // Mini timestamp bottom-left of cell
          const ts = `${currentDate}  ${currentTime}`;
          ctx.font = `${11}px 'Courier New'`;
          ctx.fillStyle = 'rgba(168,200,216,0.9)';
          ctx.fillText(ts, cx + 10, cy + cellH - 32);

          // Mini GPS bottom-left
          ctx.font = `${11}px 'Courier New'`;
          ctx.fillStyle = 'rgba(0,255,157,0.9)';
          const shortAddr = truncateCtxText(ctx, addr, cellW - 20);
          ctx.fillText(shortAddr, cx + 10, cy + cellH - 16);

          resolve();
        };
        img.src = gridPhotos[i];
      });
    } else {
      // Empty slot
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      roundRect(ctx, cx, cy, cellW, cellH, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font = `28px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('📷', cx + cellW/2, cy + cellH/2 + 10);
      ctx.font = `14px Arial`;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillText(`Foto ${i+1}`, cx + cellW/2, cy + cellH/2 + 36);
      ctx.textAlign = 'left';
    }

    // Cell border
    ctx.strokeStyle = 'rgba(0,212,255,0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, cx, cy, cellW, cellH, 10);
    ctx.stroke();
  }

  // ── Bottom Info Panel ──
  const panelY = pad + rows*cellH + (rows-1)*gap + gap;

  // Panel background
  const panelGrad = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
  panelGrad.addColorStop(0, 'rgba(13,18,25,0.98)');
  panelGrad.addColorStop(1, 'rgba(8,12,16,0.98)');
  ctx.fillStyle = panelGrad;
  roundRect(ctx, pad, panelY, totalW - pad*2, panelH, 12);
  ctx.fill();

  // Panel border
  ctx.strokeStyle = 'rgba(0,212,255,0.25)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, pad, panelY, totalW - pad*2, panelH, 12);
  ctx.stroke();

  // Panel top accent
  ctx.fillStyle = '#00d4ff';
  ctx.fillRect(pad + 12, panelY, 60, 3);

  const px = pad + 24;
  let py = panelY + 28;
  const pW = totalW - pad*2 - 48;
  const col2X = px + pW * 0.5 + 20;

  // Org name
  ctx.font = `bold 13px Arial`;
  ctx.fillStyle = '#00d4ff';
  ctx.fillText(orgName, px, py);

  // Photo count badge right side
  const countTxt = `${filled.length} FOTO`;
  ctx.font = `bold 11px Arial`;
  const cw = ctx.measureText(countTxt).width + 20;
  ctx.fillStyle = 'rgba(0,212,255,0.15)';
  roundRect(ctx, totalW - pad - cw - 12, panelY + 14, cw, 22, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,212,255,0.4)';
  ctx.lineWidth = 1;
  roundRect(ctx, totalW - pad - cw - 12, panelY + 14, cw, 22, 5);
  ctx.stroke();
  ctx.fillStyle = '#00d4ff';
  ctx.textAlign = 'center';
  ctx.fillText(countTxt, totalW - pad - cw/2 - 12, panelY + 29);
  ctx.textAlign = 'left';

  py += 28;

  // Title big
  ctx.font = `bold 26px Arial`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(truncateCtxText(ctx, titleVal, pW), px, py);
  py += 34;

  // Divider
  ctx.fillStyle = 'rgba(0,212,255,0.15)';
  ctx.fillRect(px, py, pW, 1);
  py += 14;

  // Left col: datetime
  ctx.font = `bold 11px Arial`;
  ctx.fillStyle = 'rgba(100,150,175,0.8)';
  ctx.fillText('📅 WAKTU', px, py);
  ctx.font = `13px 'Courier New'`;
  ctx.fillStyle = '#c8dde8';
  ctx.fillText(currentDate, px, py + 16);
  ctx.font = `bold 15px 'Courier New'`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(currentTime, px, py + 34);

  // Right col: GPS coords
  ctx.font = `bold 11px Arial`;
  ctx.fillStyle = 'rgba(100,150,175,0.8)';
  ctx.fillText('🌐 KOORDINAT', col2X, py);
  ctx.font = `12px 'Courier New'`;
  ctx.fillStyle = '#00ff9d';
  if (gpsData.lat) {
    ctx.fillText(`LAT  ${gpsData.lat}`, col2X, py + 16);
    ctx.fillText(`LNG  ${gpsData.lng}`, col2X, py + 32);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('GPS tidak tersedia', col2X, py + 16);
  }

  py += 50;

  // Divider
  ctx.fillStyle = 'rgba(0,212,255,0.15)';
  ctx.fillRect(px, py, pW, 1);
  py += 14;

  // Address full width
  ctx.font = `bold 11px Arial`;
  ctx.fillStyle = 'rgba(100,150,175,0.8)';
  ctx.fillText('📍 LOKASI', px, py);
  py += 16;
  ctx.font = `12px Arial`;
  ctx.fillStyle = '#00ff9d';
  ctx.fillText(truncateCtxText(ctx, addr, pW), px, py);
  py += 20;

  // Keterangan if exists
  if (ket) {
    ctx.font = `bold 11px Arial`;
    ctx.fillStyle = 'rgba(100,150,175,0.8)';
    ctx.fillText('📝 KETERANGAN', px, py);
    py += 16;
    ctx.font = `12px Arial`;
    ctx.fillStyle = '#e8f4f8';
    ctx.fillText(truncateCtxText(ctx, ket, pW), px, py);
  }

  // Bottom accent bar
  ctx.fillStyle = topBarGrad;
  ctx.fillRect(0, totalH - 4, totalW, 4);

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
  });
});
