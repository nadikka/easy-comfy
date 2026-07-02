// Sección autónoma "Video (Wan 2.2 — local, gratis)". Genera un video corto desde un
// prompt de texto o desde una imagen de partida, usando el modelo abierto Wan 2.2
// TI2V-5B con los nodos NATIVOS de ComfyUI (WanImageToVideo, sin custom node). El
// cómputo lo hace el Colab de Leo (local a la sesión), NO una API paga — sin costo
// por clip. Independiente del flujo de generación de imagen y de Seedance (video.js);
// el resultado se muestra como <video> reproducible + botón de descarga.

// Alterna el bloque de subida de imagen según el modo elegido (texto / imagen).
function videoWanOnModeChange() {
    const isImage = !!(document.getElementById('videoWanModeImage') && document.getElementById('videoWanModeImage').checked);
    const group = document.getElementById('videoWanImageGroup');
    if (group) group.style.display = isImage ? 'block' : 'none';
}

// Sube el archivo elegido en #videoWanFile al Colab y devuelve el nombre. Cachea en #videoWanImage.
async function uploadVideoWanRefImage() {
    const fileInput = document.getElementById('videoWanFile');
    const file = fileInput && fileInput.files && fileInput.files[0];
    const hidden = document.getElementById('videoWanImage');
    const status = document.getElementById('videoWanImageStatus');
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
        Logger.info(`✓ Imagen de partida para video Wan subida: ${d.name}`);
        return d.name;
    }
    if (status) status.textContent = '❌ Error subiendo: ' + (d.error || 'desconocido');
    return '';
}

document.addEventListener('DOMContentLoaded', () => {
    // Toggle texto/imagen
    const modeText = document.getElementById('videoWanModeText');
    const modeImage = document.getElementById('videoWanModeImage');
    if (modeText) modeText.addEventListener('change', videoWanOnModeChange);
    if (modeImage) modeImage.addEventListener('change', videoWanOnModeChange);

    // Slider de duración (frames): refleja el valor numérico al lado
    const lenSlider = document.getElementById('videoWanLength');
    const lenVal = document.getElementById('videoWanLengthVal');
    if (lenSlider && lenVal) {
        lenSlider.addEventListener('input', () => { lenVal.textContent = lenSlider.value; });
    }

    // Al elegir archivo: miniatura + resetea el nombre (se sube al generar)
    const fileInput = document.getElementById('videoWanFile');
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            const hidden = document.getElementById('videoWanImage');
            const status = document.getElementById('videoWanImageStatus');
            if (hidden) hidden.value = '';            // fuerza re-subida de la nueva imagen
            if (!file) return;
            const thumb = document.getElementById('videoWanThumb');
            if (thumb) {
                const r = new FileReader();
                r.onload = () => { thumb.src = r.result; thumb.style.display = 'inline-block'; };
                r.readAsDataURL(file);
            }
            if (status) status.textContent = `📎 ${file.name} — escribí el prompt y dale "Generar video".`;
            uploadVideoWanRefImage().catch(() => {});    // pre-subida en segundo plano
        });
    }
});

// Sube (si hace falta) y corre Wan 2.2 TI2V-5B local. Un solo click hace todo.
async function generateVideoWan() {
    const status = document.getElementById('videoWanStatus');
    const btn = document.getElementById('videoWanBtn');
    const resultEl = document.getElementById('videoWanResult');
    const dlLink = document.getElementById('videoWanDownload');
    const prompt = (document.getElementById('videoWanPrompt') || {}).value || '';
    const negPrompt = (document.getElementById('videoWanNegPrompt') || {}).value || '';
    const isImageMode = !!(document.getElementById('videoWanModeImage') && document.getElementById('videoWanModeImage').checked);

    if (!prompt.trim()) {
        if (status) status.textContent = '❌ Escribí un prompt describiendo el video.';
        return;
    }

    let image = '';
    if (isImageMode) {
        image = await uploadVideoWanRefImage();
        if (!image) {
            if (status) status.textContent = '❌ Elegí una imagen de partida primero (botón "Elegir archivo").';
            return;
        }
    }

    const payload = {
        prompt,
        negative_prompt: negPrompt,
        mode: isImageMode ? 'image' : 'text',
        image: image || undefined,
        width: Number((document.getElementById('videoWanWidth') || {}).value) || 832,
        height: Number((document.getElementById('videoWanHeight') || {}).value) || 480,
        length: Number((document.getElementById('videoWanLength') || {}).value) || 81,
        steps: Number((document.getElementById('videoWanSteps') || {}).value) || 20,
        cfg: Number((document.getElementById('videoWanCfg') || {}).value) || 5.0
    };

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
    if (resultEl) resultEl.style.display = 'none';
    if (dlLink) dlLink.style.display = 'none';
    if (status) status.textContent = '🎬 Generando video con Wan 2.2 en tu Colab (puede tardar varios minutos, corre en la GPU local del Colab, no en la nube paga)...';

    try {
        const resp = await fetch(apiUrl('/api/generate-video-wan'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await resp.json();
        if (d.success && d.url) {
            if (status) status.textContent = '✅ Video listo.';
            Logger.info(`🎬 Wan 2.2 → ${d.filename}`);
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
        if (btn) { btn.disabled = false; btn.textContent = '🎬 Generar video (Wan, gratis)'; }
    }
}
