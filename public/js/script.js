// Current workflow selection
let currentWorkflow = 'diplocolab';

// Workflows que usan el panel rico de parametros del DIPLO (todos los controles)
const DIPLO_LIKE = ['diplo', 'diplocolab'];

// Muestra/oculta elementos con [data-modes] segun el workflow activo.
// Un elemento con data-modes="diplo" solo se ve si currentWorkflow === 'diplo'.
// Asi "DIPLO Colab" no muestra LoRA/ControlNet/Tile (que no aplican en este Colab).
function applyModeVisibility(mode) {
    document.querySelectorAll('[data-modes]').forEach(el => {
        const modes = el.getAttribute('data-modes').split(/\s+/);
        const show = modes.includes(mode);
        if (el.classList.contains('param-section')) {
            el.setAttribute('data-hidden', show ? '0' : '1');
        } else {
            el.style.display = show ? '' : 'none';
        }
    });
}

// ── Workflow selector + range sliders ──
document.addEventListener('DOMContentLoaded', () => {
    const btns = document.querySelectorAll('.workflow-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentWorkflow = btn.dataset.workflow;
            
            const simpleParams = document.getElementById('simpleParams');
            const diploParams = document.getElementById('diploParams');
            if (DIPLO_LIKE.includes(currentWorkflow)) {
                simpleParams.style.display = 'none';
                diploParams.classList.add('visible');
            } else {
                simpleParams.style.display = 'block';
                diploParams.classList.remove('visible');
            }
            applyModeVisibility(currentWorkflow);
            // Modo local (Z-Image GGUF): defaults optimizados 1024x640 / 8 steps
            if (currentWorkflow === 'local') {
                const w = document.getElementById('width');
                const h = document.getElementById('height');
                const s = document.getElementById('steps');
                if (w) w.value = 1024;
                if (h) h.value = 640;
                if (s) s.value = 8;
            }
            Logger.info(`Workflow cambiado a: ${currentWorkflow}`);
        });
    });
    
    // Estado inicial del panel segun el workflow por defecto (diplocolab usa el panel rico)
    (function initPanels() {
        const simpleParams = document.getElementById('simpleParams');
        const diploParams = document.getElementById('diploParams');
        // marcar el boton activo correcto
        btns.forEach(b => b.classList.toggle('active', b.dataset.workflow === currentWorkflow));
        if (DIPLO_LIKE.includes(currentWorkflow)) {
            if (simpleParams) simpleParams.style.display = 'none';
            if (diploParams) diploParams.classList.add('visible');
        } else {
            if (simpleParams) simpleParams.style.display = 'block';
            if (diploParams) diploParams.classList.remove('visible');
        }
        applyModeVisibility(currentWorkflow);
    })();

    // Range slider live updates
    const rangeSliders = [
        { input: 'loraStrengthModel', display: 'loraStrengthModelVal' },
        { input: 'loraStrengthClip', display: 'loraStrengthClipVal' },
        { input: 'controlnetStrength', display: 'controlnetStrengthVal' },
        { input: 'tileDenoise', display: 'tileDenoiseVal' },
        { input: 'scaleBy', display: 'scaleByVal' }
    ];
    rangeSliders.forEach(({ input, display }) => {
        const inp = document.getElementById(input);
        const disp = document.getElementById(display);
        if (inp && disp) {
            inp.addEventListener('input', () => {
                disp.textContent = parseFloat(inp.value).toFixed(2);
            });
        }
    });
});

// ── Advanced toggle ──
function toggleAdvanced() {
    const adv = document.getElementById('advancedParams');
    const toggle = document.querySelector('.advanced-toggle');
    if (adv.classList.contains('open')) {
        adv.classList.remove('open');
        toggle.textContent = '🔧 Modelos avanzados ▸';
    } else {
        adv.classList.add('open');
        toggle.textContent = '🔧 Modelos avanzados ▾';
    }
}

// ── WebSocket ──
const imageContainer = document.getElementById('imageContainer');
Logger.info(`Conectar al WebSocket del servidor Node.js`);
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsPath = BASE_PATH ? BASE_PATH + '/' : '';
const ws = new WebSocket(`${wsProtocol}//${window.location.host}${wsPath}`);

ws.onopen = () => { Logger.info('✓ WebSocket conectado al servidor local'); };
ws.onerror = (error) => { Logger.error('Error en WebSocket: ' + error.message); };
ws.onclose = () => { Logger.warning('WebSocket desconectado del servidor'); };

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'connection_status') {
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        switch(message.status) {
            case 'connecting':
                Logger.info(`🔄 Conectando a ComfyUI: ${message.url}`);
                if (statusIndicator) statusIndicator.className = 'status-indicator status-disconnected';
                if (statusText) statusText.textContent = 'Conectando...';
                window.comfyConnecting = true;
                break;
            case 'connected':
                Logger.info(`✓ ${message.message}`);
                if (statusIndicator) statusIndicator.className = 'status-indicator status-connected';
                if (statusText) statusText.textContent = 'Conectado';
                window.comfyConnected = true; window.comfyConnecting = false;
                if (typeof resetModels === 'function') resetModels();
                if (typeof loadAvailableModels === 'function') setTimeout(() => loadAvailableModels(true), 500);
                if (typeof loadDiploModels === 'function') setTimeout(() => loadDiploModels(true), 700);
                if (typeof loadPreprocessors === 'function') setTimeout(() => loadPreprocessors(true), 900);
                break;
            case 'error':
                // El WS a ComfyUI suele cortarse en tuneles free; NO pintamos rojo por eso.
                // El indicador lo maneja el ping HTTP (pingConnection en config.js), que es
                // la verdad sobre si el backend responde. Solo logueamos.
                Logger.warning(`(WS ComfyUI: ${message.message} — no afecta la generación, va por HTTP)`);
                break;
            case 'disconnected':
                // Idem: el WS puede caerse sin que el backend este caido. No tocamos el indicador.
                Logger.warning(`(WS ComfyUI desconectado — el indicador lo decide el ping HTTP)`);
                window.comfyConnected = false;
                break;
        }
        return;
    }
    
    if (message.type === 'generation_progress') {
        const pp = 40 + (message.percent * 0.4);
        updateProgress(message.message, Math.round(pp));
        return;
    }
    
    if (message.type === 'generation_status') {
        Logger.info(`📊 ${message.message}`);
        switch(message.status) {
            case 'queued': updateProgress('📋 Prompt en cola...', 20); break;
            case 'processing': updateProgress('⚙️ Generando imagen...', 40); break;
            case 'executing': updateProgress('🎨 ComfyUI procesando...', 45); break;
            case 'downloading': updateProgress('📥 Descargando imagen...', 85); break;
            case 'error': Logger.error(message.message); hideProgress(); alert('Error: ' + message.message); break;
        }
        return;
    }
    
    if (message.type === 'image_generated' && !message.url.includes('temp')) {
        Logger.info(`✓ Imagen generada: ${message.url}`);
        updateProgress('🎨 Descargando imagen...', 80);
        console.log('Imagen generada:', message.url);

        addToGallery(message.url, () => {
            updateProgress('✅ ¡Imagen completada!', 100);
            Logger.info('✅ Imagen cargada exitosamente');
            document.getElementById('generateButton').disabled = false;
            document.getElementById('generateButton').textContent = '🚀 Generar Imagen';
            setTimeout(() => hideProgress(), 2000);
        }, () => {
            Logger.error('❌ Error al cargar la imagen');
            hideProgress();
            document.getElementById('generateButton').disabled = false;
            document.getElementById('generateButton').textContent = '🚀 Generar Imagen';
        });
    }
};

// ── Galería: acumula todas las imágenes generadas (no solo la última) ──
const galleryUrls = new Set();

function nameFromUrl(url) {
    try { return decodeURIComponent(url.split('?')[0].split('/').pop()); } catch (e) { return 'imagen.png'; }
}

// Agrega una imagen a la galería y la pone como vista grande. onLoad/onError opcionales.
function addToGallery(url, onLoad, onError) {
    const cleanUrl = url.split('?')[0];
    if (galleryUrls.has(cleanUrl)) { if (onLoad) onLoad(); return; }
    galleryUrls.add(cleanUrl);

    const gallery = document.getElementById('gallery');
    const section = document.getElementById('gallerySection');
    const bust = cleanUrl + '?t=' + Date.now();

    // Vista grande = la más nueva
    const big = document.createElement('img');
    big.src = bust; big.alt = 'Imagen generada';
    big.onload = () => { if (onLoad) onLoad(); };
    big.onerror = () => { if (onError) onError(); };
    imageContainer.innerHTML = '';
    imageContainer.appendChild(big);

    // Miniatura en la grilla
    const cell = document.createElement('div');
    cell.style.cssText = 'position:relative; border-radius:6px; overflow:hidden; cursor:pointer; aspect-ratio:1; background:#f0f0f0;';
    const thumb = document.createElement('img');
    thumb.src = bust; thumb.alt = nameFromUrl(cleanUrl);
    thumb.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
    thumb.title = 'Click para ver grande';
    thumb.addEventListener('click', () => {
        imageContainer.innerHTML = '';
        const v = document.createElement('img');
        v.src = bust; v.alt = 'Imagen generada';
        imageContainer.appendChild(v);
        imageContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const dl = document.createElement('a');
    dl.href = bust; dl.download = nameFromUrl(cleanUrl);
    dl.textContent = '⬇️';
    dl.title = 'Descargar esta imagen';
    dl.style.cssText = 'position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,.55); color:#fff; ' +
                       'border-radius:4px; padding:1px 5px; font-size:13px; text-decoration:none;';
    cell.appendChild(thumb);
    cell.appendChild(dl);
    gallery.appendChild(cell);

    section.style.display = 'block';
    const c = document.getElementById('galleryCount');
    if (c) c.textContent = `(${galleryUrls.size})`;
}

// Botones de la galería + carga de imágenes ya generadas al abrir.
document.addEventListener('DOMContentLoaded', () => {
    const dlAll = document.getElementById('downloadAllBtn');
    if (dlAll) dlAll.addEventListener('click', () => {
        if (!galleryUrls.size) { alert('Todavía no generaste ninguna imagen.'); return; }
        window.location.href = apiUrl('/api/download-all');
    });
    const clr = document.getElementById('clearGalleryBtn');
    if (clr) clr.addEventListener('click', () => {
        galleryUrls.clear();
        document.getElementById('gallery').innerHTML = '';
        document.getElementById('galleryCount').textContent = '';
        document.getElementById('gallerySection').style.display = 'none';
        Logger.info('🗑️ Galería limpiada (los archivos siguen en el server)');
    });
    // Reconstruir la galería con lo que ya hay generado (sobrevive recargas).
    fetch(apiUrl('/api/images')).then(r => r.json()).then(d => {
        if (d.success && Array.isArray(d.images)) d.images.forEach(it => addToGallery(it.url));
    }).catch(() => {});
});

// ── Progress bar ──
function showProgress(text, percent) {
    const ps = document.getElementById('progressSection');
    ps.style.display = 'block';
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressText').textContent = text;
    document.getElementById('progressPercent').textContent = percent + '%';
}
function hideProgress() { document.getElementById('progressSection').style.display = 'none'; }
function updateProgress(text, percent) { showProgress(text, percent); }

// ── Collect params ──
function getVal(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = el.value;
    if (v === '' || v === undefined || v === null) return fallback;
    // Para numeros
    if (typeof fallback === 'number') {
        const n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }
    return v;
}

// ── Validación / saneado de inputs numéricos ──
function clampInt(v, min, max) {
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
}
function clampNum(v, min, max) {
    let n = Number(v);
    if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
}
// Redondea al múltiplo más cercano dentro del rango (latente SD3/Z-Image = múltiplos de 16).
function clampMult(v, min, max, mult) {
    const n = clampInt(v, min, max);
    return Math.max(min, Math.min(max, Math.round(n / mult) * mult));
}
// Seed entero exacto (evita la basura por pérdida de precisión de floats > 2^53).
function randomSeed() {
    return Math.floor(Math.random() * 1e15) + 1;
}

function collectParams() {
    if (DIPLO_LIKE.includes(currentWorkflow)) {
        return {
            // KSampler
            steps: clampInt(getVal('diploSteps', 8), 1, 150),
            cfg: clampNum(getVal('diploCfg', 1.0), 1, 30),
            denoise: clampNum(getVal('diploDenoise', 1.0), 0.05, 1),
            sampler_name: getVal('diploSampler', 'euler'),
            scheduler: getVal('diploScheduler', 'simple'),
            seed: getVal('seed', -1),
            // Dims (redondeadas a múltiplo de 16; el latente lo exige)
            width: clampMult(getVal('diploWidth', 1024), 256, 2048, 16),
            height: clampMult(getVal('diploHeight', 640), 256, 2048, 16),
            batch_size: clampInt(getVal('diploBatch', 1), 1, 8),
            // Prompt (negativo unificado: la caja de abajo, compartida por todos los modos)
            negative_prompt: getVal('negPrompt', 'blurry, ugly, low quality'),
            tile_prompt: getVal('tilePrompt', null),
            // LoRA (use_lora viene del toggle; el server inyecta el nodo solo si está ON + hay nombre)
            use_lora: !!(document.getElementById('useLora') && document.getElementById('useLora').checked),
            lora_name: getVal('loraName', ''),
            lora_strength_model: getVal('loraStrengthModel', 0.80),
            lora_strength_clip: getVal('loraStrengthClip', 1.00),
            // img2img — usa la imagen subida como latente inicial (en vez de ControlNet).
            // Gateado: solo true si el toggle está ON Y hay una imagen subida de verdad
            // (#refImage con valor), para no mandar al Colab un archivo inexistente.
            img2img: !!(document.getElementById('useImg2img') && document.getElementById('useImg2img').checked
                        && document.getElementById('refImage') && document.getElementById('refImage').value),
            // ControlNet — ref_image = imagen subida (hidden refImage) o nombre manual (modo diplo)
            ref_image: getVal('refImage', '') || getVal('refImageName', 'DSC09211 (2).jpg'),
            preprocessor: getVal('preprocessor', 'CannyEdgePreprocessor'),
            preprocessor_resolution: getVal('preprocessorRes', 512),
            // params propios del preprocesador dedicado elegido (pp_*), si los hay
            ...(typeof collectPpParams === 'function' ? collectPpParams() : {}),
            controlnet_strength: getVal('controlnetStrength', 0.90),
            scale_by: getVal('scaleBy', 0.19),
            scale_method: 'nearest-exact',
            // Tile refine
            tile_steps: getVal('tileSteps', 10),
            tile_denoise: getVal('tileDenoise', 0.20),
            tile_cols: getVal('tileCols', 3),
            tile_rows: getVal('tileRows', 3),
            tile_overlap: getVal('tileOverlap', 0.05),
            tile_sampler: getVal('tileSampler', 'euler'),
            tile_scheduler: getVal('tileScheduler', 'simple'),
            // Output
            upscale_width: getVal('upscaleWidth', 1128),
            upscale_height: getVal('upscaleHeight', 672),
            upscale_resize_mode: getVal('upscaleResizeMode', 'crop'),
            upscale_resize_method: getVal('upscaleResizeMethod', 'nearest-exact'),
            // Advanced models
            unet_name: getVal('unetName', 'z-image-turbo-fp8-e4m3fn.safetensors'),
            weight_dtype: getVal('weightDtype', 'fp8_e4m3fn'),
            vae_name: getVal('vaeName', 'ae.safetensors'),
            clip_name: getVal('clipName', 'qwen_3_4b_fp8_mixed.safetensors'),
            upscale_model_name: getVal('upscaleModel', '2x-AnimeSharpV4_RCAN.safetensors'),
            model_patch_name: getVal('modelPatchName', 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors')
        };
    } else {
        return {
            steps: parseInt(document.getElementById('steps').value) || 6,
            width: parseInt(document.getElementById('width').value) || 1080,
            height: parseInt(document.getElementById('height').value) || 1080,
            seed: parseInt(document.getElementById('seed').value) || -1,
            model: document.getElementById('modelSelect').value || 'realvisxl.safetensors',
            negative_prompt: getVal('negPrompt', 'text, watermark')
        };
    }
}

// ── Generate button ──
document.getElementById('generateButton').addEventListener('click', () => {
    const prompt = document.getElementById('prompt').value;
    if (!prompt) { alert('Por favor, ingresa un prompt.'); return; }
    
    const genBtn = document.getElementById('generateButton');
    genBtn.disabled = true;
    genBtn.textContent = '⏳ Generando...';
    
    const params = collectParams();
    if (params.seed === -1) {
        params.seed = randomSeed();
        document.getElementById('seed').value = params.seed;
    }

    // En DIPLO Colab, si hay una imagen subida: por defecto activa ControlNet.
    // Pero si el toggle img2img está ON, la imagen entra como latente inicial y NO
    // cambiamos de workflow (el server inserta LoadImage+VAEEncode en el mismo diplocolab).
    let effectiveWorkflow = currentWorkflow;
    const refImg = document.getElementById('refImage');
    if (currentWorkflow === 'diplocolab' && refImg && refImg.value) {
        if (params.img2img) {
            Logger.info(`🖼️ img2img activo (imagen como base, denoise=${params.denoise})`);
        } else {
            effectiveWorkflow = 'diplocolabcn';
            Logger.info('🎯 ControlNet activo (imagen de referencia subida)');
        }
    }

    Logger.info(`📤 [${effectiveWorkflow}] Prompt: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    Logger.info(`📊 Params: ${JSON.stringify(params).substring(0, 200)}...`);
    showProgress('📤 Enviando prompt a ComfyUI...', 10);

    ws.send(JSON.stringify({
        type: 'generarImagen',
        prompt: prompt,
        workflow: effectiveWorkflow,
        params: params
    }));
    
    setTimeout(() => {
        updateProgress('⏳ Procesando en ComfyUI...', 30);
    }, 500);
});

// ── ControlNet: subir imagen de referencia + vista previa del preprocesado ──

// Al elegir un archivo, lo sube al ComfyUI del Colab y guarda el nombre devuelto.
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('refImageFile');
    if (!fileInput) return;
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const status = document.getElementById('refImageStatus');
        if (status) status.textContent = '⏳ Subiendo imagen al Colab...';
        try {
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
                document.getElementById('refImage').value = d.name;
                // Unificación: la misma imagen de partida sirve para Describir (Qwen) sin re-subir.
                const qh = document.getElementById('qwenImage');
                if (qh) qh.value = d.name;
                if (status) status.textContent = `✅ Subida: ${d.name}`;
                Logger.info(`✓ Imagen de partida subida: ${d.name}`);
                setCnActive(true);
                autoPreviewPreprocess(); // vista previa automática al subir
            } else {
                if (status) status.textContent = '❌ Error: ' + (d.error || 'desconocido');
            }
        } catch (e) {
            if (status) status.textContent = '❌ Error subiendo: ' + e.message;
        }
    });
});

// Muestra/oculta el badge "ControlNet activado"
function setCnActive(on) {
    const badge = document.getElementById('cnBadge');
    if (badge) badge.classList.toggle('on', !!on);
}

// Quita la imagen de referencia → ControlNet vuelve a OFF (txt2img puro)
function clearRefImage() {
    const refImage = document.getElementById('refImage');
    const fileInput = document.getElementById('refImageFile');
    const status = document.getElementById('refImageStatus');
    if (refImage) refImage.value = '';
    if (fileInput) fileInput.value = '';
    if (status) status.textContent = 'Ningún archivo: ControlNet desactivado (txt2img puro).';
    setCnActive(false);
    const wrap = document.getElementById('preprocessPreviewWrap');
    if (wrap) wrap.style.display = 'none';
    Logger.info('🎯 ControlNet desactivado (imagen quitada)');
}

// ── Describir imagen → prompt (Qwen3-VL): describe la imagen subida y la pega en el prompt ──
async function describeImage() {
    const image = (document.getElementById('refImage') || {}).value;
    if (!image) { alert('Subí una imagen de referencia primero (la describe el Qwen3-VL).'); return; }
    const status = document.getElementById('preprocessStatus');
    if (status) status.textContent = '🔎 Describiendo imagen con Qwen3-VL (puede tardar)...';
    try {
        const resp = await fetch(apiUrl('/api/describe-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image })
        });
        const d = await resp.json();
        if (d.success && d.prompt) {
            const box = document.getElementById('prompt');
            if (box) { box.value = d.prompt; box.focus(); }
            if (status) status.textContent = '✅ Prompt generado y pegado. Editalo si querés.';
            Logger.info(`🔎 Qwen3-VL → prompt (${d.prompt.length} chars)`);
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo describir');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    }
}

// ── Agregar un LoRA por URL: lo baja al Colab y refresca el desplegable ──
async function addLoraByUrl() {
    const url = (document.getElementById('loraUrl').value || '').trim();
    const filename = (document.getElementById('loraFilename').value || '').trim();
    const status = document.getElementById('addLoraStatus');
    const btn = document.getElementById('addLoraBtn');
    if (!url) { if (status) status.textContent = '❌ Pegá primero el link del LoRA.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Bajando...'; }
    if (status) status.textContent = '⏳ Descargando en el Colab (puede tardar según el tamaño)...';
    try {
        const resp = await fetch(apiUrl('/api/add-lora'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, filename })
        });
        const d = await resp.json();
        if (d.success && d.name) {
            if (status) status.textContent = `✅ Agregado: ${d.name}. Refrescando lista...`;
            Logger.info(`✓ LoRA agregado al Colab: ${d.name}`);
            document.getElementById('loraUrl').value = '';
            document.getElementById('loraFilename').value = '';
            // Refrescar el desplegable de LoRAs desde el backend y seleccionar el nuevo
            if (typeof loadDiploModels === 'function') {
                await loadDiploModels(true);
                const sel = document.getElementById('loraName');
                if (sel) {
                    const opt = Array.from(sel.options).find(o => o.value === d.name);
                    if (opt) sel.value = d.name;
                }
            }
            const useLora = document.getElementById('useLora');
            if (useLora) useLora.checked = true; // lo dejo activado, listo para usar
            if (status) status.textContent = `✅ Listo: ${d.name} — seleccionado y "Usar LoRA" activado.`;
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo agregar');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⬇️ Agregar LoRA'; }
    }
}

// ── Modal: guía de preprocesadores ──
function openPreprocGuide() {
    if (typeof renderPreprocGuide === 'function') renderPreprocGuide();
    const m = document.getElementById('preprocGuide');
    if (m) m.classList.add('open');
}
function closePreprocGuide() {
    const m = document.getElementById('preprocGuide');
    if (m) m.classList.remove('open');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePreprocGuide(); });

// Auto-preview: corre la vista previa sola (con debounce) si hay imagen subida.
let _previewTimer = null;
function autoPreviewPreprocess() {
    const ri = document.getElementById('refImage');
    if (!ri || !ri.value) return; // sin imagen, no hay nada que previsualizar
    clearTimeout(_previewTimer);
    _previewTimer = setTimeout(() => previewPreprocess(), 350);
}

// Listeners: al cambiar preprocesador / thresholds / resolución, refresca la preview sola.
document.addEventListener('DOMContentLoaded', () => {
    ['preprocessor', 'preprocessorLow', 'preprocessorHigh', 'preprocessorRes', 'scaleBy'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', autoPreviewPreprocess);
    });
});

// Al togglear img2img, actualiza el texto del badge (sin romper el botón "Quitar imagen")
// para que no diga "ControlNet" cuando la imagen se va a usar como base img2img.
document.addEventListener('DOMContentLoaded', () => {
    const chk = document.getElementById('useImg2img');
    if (!chk) return;
    chk.addEventListener('change', () => {
        const badge = document.getElementById('cnBadge');
        if (badge && badge.firstChild) {
            const mode = chk.checked ? 'img2img (imagen como base)' : 'ControlNet activado';
            badge.firstChild.nodeValue = `✅ ${mode} — se usará esta imagen `;
        }
    });
});

// Corre SOLO el preprocesador y muestra el resultado, para ver qué hace antes de generar.
async function previewPreprocess() {
    const image = document.getElementById('refImage').value;
    const status = document.getElementById('preprocessStatus');
    if (!image) { alert('Subí una imagen de referencia primero.'); return; }
    const body = {
        image,
        preprocessor: getVal('preprocessor', 'CannyEdgePreprocessor'),
        resolution: getVal('preprocessorRes', 512),
        scale_by: getVal('scaleBy', 1.0),
        // params propios del preprocesador dedicado (pp_*), para que la preview los use
        ...(typeof collectPpParams === 'function' ? collectPpParams() : {})
    };
    if (status) status.textContent = '⏳ Preprocesando...';
    try {
        const resp = await fetch(apiUrl('/api/preprocess-preview'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await resp.json();
        if (d.success && d.url) {
            const wrap = document.getElementById('preprocessPreviewWrap');
            const img = document.getElementById('preprocessPreview');
            img.src = d.url + '?t=' + Date.now(); // cache-bust
            wrap.style.display = 'block';
            if (status) status.textContent = '✅ Listo';
            Logger.info(`✓ Preprocesado (${body.preprocessor}): ${d.url}`);
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'error');
        }
    } catch (e) {
        if (status) status.textContent = '❌ ' + e.message;
    }
}
