// ── Familias de preprocesadores ControlNet ──
// Una sola fuente de datos para: (a) colorear la lista del dropdown,
// (b) la leyenda de colores, (c) la guía (modal). Categoriza por palabras
// clave en el nombre, así "contempla todos" los que reporte el backend.

const PREPROC_FAMILIES = [
    {
        key: 'canny', label: 'Bordes duros', color: '#2563eb', dot: '🔵',
        match: ['canny'],
        desc: 'Bordes nítidos (líneas blancas sobre negro). Máxima fidelidad de contorno.',
        use: 'Objetos, arquitectura, lowpoly, cualquier cosa con formas definidas. Ajustás low/high threshold para más o menos detalle.',
        tags: [{ t: 'el más usado', c: '#f59e0b' }, { t: 'preciso', c: '#2563eb' }]
    },
    {
        key: 'softedge', label: 'Bordes suaves / sketch', color: '#16a34a', dot: '🟢',
        match: ['hed', 'pidinet', 'teed', 'softedge', 'soft_edge', 'scribble', 'anyline', 'xdog', 'fakescribble'],
        desc: 'Bordes blandos y orgánicos (no binarios). Respeta texturas y transiciones.',
        use: 'Retratos, pelo, naturaleza, o cuando Canny queda muy rígido. Scribble = guía muy laxa, parte de un garabato.',
        tags: [{ t: 'para retratos', c: '#16a34a' }, { t: 'suave', c: '#64748b' }]
    },
    {
        key: 'lineart', label: 'Line art', color: '#9333ea', dot: '🟣',
        match: ['lineart', 'line_art', 'manga', 'anime'],
        desc: 'Extrae el dibujo de líneas limpio (como entintado).',
        use: 'Ilustración, anime, cómic — cuando querés conservar el dibujo de líneas.',
        tags: [{ t: 'ilustración / anime', c: '#9333ea' }]
    },
    {
        key: 'mlsd', label: 'Rectas', color: '#ea580c', dot: '🟠',
        match: ['mlsd', 'm-lsd'],
        desc: 'Solo líneas rectas. Ignora curvas.',
        use: 'Interiores, edificios, geometría — donde importan las rectas.',
        tags: [{ t: 'interiores / arquitectura', c: '#ea580c' }]
    },
    {
        key: 'depth', label: 'Profundidad', color: '#b45309', dot: '🟤',
        match: ['depth'],
        desc: 'Mapa de profundidad: claro = cerca, oscuro = lejos. Conserva volumen y disposición espacial, no los detalles.',
        use: 'Paisajes, escenas con primer plano/fondo, dar sensación 3D sin atarte a los bordes exactos. Depth Anything V2 es el mejor hoy.',
        tags: [{ t: 'muy usado', c: '#f59e0b' }, { t: 'algunos lentos', c: '#dc2626' }]
    },
    {
        key: 'normal', label: 'Normales', color: '#0891b2', dot: '🩵',
        match: ['normal'],
        desc: 'Mapa de normales: orientación de cada superficie. Más relieve que depth.',
        use: 'Cuando querés conservar el relieve fino / iluminación de la referencia.',
        tags: [{ t: 'relieve / 3D', c: '#0891b2' }]
    },
    {
        key: 'pose', label: 'Pose humana', color: '#dc2626', dot: '🔴',
        match: ['openpose', 'dwpose', 'dwpre', 'densepose', 'animalpose', 'pose'],
        desc: 'Detecta el esqueleto (articulaciones). Ignora ropa y fondo: solo la pose.',
        use: 'Personajes en una pose específica sin copiar la apariencia. DWPose es el más preciso; AnimalPose para animales.',
        tags: [{ t: 'muy usado', c: '#f59e0b' }, { t: 'personajes', c: '#dc2626' }]
    },
    {
        key: 'seg', label: 'Segmentación', color: '#ca8a04', dot: '🟡',
        match: ['semseg', 'seg', 'oneformer', 'uniformer'],
        desc: 'Divide la escena en regiones por tipo de objeto (cielo, persona, edificio…).',
        use: 'Escenas complejas donde querés controlar QUÉ va en cada zona.',
        tags: [{ t: 'escenas complejas', c: '#ca8a04' }, { t: 'avanzado', c: '#7c3aed' }]
    },
    {
        key: 'color', label: 'Color / Tile / Recolor', color: '#6b7280', dot: '⚪',
        match: ['color', 'tile', 'recolor', 'luminance', 'intensity', 'shuffle', 'palette'],
        desc: 'Conservan color, textura o composición tonal en vez de la forma.',
        use: 'Tile para upscale con detalle; Color/Palette para guiar la paleta; Shuffle para transferir estilo.',
        tags: [{ t: 'estilo / upscale', c: '#6b7280' }]
    },
    {
        key: 'face', label: 'Cara (mesh)', color: '#db2777', dot: '🩷',
        match: ['face', 'mesh'],
        desc: 'Malla facial detallada (MediaPipe). Rasgos y expresión.',
        use: 'Retratos donde importa la expresión exacta.',
        tags: [{ t: 'retratos', c: '#db2777' }]
    },
];

const PREPROC_OTHER = { key: 'otros', label: 'Otros', color: '#94a3b8', dot: '⚫', desc: 'Preprocesadores menos comunes o utilitarios.', use: '', tags: [] };

// Devuelve la familia de un preprocesador por su nombre (substring, case-insensitive)
function preprocFamily(name) {
    const n = (name || '').toLowerCase();
    for (const f of PREPROC_FAMILIES) {
        if (f.match.some(m => n.includes(m))) return f;
    }
    return PREPROC_OTHER;
}

// Colorea un <option> según su familia y le antepone el punto de color
function colorizePreprocOption(opt) {
    const fam = preprocFamily(opt.value);
    opt.style.color = fam.color;
    opt.style.fontWeight = '600';
    if (!opt.textContent.startsWith(fam.dot)) {
        opt.textContent = `${fam.dot} ${opt.value}`;
    }
}

// Recolorea todas las opciones actuales del dropdown (sirve para el fallback offline)
function colorizeExistingPreprocOptions() {
    const sel = document.getElementById('preprocessor');
    if (!sel) return;
    Array.from(sel.options).forEach(colorizePreprocOption);
}

// Renderiza la leyenda de colores debajo del dropdown
function renderPreprocLegend() {
    const wrap = document.getElementById('preprocLegend');
    if (!wrap) return;
    wrap.innerHTML = PREPROC_FAMILIES.map(f =>
        `<span class="lg-item"><span class="lg-dot" style="background:${f.color}"></span>${f.label}</span>`
    ).join('');
}

// Construye el cuerpo del modal de la guía desde los datos de familias
function renderPreprocGuide() {
    const body = document.getElementById('preprocGuideBody');
    if (!body) return;
    const intro = `<p class="intro">El <b>preprocesador</b> extrae UNA característica de tu imagen de referencia (bordes, profundidad, pose…) y el ControlNet usa eso para guiar la generación. No copia la imagen: copia su <i>estructura</i>. En el desplegable cada preprocesador está <b>coloreado por familia</b> (mismos colores que acá). Elegí según QUÉ querés conservar de la referencia.</p>`;
    const cards = PREPROC_FAMILIES.map(f => {
        const tags = (f.tags || []).map(tg => `<span class="pp-tag" style="background:${tg.c}">${tg.t}</span>`).join('');
        return `<div class="pp-card" style="border-left-color:${f.color}">
            <h4><span class="pp-dot" style="background:${f.color}"></span>${f.label} ${tags}</h4>
            <p>${f.desc}</p>
            <p class="pp-use">Usalo para: <span style="color:#555;font-weight:400">${f.use}</span></p>
        </div>`;
    }).join('');
    const tip = `<p class="intro" style="margin-top:18px;margin-bottom:0;">💡 <b>Tip:</b> ahora la <b>vista previa se actualiza sola</b> cuando cambiás de preprocesador (con una imagen subida). Así ves al toque qué extrae cada uno. El <b>ControlNet strength</b> NO cambia la vista previa — eso solo se nota en el resultado final.</p>`;
    body.innerHTML = intro + cards + tip;
}

// ── Preprocesadores DEDICADOS (los 7 con parámetros propios) ──
// Mirror del RICH_PREPROCS del server. Cada uno define sus controles.
const PP_RICH = {
    "CannyEdgePreprocessor": [
        { k: "low_threshold", label: "Low threshold", t: "range", min: 0, max: 255, step: 1, def: 100,
          tip: "Piso de detección de bordes. Bajarlo capta más líneas (más ruido); recomendado 100." },
        { k: "high_threshold", label: "High threshold", t: "range", min: 0, max: 255, step: 1, def: 200,
          tip: "Techo de detección de bordes. Subirlo deja solo los bordes más marcados; recomendado 200." },
    ],
    "LineartStandardPreprocessor": [
        { k: "guassian_sigma", label: "Gaussian sigma", t: "range", min: 0, max: 30, step: 0.5, def: 6.0,
          tip: "Cuánto se difumina antes de extraer la línea. Más alto = trazo más limpio y menos detalle fino. Recomendado 6.0." },
        { k: "intensity_threshold", label: "Intensity threshold", t: "range", min: 0, max: 16, step: 1, def: 8,
          tip: "Sensibilidad para marcar una línea como tal. Más alto = menos líneas (solo las fuertes). Recomendado 8." },
    ],
    "DepthAnythingV2Preprocessor": [
        { k: "ckpt_name", label: "Modelo (tamaño)", t: "select", def: "depth_anything_v2_vitl.pth",
          opts: ["depth_anything_v2_vits.pth", "depth_anything_v2_vitb.pth", "depth_anything_v2_vitl.pth", "depth_anything_v2_vitg.pth"],
          tip: "Tamaño del modelo de profundidad: vits = rápido/menos preciso, vitl = buen balance (recomendado), vitg = más preciso y lento." },
    ],
    "MiDaS-NormalMapPreprocessor": [
        { k: "a", label: "a (ángulo)", t: "range", min: 0, max: 15.7, step: 0.1, def: 6.28,
          tip: "Ángulo de sensibilidad del mapa de normales. 6.28 (≈2π) es el valor estándar; no suele hacer falta tocarlo." },
        { k: "bg_threshold", label: "BG threshold", t: "range", min: 0, max: 1, step: 0.05, def: 0.1,
          tip: "Umbral para separar fondo de figura. Más alto = más superficie tratada como fondo plano. Recomendado 0.1." },
    ],
    "DWPreprocessor": [
        { k: "detect_body", label: "Cuerpo", t: "toggle", def: "enable",
          tip: "Detecta el esqueleto del cuerpo (hombros, brazos, piernas). Dejalo activado salvo que solo te interese cara/manos." },
        { k: "detect_hand", label: "Manos", t: "toggle", def: "enable",
          tip: "Detecta la pose de las manos. Apagalo si te da manos raras o no te importa esa zona." },
        { k: "detect_face", label: "Cara", t: "toggle", def: "enable",
          tip: "Detecta los puntos de la cara. Apagalo si solo te interesa la pose del cuerpo." },
    ],
    "HEDPreprocessor": [
        { k: "safe", label: "Safe (suaviza)", t: "toggle", def: "enable",
          tip: "Modo 'safe': suaviza los bordes para una guía más laxa. Apagalo para bordes más crudos y detallados." },
    ],
    "TTPlanet_TileGF_Preprocessor": [
        { k: "scale_factor", label: "Scale factor", t: "range", min: 1, max: 8, step: 0.5, def: 1.0,
          tip: "Cuánto reduce la imagen antes de generar el tile-guide. 1.0 = sin reducir. Subir ayuda contra artefactos en imágenes grandes." },
        { k: "blur_strength", label: "Blur strength", t: "range", min: 1, max: 10, step: 0.5, def: 2.0,
          tip: "Suavizado aplicado al tile-guide. Más alto = guía más laxa (menos detalle exacto, más margen para reinventar)." },
        { k: "radius", label: "Radius", t: "range", min: 1, max: 20, step: 1, def: 7,
          tip: "Radio del filtro guiado. Más alto = suaviza un área mayor alrededor de cada píxel." },
        { k: "eps", label: "Eps", t: "range", min: 0.001, max: 0.1, step: 0.001, def: 0.01,
          tip: "Parámetro de regularización del filtro guiado. Valor técnico heredado del preprocesador; 0.01 anda bien, no suele hacer falta tocarlo." },
    ],
};

// Dibuja en #ppParams los controles del preprocesador elegido (o un aviso si es genérico).
function renderPpParams(name) {
    const wrap = document.getElementById('ppParams');
    if (!wrap) return;
    const specs = PP_RICH[name];
    if (!specs) {
        wrap.innerHTML = '<small style="color:#94a3b8;">Preprocesador genérico (nodo AIO, sin parámetros propios). Para controles finos, elegí uno de los 7 dedicados (Canny, Lineart Standard, Depth Anything V2, MiDaS Normal, DWPose, HED, TTPlanet Tile).</small>';
        return;
    }
    wrap.innerHTML = specs.map(s => {
        const id = 'pp_' + s.k;
        const tip = s.tip ? ` <span class="info-tip" data-tip="${s.tip.replace(/"/g, '&quot;')}">i</span>` : '';
        if (s.t === 'select') {
            const opts = s.opts.map(o => `<option value="${o}"${o === s.def ? ' selected' : ''}>${o}</option>`).join('');
            return `<div class="form-group"><label>${s.label}${tip}</label><select id="${id}" data-pp="${s.k}">${opts}</select></div>`;
        }
        if (s.t === 'toggle') {
            return `<div class="form-group"><label>${s.label}${tip}</label><select id="${id}" data-pp="${s.k}"><option value="enable"${s.def === 'enable' ? ' selected' : ''}>Sí</option><option value="disable"${s.def === 'disable' ? ' selected' : ''}>No</option></select></div>`;
        }
        return `<div class="form-group"><label>${s.label}${tip}</label><div class="range-row"><input type="range" id="${id}" data-pp="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.def}"><span class="range-value" id="${id}_val">${s.def}</span></div></div>`;
    }).join('');
    // live update de sliders + refrescar preview al cambiar
    specs.forEach(s => {
        const el = document.getElementById('pp_' + s.k);
        if (!el) return;
        const disp = document.getElementById('pp_' + s.k + '_val');
        if (disp) el.addEventListener('input', () => { disp.textContent = el.value; });
        el.addEventListener('change', () => { if (typeof autoPreviewPreprocess === 'function') autoPreviewPreprocess(); });
    });
}

// Devuelve los params del preprocesador elegido como { pp_<k>: valor }
function collectPpParams() {
    const out = {};
    document.querySelectorAll('#ppParams [data-pp]').forEach(el => {
        out['pp_' + el.getAttribute('data-pp')] = el.value;
    });
    return out;
}

// Etiquetas de familia para la leyenda chica (badges variados) — usado por el modal
document.addEventListener('DOMContentLoaded', () => {
    renderPreprocLegend();
    colorizeExistingPreprocOptions();
    const sel = document.getElementById('preprocessor');
    if (sel) {
        renderPpParams(sel.value);
        sel.addEventListener('change', () => renderPpParams(sel.value));
    }
});
