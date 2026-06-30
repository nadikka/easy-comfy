// Sección autónoma "Editar imagen (Qwen-Image-Edit)". Subís una imagen + una
// instrucción ("ponele pelo azul", "cambiá el fondo a un bosque") y devuelve una
// imagen NUEVA editada. Pensada para los estados de Elena. Independiente del flujo
// de generación normal; el resultado entra a la galería como una imagen más.

// Sube el archivo elegido en #editFile al Colab y devuelve el nombre. Cachea en #editImage.
async function uploadEditImage() {
    const fileInput = document.getElementById('editFile');
    const file = fileInput && fileInput.files && fileInput.files[0];
    const hidden = document.getElementById('editImage');
    const status = document.getElementById('editStatus');
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
        Logger.info(`✓ Imagen para Qwen-Image-Edit subida: ${d.name}`);
        return d.name;
    }
    if (status) status.textContent = '❌ Error subiendo: ' + (d.error || 'desconocido');
    return '';
}

// Al elegir archivo: muestra miniatura y resetea el nombre (se sube al editar).
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('editFile');
    if (!fileInput) return;
    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        const hidden = document.getElementById('editImage');
        const status = document.getElementById('editStatus');
        if (hidden) hidden.value = '';            // fuerza re-subida de la nueva imagen
        if (!file) return;
        const thumb = document.getElementById('editThumb');
        if (thumb) {
            const r = new FileReader();
            r.onload = () => { thumb.src = r.result; thumb.style.display = 'inline-block'; };
            r.readAsDataURL(file);
        }
        if (status) status.textContent = `📎 ${file.name} — escribí la instrucción y dale "Editar".`;
        uploadEditImage().catch(() => {});        // pre-subida en segundo plano
    });
});

// Sube (si hace falta) y corre Qwen-Image-Edit. Un solo click hace todo.
async function editImageQwen() {
    const status = document.getElementById('editStatus');
    const btn = document.getElementById('editBtn');
    const instruction = (document.getElementById('editInstruction') || {}).value || '';
    if (!instruction.trim()) {
        if (status) status.textContent = '❌ Escribí qué querés cambiar (ej. "ponele pelo azul").';
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Subiendo...'; }
    try {
        const image = await uploadEditImage();
        if (!image) {
            if (status) status.textContent = '❌ Elegí una imagen primero (botón "Elegir archivo").';
            return;
        }
        const fast = !(document.getElementById('editFast') && document.getElementById('editFast').checked === false);
        if (btn) btn.textContent = '⏳ Editando...';
        if (status) status.textContent = '✏️ Editando con Qwen-Image-Edit (la 1ª vez tarda; carga el modelo en el Colab)...';
        const resp = await fetch(apiUrl('/api/edit-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image, instruction, fast })
        });
        const d = await resp.json();
        if (d.success && d.url) {
            if (status) status.textContent = '✅ Listo. La imagen editada está en la galería.';
            Logger.info(`✏️ Qwen-Image-Edit → ${d.filename}`);
            if (typeof addToGallery === 'function') addToGallery(d.url);
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo editar');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '✏️ Editar imagen'; }
    }
}
