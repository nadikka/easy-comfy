// restore.js — capa "Restaurar / más detalle" (4ª intención, Clase 4).
// Subís una foto y la agranda reconstruyendo detalle real: usa el MOTOR YA VALIDADO
// (img2img de diplocolab con denoise bajo + upscale 2x). NO agrega endpoint nuevo:
// reusa el pipeline de generación por WebSocket (ws/collectParams/galería de script.js).
// El resultado entra a la galería como una imagen más.

(function () {
    'use strict';

    // Sube #restoreFile al Colab y cachea el nombre en #restoreImage.
    async function uploadRestoreImage() {
        const fi = document.getElementById('restoreFile');
        const f = fi && fi.files && fi.files[0];
        const hidden = document.getElementById('restoreImage');
        const st = document.getElementById('restoreStatus');
        if (hidden && hidden.value) return hidden.value;     // ya subida, reusamos
        if (!f) return '';
        if (st) st.textContent = '⏳ Subiendo imagen al Colab...';
        const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(f);
        });
        const resp = await fetch(apiUrl('/api/upload-image'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.name, dataUrl })
        });
        const d = await resp.json();
        if (d.success && d.name) {
            if (hidden) hidden.value = d.name;
            if (st) st.textContent = `✅ Subida: ${d.name}`;
            if (typeof Logger !== 'undefined') Logger.info(`✓ Imagen para restaurar subida: ${d.name}`);
            return d.name;
        }
        if (st) st.textContent = '❌ Error subiendo: ' + (d.error || 'desconocido');
        return '';
    }

    // Sube (si hace falta) y dispara la restauración reusando el pipeline de generación.
    window.restoreImage = async function () {
        const btn = document.getElementById('restoreBtn');
        const st = document.getElementById('restoreStatus');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Subiendo...'; }
        try {
            const name = await uploadRestoreImage();
            if (!name) {
                if (st) st.textContent = '❌ Elegí una imagen primero.';
                if (btn) { btn.disabled = false; btn.textContent = '🔧 Restaurar imagen'; }
                return;
            }
            // Parto de los params del panel (defaults sensatos) y los piso para img2img.
            const params = (typeof collectParams === 'function') ? collectParams() : {};
            params.img2img = true;                 // usa la foto como base (latente inicial)
            params.ref_image = name;
            const dn = document.getElementById('restoreDenoise');
            params.denoise = dn ? parseFloat(dn.value) : 0.25;
            const um = document.getElementById('restoreUpscaleModel');
            if (um && um.value) params.upscale_model_name = um.value;
            if (params.seed === -1 && typeof randomSeed === 'function') params.seed = randomSeed();

            const prompt = ((document.getElementById('restorePrompt') || {}).value || '').trim()
                || 'high quality, sharp detail, restored, clean, fine grain';

            if (typeof showProgress === 'function') showProgress('📤 Enviando a restaurar...', 10);
            if (typeof Logger !== 'undefined') Logger.info(`🔧 Restaurar: img2img denoise=${params.denoise} upscale=${params.upscale_model_name || ''}`);

            window._restoring = true;
            ws.send(JSON.stringify({ type: 'generarImagen', prompt, workflow: 'diplocolab', params }));
            if (btn) btn.textContent = '⏳ Restaurando...';
            if (st) st.textContent = '🔧 Restaurando (img2img + upscale)… la 1ª vez tarda.';

            // Fallback: si algo falla y nunca llega imagen, re-habilito el botón a los ~6 min.
            setTimeout(() => {
                if (window._restoring) {
                    window._restoring = false;
                    if (btn) { btn.disabled = false; btn.textContent = '🔧 Restaurar imagen'; }
                }
            }, 360000);
        } catch (e) {
            if (st) st.textContent = '❌ ' + e.message;
            if (btn) { btn.disabled = false; btn.textContent = '🔧 Restaurar imagen'; }
            window._restoring = false;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        // Slider de denoise en vivo
        const dn = document.getElementById('restoreDenoise');
        const dv = document.getElementById('restoreDenoiseVal');
        if (dn && dv) dn.addEventListener('input', () => { dv.textContent = parseFloat(dn.value).toFixed(2); });

        // Al elegir archivo: miniatura + pre-subida en segundo plano
        const fi = document.getElementById('restoreFile');
        if (fi) fi.addEventListener('change', () => {
            const f = fi.files && fi.files[0];
            const hidden = document.getElementById('restoreImage');
            const st = document.getElementById('restoreStatus');
            if (hidden) hidden.value = '';     // fuerza re-subida de la nueva imagen
            if (!f) return;
            const thumb = document.getElementById('restoreThumb');
            if (thumb) {
                const r = new FileReader();
                r.onload = () => { thumb.src = r.result; thumb.style.display = 'inline-block'; };
                r.readAsDataURL(f);
            }
            if (st) st.textContent = `📎 ${f.name} — dale a "Restaurar".`;
            uploadRestoreImage().catch(() => {});
        });

        // Re-habilitar el botón cuando aparece una imagen nueva en la galería (fin de la restauración).
        const gal = document.getElementById('gallery');
        if (gal && window.MutationObserver) {
            new MutationObserver(() => {
                if (!window._restoring) return;
                window._restoring = false;
                const btn = document.getElementById('restoreBtn');
                const st = document.getElementById('restoreStatus');
                if (btn) { btn.disabled = false; btn.textContent = '🔧 Restaurar imagen'; }
                if (st) st.textContent = '✅ Listo. La imagen restaurada está en la galería.';
            }).observe(gal, { childList: true });
        }
    });
})();
