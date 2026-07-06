// Front de las dos herramientas de video de la Clase 5 (patrón calcado de video-wan.js /
// qwen-edit.js): subir un video (base64 → /api/upload-video), correr el workflow del
// server, y mostrar el resultado (<video> o, en modo "probar 1 frame", una <img> suelta).
//   · interpolateVideo()  → 🎞️ Suavizar / Slow motion (FILM VFI)
//   · video2video()       → 🎬 Reimaginar un video (vid2vid estilo Octavio)

// Sube un archivo de video al Colab y devuelve el nombre subido (cachea en hiddenId).
async function uploadVideoTo(fileInputId, hiddenId, statusId) {
    const fileInput = document.getElementById(fileInputId);
    const file = fileInput && fileInput.files && fileInput.files[0];
    const hidden = document.getElementById(hiddenId);
    const status = document.getElementById(statusId);
    if (hidden && hidden.value) return hidden.value; // ya subido, reusamos
    if (!file) return '';
    if (status) status.textContent = '⏳ Subiendo video al Colab...';
    const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
    const resp = await fetch(apiUrl('/api/upload-video'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, dataUrl })
    });
    const d = await resp.json();
    if (d.success && d.name) {
        if (hidden) hidden.value = d.name;
        if (status) status.textContent = `✅ Subido: ${d.name}`;
        Logger.info(`✓ Video subido: ${d.name}`);
        return d.name;
    }
    if (status) status.textContent = '❌ Error subiendo: ' + (d.error || 'desconocido');
    return '';
}

document.addEventListener('DOMContentLoaded', () => {
    // Al elegir archivo: resetea el nombre cacheado (fuerza re-subida del nuevo archivo).
    const resetOnPick = (fileInputId, hiddenId, statusId, msg) => {
        const fileInput = document.getElementById(fileInputId);
        if (!fileInput) return;
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            const hidden = document.getElementById(hiddenId);
            const status = document.getElementById(statusId);
            if (hidden) hidden.value = '';
            if (!file) return;
            if (status) status.textContent = `📎 ${file.name} — ${msg}`;
        });
    };
    resetOnPick('interpFile', 'interpVideoName', 'interpStatus', 'elegí el multiplicador y dale "Suavizar video".');
    resetOnPick('v2vFile', 'v2vVideoName', 'v2vFileStatus', 'escribí el prompt y dale "Reimaginar video".');

    // Sliders con display
    const v2vDenoise = document.getElementById('v2vDenoise');
    const v2vDenoiseVal = document.getElementById('v2vDenoiseVal');
    if (v2vDenoise && v2vDenoiseVal) {
        v2vDenoise.addEventListener('input', () => { v2vDenoiseVal.textContent = parseFloat(v2vDenoise.value).toFixed(2); });
    }
    const v2vCn = document.getElementById('v2vCnStrength');
    const v2vCnVal = document.getElementById('v2vCnStrengthVal');
    if (v2vCn && v2vCnVal) {
        v2vCn.addEventListener('input', () => { v2vCnVal.textContent = parseFloat(v2vCn.value).toFixed(2); });
    }

    // Toggle "probar 1 frame" <-> campo de cantidad de frames del video completo
    const previewChk = document.getElementById('v2vPreviewMode');
    const capGroup = document.getElementById('v2vFrameCapGroup');
    if (previewChk && capGroup) {
        const sync = () => { capGroup.style.display = previewChk.checked ? 'none' : 'block'; };
        previewChk.addEventListener('change', sync);
        sync();
    }
});

// Sube un archivo de imagen (no video) al Colab vía /api/upload-image y devuelve el nombre.
async function uploadImageFile(file) {
    if (!file) return '';
    const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
    const resp = await fetch(apiUrl('/api/upload-image'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, dataUrl })
    });
    const d = await resp.json();
    return (d.success && d.name) ? d.name : '';
}

// 🤖 Prompt de transición (Clase 5): frame inicial + frame final -> Qwen-VL describe
// cada uno y arma el prompt de la transición, que vuelca directo en #videoWanPrompt.
async function generateTransitionPrompt() {
    const status = document.getElementById('transStatus');
    const btn = document.getElementById('transBtn');
    const startFile = (document.getElementById('transStartFile') || {}).files?.[0];
    const endFile = (document.getElementById('transEndFile') || {}).files?.[0];
    const hint = (document.getElementById('transHint') || {}).value || '';

    if (!startFile || !endFile) {
        if (status) status.textContent = '❌ Subí las 2 imágenes (frame inicial y final).';
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Subiendo imágenes...'; }
    if (status) status.textContent = '📤 Subiendo frames al Colab...';

    try {
        const [startName, endName] = await Promise.all([uploadImageFile(startFile), uploadImageFile(endFile)]);
        if (!startName || !endName) {
            if (status) status.textContent = '❌ No pude subir alguna de las 2 imágenes.';
            return;
        }
        if (btn) btn.textContent = '⏳ Describiendo con Qwen-VL (puede tardar ~1-2 min)...';
        if (status) status.textContent = '🤖 Qwen-VL está mirando ambos frames...';
        const resp = await fetch(apiUrl('/api/video-transition-prompt'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frame_start: startName, frame_end: endName, hint })
        });
        const d = await resp.json();
        if (d.success && d.prompt) {
            const promptEl = document.getElementById('videoWanPrompt');
            if (promptEl) promptEl.value = d.prompt;
            if (status) status.textContent = '✅ Prompt generado y volcado abajo — revisalo antes de generar.';
            Logger.info(`🤖 Prompt de transición: ${d.prompt.slice(0, 80)}...`);
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo generar el prompt');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🤖 Generar prompt de transición'; }
    }
}

// 🎞️ Suavizar / Slow motion
async function interpolateVideo() {
    const status = document.getElementById('interpStatusMsg');
    const btn = document.getElementById('interpBtn');
    const resultEl = document.getElementById('interpResult');
    const dlLink = document.getElementById('interpDownload');

    const filename = await uploadVideoTo('interpFile', 'interpVideoName', 'interpStatus');
    if (!filename) {
        if (status) status.textContent = '❌ Elegí un video primero (botón "Elegir archivo").';
        return;
    }

    const multiplier = Number((document.querySelector('input[name="interpMultiplier"]:checked') || {}).value) || 2;
    const mode = (document.getElementById('interpModeSlowmo') && document.getElementById('interpModeSlowmo').checked) ? 'slowmo' : 'fluid';
    const sourceFps = Number((document.getElementById('interpSourceFps') || {}).value) || 24;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Interpolando...'; }
    if (resultEl) resultEl.style.display = 'none';
    if (dlLink) dlLink.style.display = 'none';
    if (status) status.textContent = '🎞️ Interpolando frames con FILM VFI en tu Colab (puede tardar, la 1ª vez baja el checkpoint de FILM)...';

    try {
        const resp = await fetch(apiUrl('/api/interpolate-video'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, multiplier, mode, sourceFps })
        });
        const d = await resp.json();
        if (d.success && d.url) {
            if (status) status.textContent = '✅ Video suavizado.';
            Logger.info(`🎞️ FILM VFI → ${d.filename}`);
            if (resultEl) { resultEl.src = d.url; resultEl.style.display = 'block'; }
            if (dlLink) { dlLink.href = d.url; dlLink.download = d.filename || 'interpolado.mp4'; dlLink.style.display = 'inline-block'; }
            if (typeof addToGallery === 'function') addToGallery(d.url);
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo interpolar el video');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🎞️ Suavizar video'; }
    }
}

// 🎬 Reimaginar un video (vid2vid Octavio)
async function video2video() {
    const status = document.getElementById('v2vStatus');
    const btn = document.getElementById('v2vBtn');
    const resultEl = document.getElementById('v2vResult');
    const previewImg = document.getElementById('v2vPreviewImg');
    const dlLink = document.getElementById('v2vDownload');
    const prompt = (document.getElementById('v2vPrompt') || {}).value || '';
    const negPrompt = (document.getElementById('v2vNegPrompt') || {}).value || '';
    const isPreview = !!(document.getElementById('v2vPreviewMode') && document.getElementById('v2vPreviewMode').checked);

    if (!prompt.trim()) {
        if (status) status.textContent = '❌ Escribí un prompt describiendo lo que querés ver.';
        return;
    }

    const filename = await uploadVideoTo('v2vFile', 'v2vVideoName', 'v2vFileStatus');
    if (!filename) {
        if (status) status.textContent = '❌ Elegí un video primero (botón "Elegir archivo").';
        return;
    }

    const frameLoadCap = isPreview ? 1 : (Number((document.getElementById('v2vFrameLoadCap') || {}).value) || 33);
    const payload = {
        filename,
        prompt,
        negative_prompt: negPrompt,
        denoise: Number((document.getElementById('v2vDenoise') || {}).value) || 0.3,
        frame_load_cap: frameLoadCap,
        force_rate: Number((document.getElementById('v2vForceRate') || {}).value) || 16,
        controlnet_strength: Number((document.getElementById('v2vCnStrength') || {}).value) || 0.8,
        preprocessor: (document.getElementById('v2vPreprocessor') || {}).value || 'DepthAnythingV2Preprocessor',
        film_multiplier: Number((document.getElementById('v2vFilmMultiplier') || {}).value) || 0
    };

    if (btn) { btn.disabled = true; btn.textContent = isPreview ? '⏳ Probando 1 frame...' : '⏳ Reimaginando...'; }
    if (resultEl) resultEl.style.display = 'none';
    if (previewImg) previewImg.style.display = 'none';
    if (dlLink) dlLink.style.display = 'none';
    if (status) status.textContent = isPreview
        ? '🧪 Probando 1 frame (rápido) antes del video completo...'
        : '🎬 Reimaginando el video en tu Colab (procesa TODOS los frames, puede tardar varios minutos)...';

    try {
        const resp = await fetch(apiUrl('/api/video2video'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await resp.json();
        if (d.success && d.url) {
            Logger.info(`🎬 vid2vid → ${d.filename}`);
            if (d.isPreviewFrame) {
                if (status) status.textContent = '✅ Frame de prueba listo — ajustá denoise/prompt y corré el video completo, o destildá "probar 1 frame".';
                if (previewImg) { previewImg.src = d.url; previewImg.style.display = 'block'; }
            } else {
                if (status) status.textContent = '✅ Video reimaginado.';
                if (resultEl) { resultEl.src = d.url; resultEl.style.display = 'block'; }
            }
            if (dlLink) { dlLink.href = d.url; dlLink.download = d.filename || 'v2v.png'; dlLink.style.display = 'inline-block'; }
            if (typeof addToGallery === 'function') addToGallery(d.url);
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo reimaginar el video');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🎬 Reimaginar video'; }
    }
}
