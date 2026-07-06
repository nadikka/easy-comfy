// Gestión de modelos disponibles

let availableModels = [];
let modelsLoaded = false;
let lastComfyUrl = '';

// Resetear estado de modelos (cuando cambia la conexión)
function resetModels() {
    modelsLoaded = false;
    availableModels = [];
    Logger.info('🔄 Reseteando lista de modelos...');
}

// Cargar modelos disponibles
async function loadAvailableModels(forceReload = false) {
    // Si ya están cargados y no es forzado, no recargar
    if (modelsLoaded && !forceReload) {
        Logger.info('📋 Modelos ya cargados');
        return;
    }
    
    try {
        Logger.info('🔍 Cargando modelos disponibles de ComfyUI...');
        const response = await fetch(apiUrl('/api/models'));
        const data = await response.json();
        
        if (data.success && data.models && data.models.length > 0) {
            availableModels = data.models;
            Logger.info(`✓ ${data.models.length} modelos encontrados`);
            
            // Actualizar el select de modelos
            const modelSelect = document.getElementById('modelSelect');
            modelSelect.innerHTML = '';
            
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
            
            // Seleccionar realvisxl.safetensors si existe
            if (data.models.includes('realvisxl.safetensors')) {
                modelSelect.value = 'realvisxl.safetensors';
                Logger.info('✓ Modelo realvisxl.safetensors seleccionado por defecto');
            }
            
            modelsLoaded = true;
        } else {
            Logger.warning('⚠️ No se pudieron cargar los modelos: ' + (data.error || 'Sin modelos disponibles'));
            Logger.info('💡 Asegúrate de que ComfyUI esté corriendo y conectado');
        }
    } catch (error) {
        Logger.error('❌ Error al cargar modelos: ' + error.message);
        Logger.info('💡 Verifica que ComfyUI esté conectado correctamente');
    }
}

// Llena los dropdowns de modelos del workflow DIPLO desde /object_info
// Preserva el valor por defecto si ComfyUI está offline o el archivo no aparece en la lista.
let diploModelsLoaded = false;

async function loadDiploModels(forceReload = false) {
    if (diploModelsLoaded && !forceReload) return;

    const mapping = [
        { id: 'unetName',       key: 'unet_name' },
        { id: 'vaeName',        key: 'vae_name' },
        { id: 'clipName',       key: 'clip_name' },
        { id: 'loraName',       key: 'lora_name' },
        { id: 'upscaleModel',   key: 'upscale_model_name' },
        { id: 'restoreUpscaleModel', key: 'upscale_model_name' },
        { id: 'modelPatchName', key: 'model_patch_name' },
        // sampler/scheduler del KSampler core — se llenan con lo que reporta el backend
        { id: 'diploSampler',   key: 'sampler_name' },
        { id: 'diploScheduler', key: 'scheduler' }
    ];

    try {
        Logger.info('🔍 Cargando modelos DIPLO desde ComfyUI...');
        const response = await fetch(apiUrl('/api/object-info'));
        const data = await response.json();

        if (!data.success || !data.options) {
            Logger.warning('⚠️ No se pudieron cargar los modelos DIPLO: ' + (data.error || 'sin datos'));
            return;
        }

        // Cachea la lista de LoRAs para el mixer "especiero" (sec-lora), que arma sus
        // propios <select> dinámicos y no puede esperar a que loadDiploModels corra de nuevo.
        if (Array.isArray(data.options.lora_name)) window._loraOptionsCache = data.options.lora_name;

        let totalLoaded = 0;
        mapping.forEach(({ id, key }) => {
            const sel = document.getElementById(id);
            const list = data.options[key];
            if (!sel || !Array.isArray(list) || list.length === 0) return;

            const current = sel.value; // valor por defecto actual (puede no existir en este backend)
            sel.innerHTML = '';
            list.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                sel.appendChild(opt);
            });
            // Si el default actual existe en el backend, lo mantenemos. Si NO existe
            // (p.ej. otro Colab con nombres distintos), seleccionamos el 1er modelo
            // disponible para que la generación use uno válido sin intervención manual.
            sel.value = list.includes(current) ? current : list[0];
            totalLoaded += list.length;
        });

        diploModelsLoaded = true;
        Logger.info(`✓ Dropdowns DIPLO actualizados (${totalLoaded} entradas)`);
    } catch (error) {
        Logger.error('❌ Error al cargar modelos DIPLO: ' + error.message);
    }
}

// Llena el dropdown de preprocesadores del AIO_Preprocessor con la lista real del backend
let preprocessorsLoaded = false;
async function loadPreprocessors(forceReload = false) {
    if (preprocessorsLoaded && !forceReload) return;
    const sel = document.getElementById('preprocessor');
    if (!sel) return;
    try {
        const r = await fetch(apiUrl('/api/preprocessors'));
        const d = await r.json();
        if (!d.success || !Array.isArray(d.preprocessors) || d.preprocessors.length === 0) return;
        const current = sel.value;
        sel.innerHTML = '';
        d.preprocessors.forEach(name => {
            if (name === 'none') return; // 'none' no preprocesa nada
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            // Colorea por familia (preproc.js) para que la lista no sea un lío
            if (typeof colorizePreprocOption === 'function') colorizePreprocOption(opt);
            sel.appendChild(opt);
        });
        if (d.preprocessors.includes(current)) sel.value = current;
        preprocessorsLoaded = true;
        Logger.info(`✓ ${d.preprocessors.length} preprocesadores cargados (coloreados por familia)`);
    } catch (e) {
        Logger.warning('No se pudieron cargar preprocesadores: ' + e.message);
    }
}

// Resetear también los modelos DIPLO cuando cambia la conexión
const _origResetModels = resetModels;
resetModels = function() {
    _origResetModels();
    diploModelsLoaded = false;
    preprocessorsLoaded = false;
};

// Función para randomizar la semilla
function randomizeSeed() {
    const seedInput = document.getElementById('seed');
    // Seed entero exacto (sin la basura por pérdida de precisión de floats > 2^53).
    const s = Math.floor(Math.random() * 1e15) + 1;
    seedInput.value = s;
    Logger.info(`🎲 Semilla aleatoria: ${s}`);
}

// Variable global para saber si estamos conectados
window.comfyConnected = false;

// Cargar modelos cuando la página esté lista
document.addEventListener('DOMContentLoaded', () => {
    // Esperar a que se establezca la conexión
    setTimeout(() => {
        if (window.comfyConnected) {
            loadAvailableModels();
            loadDiploModels();
        } else {
            Logger.info('⏳ Esperando conexión a ComfyUI para cargar modelos...');
        }
    }, 3000);
});
