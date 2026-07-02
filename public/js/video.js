// Sección autónoma "Video (Seedance 2.0)". Genera un video corto desde un prompt de
// texto o desde una imagen de referencia, usando los API nodes oficiales de ComfyUI
// (ByteDance2TextToVideoNode / ByteDance2ReferenceNode). El cómputo lo hace ByteDance
// en la nube vía la cuenta de comfy.org de Leo (consume créditos), NO el Colab.
// Independiente del flujo de generación de imagen; el resultado se muestra como
// <video> reproducible + botón de descarga (no entra a la galería de imágenes).

// Alterna el bloque de subida de imagen según el modo elegido (texto / imagen).
function videoOnModeChange() {
    const isImage = !!(document.getElementById('videoModeImage') && document.getElementById('videoModeImage').checked);
    const group = document.getElementById('videoImageGroup');
    if (group) group.style.display = isImage ? 'block' : 'none';
}

// Seedance 2.0 Fast no soporta 1080p — si el usuario tenía 1080p elegido, lo baja a 720p.
function videoOnModelChange() {
    const model = (document.getElementById('videoModel') || {}).value || 'Seedance 2.0';
    const resSel = document.getElementById('videoResolution');
    if (!resSel) return;
    const opt1080 = resSel.querySelector('option[value="1080p"]');
    if (model === 'Seedance 2.0 Fast') {
        if (opt1080) opt1080.disabled = true;
        if (resSel.value === '1080p') resSel.value = '720p';
    } else if (opt1080) {
        opt1080.disabled = false;
    }
}

// Sube el archivo elegido en #videoFile al Colab y devuelve el nombre. Cachea en #videoImage.
async function uploadVideoRefImage() {
    const fileInput = document.getElementById('videoFile');
    const file = fileInput && fileInput.files && fileInput.files[0];
    const hidden = document.getElementById('videoImage');
    const status = document.getElementById('videoImageStatus');
    if (hidden && hidden.value) return hidden.value;     // ya subida, reusamos
    if (!file) return '';
    if (status) status.textContent = '⏳ Subiendo imagen al Colab...';
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
    if (d.success && d.name) {
        if (hidden) hidden.value = d.name;
        if (status) status.textContent = `✅ Subida: ${d.name}`;
        Logger.info(`✓ Imagen de referencia para video subida: ${d.name}`);
        return d.name;
    }
    if (status) status.textContent = '❌ Error subiendo: ' + (d.error || 'desconocido');
    return '';
}

document.addEventListener('DOMContentLoaded', () => {
    // Toggle texto/imagen
    const modeText = document.getElementById('videoModeText');
    const modeImage = document.getElementById('videoModeImage');
    if (modeText) modeText.addEventListener('change', videoOnModeChange);
    if (modeImage) modeImage.addEventListener('change', videoOnModeChange);

    // Slider de duración: refleja el valor numérico al lado
    const durSlider = document.getElementById('videoDuration');
    const durVal = document.getElementById('videoDurationVal');
    if (durSlider && durVal) {
        durSlider.addEventListener('input', () => { durVal.textContent = durSlider.value; });
    }

    // Al elegir archivo: miniatura + resetea el nombre (se sube al generar)
    const fileInput = document.getElementById('videoFile');
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            const hidden = document.getElementById('videoImage');
            const status = document.getElementById('videoImageStatus');
            if (hidden) hidden.value = '';            // fuerza re-subida de la nueva imagen
            if (!file) return;
            const thumb = document.getElementById('videoThumb');
            if (thumb) {
                const r = new FileReader();
                r.onload = () => { thumb.src = r.result; thumb.style.display = 'inline-block'; };
                r.readAsDataURL(file);
            }
            if (status) status.textContent = `📎 ${file.name} — escribí el prompt y dale "Generar video".`;
            uploadVideoRefImage().catch(() => {});    // pre-subida en segundo plano
        });
    }
});

// Sube (si hace falta) y corre Seedance 2.0. Un solo click hace todo.
async function generateVideo() {
    const status = document.getElementById('videoStatus');
    const btn = document.getElementById('videoBtn');
    const resultEl = document.getElementById('videoResult');
    const dlLink = document.getElementById('videoDownload');
    const prompt = (document.getElementById('videoPrompt') || {}).value || '';
    const isImageMode = !!(document.getElementById('videoModeImage') && document.getElementById('videoModeImage').checked);

    if (!prompt.trim()) {
        if (status) status.textContent = '❌ Escribí un prompt describiendo el video.';
        return;
    }

    let image = '';
    if (isImageMode) {
        image = await uploadVideoRefImage();
        if (!image) {
            if (status) status.textContent = '❌ Elegí una imagen de referencia primero (botón "Elegir archivo").';
            return;
        }
    }

    const payload = {
        prompt,
        mode: isImageMode ? 'image' : 'text',
        image: image || undefined,
        model: (document.getElementById('videoModel') || {}).value || 'Seedance 2.0',
        resolution: (document.getElementById('videoResolution') || {}).value || '720p',
        ratio: (document.getElementById('videoRatio') || {}).value || '16:9',
        duration: Number((document.getElementById('videoDuration') || {}).value) || 7,
        generate_audio: !!(document.getElementById('videoAudio') && document.getElementById('videoAudio').checked)
    };

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
    if (resultEl) resultEl.style.display = 'none';
    if (dlLink) dlLink.style.display = 'none';
    if (status) status.textContent = '🎬 Generando video con Seedance 2.0 (puede tardar varios minutos)...';

    try {
        const resp = await fetch(apiUrl('/api/generate-video'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await resp.json();
        if (d.success && d.url) {
            if (status) status.textContent = '✅ Video listo.';
            Logger.info(`🎬 Seedance 2.0 → ${d.filename}`);
            if (resultEl) {
                resultEl.src = d.url;
                resultEl.style.display = 'block';
            }
            if (dlLink) {
                dlLink.href = d.url;
                dlLink.download = d.filename || 'video.mp4';
                dlLink.style.display = 'inline-block';
            }
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo generar el video');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🎬 Generar video'; }
    }
}
