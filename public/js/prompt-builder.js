// prompt-builder.js — "Master Prompt Builder" (capa front, Clase 4 del Módulo 4).
// El profe lo llamó "la máquina de prompts": elegís estilo + cámara + detalles y se
// arma un sufijo EN INGLÉS que se agrega al final de tu prompt (va al user prompt).
// Es 100% navegador: NO toca el Colab. Los textos son fragmentos de prompt equivalentes
// a los presets del nodo Master Prompt Loader (los .TXT exactos viven dentro del pack;
// estos son ingeniería de prompt propia, ajustables).

(function () {
    'use strict';

    // Estilos (lista real de la Clase 4) → fragmento de prompt en inglés.
    const PB_STYLES = [
        { label: '— sin estilo —', frag: '' },
        { label: 'Fotorrealista', frag: 'photorealistic, realistic' },
        { label: 'Cinemático', frag: 'cinematic, film still' },
        { label: 'Óleo', frag: 'oil painting, visible brushstrokes' },
        { label: 'Acuarela', frag: 'watercolor painting, soft washes' },
        { label: 'Anime', frag: 'anime style' },
        { label: 'Estudio Ghibli', frag: 'in the style of Studio Ghibli, hand-painted, soft palette' },
        { label: 'Cyberpunk', frag: 'cyberpunk, neon, high tech low life' },
        { label: 'Vector flat design', frag: 'flat vector design, minimalist, clean shapes' },
        { label: 'Comic book', frag: 'comic book art, bold ink lines, halftone' },
        { label: '3D Pixar', frag: '3D Pixar-style render, soft global illumination' },
        { label: 'Digital painting', frag: 'digital painting, concept art' },
        { label: 'Poster soviético', frag: 'soviet propaganda poster style, constructivist' },
        { label: 'Pop art', frag: 'pop art, bold flat colors, Ben-Day dots' },
        { label: 'Anime moderno', frag: 'modern anime style, crisp lineart' },
        { label: 'Claymation / craft', frag: 'claymation, handcrafted stop-motion, plasticine' },
        { label: 'Retrato reflejo en vidrio', frag: 'portrait with glass reflection, layered' },
        { label: 'Doble exposición', frag: 'double exposure' },
        { label: 'Silueta monocromática', frag: 'abstract monochrome silhouette' },
        { label: 'Larga exposición', frag: 'long exposure photography, light trails' },
        { label: 'Paisaje surreal onírico', frag: 'dreamlike surreal landscape' },
        { label: 'Neon retro nocturno', frag: 'neon retro nightscape, synthwave' },
        { label: 'Morbid still life', frag: 'morbid still life, chiaroscuro' },
    ];

    // Cámara (lista real) → fragmento.
    const PB_CAMERAS = [
        { label: '— sin cámara —', frag: '' },
        { label: 'Sony A1 (editorial)', frag: 'shot on a Sony A1, editorial photography' },
        { label: 'Canon R5 (retratos)', frag: 'shot on a Canon R5, portrait photography' },
        { label: 'Fujifilm GFX 100 II (fine art)', frag: 'shot on a Fujifilm GFX 100 II, fine art detail' },
        { label: 'Leica SL3 (elegancia)', frag: 'shot on a Leica SL3, elegant tonal rendering' },
        { label: 'Hasselblad X2D (documental)', frag: 'shot on a Hasselblad X2D, documentary look' },
        { label: 'Golden Hour', frag: 'golden hour lighting, warm backlight' },
        { label: 'Intimidad', frag: 'intimate close framing' },
        { label: 'Compresión cinemática', frag: 'cinematic compression, telephoto lens' },
        { label: 'Profundidad tonal fine art', frag: 'fine art tonal depth' },
        { label: 'Elegancia óptica', frag: 'optical elegance, refined rendering' },
    ];

    // Toggles (subconjunto útil de los ~20 del nodo) → fragmento.
    const PB_TOGGLES = [
        { id: 'pbLight',   label: 'Iluminación cinematográfica', frag: 'cinematic lighting' },
        { id: 'pbDof',     label: 'Profundidad de campo (bokeh)', frag: 'shallow depth of field, bokeh' },
        { id: 'pbDetail',  label: 'Alta calidad / detalle',      frag: 'highly detailed, sharp focus, high quality' },
        { id: 'pbGrade',   label: 'Color grading',               frag: 'professional color grading' },
        { id: 'pbComp',    label: 'Composición equilibrada',     frag: 'balanced composition, rule of thirds' },
        { id: 'pbMotion',  label: 'Motion blur',                 frag: 'motion blur, slow shutter' },
        { id: 'pbFilm',    label: 'Grano de película',           frag: 'analog film grain, 35mm' },
        { id: 'pbNoWm',    label: 'Sin marca de agua ni texto',  frag: 'no watermark, no text' },
    ];

    function fillSelect(id, items) {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = items.map((it, i) => `<option value="${i}">${it.label}</option>`).join('');
    }

    // Compone el sufijo en inglés desde lo elegido.
    function pbCompose() {
        const parts = [];
        const st = document.getElementById('pbStyle');
        const cam = document.getElementById('pbCamera');
        if (st && PB_STYLES[st.value] && PB_STYLES[st.value].frag) parts.push(PB_STYLES[st.value].frag);
        if (cam && PB_CAMERAS[cam.value] && PB_CAMERAS[cam.value].frag) parts.push(PB_CAMERAS[cam.value].frag);
        PB_TOGGLES.forEach(t => {
            const cb = document.getElementById(t.id);
            if (cb && cb.checked) parts.push(t.frag);
        });
        return parts.join(', ');
    }

    function pbUpdatePreview() {
        const out = document.getElementById('pbPreview');
        if (!out) return;
        const s = pbCompose();
        out.textContent = s || '(elegí estilo, cámara o detalles)';
        out.classList.toggle('empty', !s);
    }

    // Agrega el sufijo al final del prompt principal (sin pisar lo escrito).
    window.pbApply = function () {
        const modifiers = pbCompose();
        if (!modifiers) return;
        const box = document.getElementById('prompt');
        if (!box) return;
        const cur = box.value.trim();
        box.value = cur ? (cur.replace(/,\s*$/, '') + ', ' + modifiers) : modifiers;
        box.focus();
        const st = document.getElementById('pbStatus');
        if (st) st.textContent = '✅ Agregado al prompt.';
        if (typeof Logger !== 'undefined') Logger.info('🎨 Master Prompt: modificadores agregados al prompt');
    };

    document.addEventListener('DOMContentLoaded', function () {
        fillSelect('pbStyle', PB_STYLES);
        fillSelect('pbCamera', PB_CAMERAS);
        ['pbStyle', 'pbCamera'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', pbUpdatePreview);
        });
        PB_TOGGLES.forEach(t => {
            const cb = document.getElementById(t.id);
            if (cb) cb.addEventListener('change', pbUpdatePreview);
        });
        pbUpdatePreview();
    });
})();
