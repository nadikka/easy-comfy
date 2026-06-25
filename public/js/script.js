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

        const img = document.createElement('img');
        img.src = message.url; img.alt = 'Generated Image';
        img.onload = () => {
            updateProgress('✅ ¡Imagen completada!', 100);
            Logger.info('✅ Imagen cargada exitosamente');
            imageContainer.innerHTML = '';
            imageContainer.appendChild(img);
            document.getElementById('generateButton').disabled = false;
            document.getElementById('generateButton').textContent = '🚀 Generar Imagen';
            setTimeout(() => hideProgress(), 2000);
        };
        img.onerror = () => {
            Logger.error('❌ Error al cargar la imagen');
            hideProgress();
            document.getElementById('generateButton').disabled = false;
            document.getElementById('generateButton').textContent = '🚀 Generar Imagen';
        };
    }
};

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

function collectParams() {
    if (DIPLO_LIKE.includes(currentWorkflow)) {
        return {
            // KSampler
            steps: getVal('diploSteps', 8),
            cfg: getVal('diploCfg', 1.0),
            denoise: getVal('diploDenoise', 0.55),
            sampler_name: getVal('diploSampler', 'euler'),
            scheduler: getVal('diploScheduler', 'simple'),
            seed: getVal('seed', -1),
            // Dims
            width: getVal('diploWidth', 1024),
            height: getVal('diploHeight', 640),
            // Prompt
            negative_prompt: getVal('diploNegPrompt', 'blurry, ugly, low quality'),
            tile_prompt: getVal('tilePrompt', null),
            // LoRA
            lora_name: getVal('loraName', 'Bradhamel_art_style.safetensors'),
            lora_strength_model: getVal('loraStrengthModel', 0.80),
            lora_strength_clip: getVal('loraStrengthClip', 1.00),
            // ControlNet — ref_image = imagen subida (hidden refImage) o nombre manual (modo diplo)
            ref_image: getVal('refImage', '') || getVal('refImageName', 'DSC09211 (2).jpg'),
            preprocessor: getVal('preprocessor', 'CannyEdgePreprocessor'),
            preprocessor_low: getVal('preprocessorLow', 100),
            preprocessor_high: getVal('preprocessorHigh', 200),
            preprocessor_resolution: getVal('preprocessorRes', 512),
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
            unet_name: getVal('unetName', 'z_image_turbo_fp8_e4m3fn.safetensors.safetensors'),
            weight_dtype: getVal('weightDtype', 'fp8_e4m3fn'),
            vae_name: getVal('vaeName', 'ultrafluxVAEImproved_v10.safetensors'),
            clip_name: getVal('clipName', 'qwen_3_4b.safetensors.safetensors'),
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
        params.seed = Math.floor(Math.random() * 18446744073709551614) + 1;
        document.getElementById('seed').value = params.seed;
    }

    // Si estamos en DIPLO Colab y el toggle ControlNet está activo, usamos el workflow CN.
    let effectiveWorkflow = currentWorkflow;
    const cnToggle = document.getElementById('useControlnet');
    if (currentWorkflow === 'diplocolab' && cnToggle && cnToggle.checked) {
        if (!params.ref_image) {
            alert('Activaste ControlNet pero no subiste una imagen de referencia. Subí una primero.');
            genBtn.disabled = false; genBtn.textContent = '🚀 Generar Imagen';
            return;
        }
        effectiveWorkflow = 'diplocolabcn';
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
                if (status) status.textContent = `✅ Subida: ${d.name}`;
                Logger.info(`✓ Imagen de referencia subida: ${d.name}`);
            } else {
                if (status) status.textContent = '❌ Error: ' + (d.error || 'desconocido');
            }
        } catch (e) {
            if (status) status.textContent = '❌ Error subiendo: ' + e.message;
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
        scale_by: getVal('scaleBy', 1.0)
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
