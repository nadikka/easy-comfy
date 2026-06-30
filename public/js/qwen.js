// Sección autónoma "Describir imagen → prompt" (Qwen-VL). Tiene su propio upload e imagen,
// independiente de ControlNet. Robusto al timing: el botón "Describir" sube la imagen si hace
// falta y recién ahí describe (un solo click hace todo, sin carreras).

// Sube el archivo elegido en #qwenFile al Colab y devuelve el nombre. Cachea en #qwenImage.
async function uploadQwenImage() {
    const fileInput = document.getElementById('qwenFile');
    const file = fileInput && fileInput.files && fileInput.files[0];
    const hidden = document.getElementById('qwenImage');
    const status = document.getElementById('qwenStatus');
    // Si ya está subida (mismo nombre) reusamos
    if (hidden && hidden.value) return hidden.value;
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
        Logger.info(`✓ Imagen para Qwen-VL subida: ${d.name}`);
        return d.name;
    }
    if (status) status.textContent = '❌ Error subiendo: ' + (d.error || 'desconocido');
    return '';
}

// Al elegir archivo: muestra miniatura y resetea el nombre (se sube al describir).
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('qwenFile');
    if (!fileInput) return;
    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        const hidden = document.getElementById('qwenImage');
        const status = document.getElementById('qwenStatus');
        if (hidden) hidden.value = '';            // fuerza re-subida de la nueva imagen
        if (!file) return;
        const thumb = document.getElementById('qwenThumb');
        if (thumb) {
            const r = new FileReader();
            r.onload = () => { thumb.src = r.result; thumb.style.display = 'inline-block'; };
            r.readAsDataURL(file);
        }
        if (status) status.textContent = `📎 ${file.name} — dale a "Describir".`;
        // Pre-subida en segundo plano (si falla, el botón la reintenta igual)
        uploadQwenImage().catch(() => {});
    });
});

// Sube (si hace falta) y corre el Qwen-VL. Un solo click hace todo.
async function describeQwen() {
    const status = document.getElementById('qwenStatus');
    const btn = document.getElementById('qwenBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Subiendo...'; }
    try {
        const image = await uploadQwenImage();
        if (!image) {
            if (status) status.textContent = '❌ Elegí una imagen primero (botón "Elegir archivo").';
            return;
        }
        if (btn) btn.textContent = '⏳ Describiendo...';
        if (status) status.textContent = '🔎 Describiendo con Qwen3-VL (la 1ª vez tarda ~1-1½ min)...';
        const resp = await fetch(apiUrl('/api/describe-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image })
        });
        const d = await resp.json();
        if (d.success && d.prompt) {
            const wrap = document.getElementById('qwenResultWrap');
            const ta = document.getElementById('qwenResult');
            if (ta) ta.value = d.prompt;
            if (wrap) wrap.style.display = 'block';
            if (status) status.textContent = '✅ Listo. Revisalo y dale "Usar como prompt".';
            Logger.info(`🔎 Qwen3-VL → prompt (${d.prompt.length} chars)`);
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo describir');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔎 Describir → prompt'; }
    }
}

// Copia la descripción a la caja de prompt principal.
function useQwenPrompt() {
    const ta = document.getElementById('qwenResult');
    const box = document.getElementById('prompt');
    if (ta && box) {
        box.value = ta.value;
        box.focus();
        Logger.info('⬇️ Prompt del Qwen-VL copiado a la caja de prompt');
        const status = document.getElementById('qwenStatus');
        if (status) status.textContent = '✅ Pegado en el prompt. Editá y generá.';
    }
}
