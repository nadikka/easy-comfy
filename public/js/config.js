// Cargar configuración al iniciar
async function loadConfig() {
    try {
        Logger.info('Cargando configuración...');
        const response = await fetch(apiUrl('/api/config'));
        const config = await response.json();
        
        document.getElementById('comfyUrl').value = config.comfyUrl;
        document.getElementById('currentUrl').textContent = `URL actual: ${config.comfyUrl}`;

        // API key de comfy.org (Video/Seedance 2.0). El server NUNCA manda la key real
        // de vuelta (ver /api/config en server.js); solo dice si ya hay una guardada.
        const keyStatus = document.getElementById('comfyOrgApiKeyStatus');
        if (keyStatus) {
            keyStatus.textContent = config.hasComfyOrgApiKey ? '✅ Hay una key guardada.' : '⚠️ Todavía no cargaste una key.';
        }

        Logger.info(`Configuración cargada: ${config.comfyUrl}`);
        Logger.info(`Modo: ${config.isRemote ? 'Remoto (Colab)' : 'Local'}`);
        
        // Actualizar indicador de estado (asumimos conectado si hay config)
        updateStatusIndicator(true);
    } catch (error) {
        Logger.error('Error al cargar configuración: ' + error.message);
        updateStatusIndicator(false);
    }
}

// Guardar configuración
async function saveConfig() {
    const comfyUrl = document.getElementById('comfyUrl').value.trim();
    
    if (!comfyUrl) {
        Logger.error('URL vacía');
        alert(window.i18nT ? window.i18nT('Por favor ingrese una URL válida') : 'Por favor ingrese una URL válida');
        return;
    }
    
    // Validar formato de URL
    try {
        new URL(comfyUrl);
        Logger.info(`Validando URL: ${comfyUrl}`);
    } catch (e) {
        Logger.error('URL inválida: ' + e.message);
        alert(window.i18nT ? window.i18nT('URL inválida. Debe incluir el protocolo (http:// o https://') : 'URL inválida. Debe incluir el protocolo (http:// o https://');
        return;
    }
    
    try {
        Logger.info('Guardando configuración...');
        const isRemote = comfyUrl.includes('trycloudflare.com') || 
                        comfyUrl.includes('colab.dev') || 
                        comfyUrl.startsWith('https://');
        
        Logger.info(`Tipo de conexión: ${isRemote ? 'Remota' : 'Local'}`);
        
        const config = {
            comfyUrl: comfyUrl,
            isRemote: isRemote
        };
        
        const response = await fetch(apiUrl('/api/config'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        const result = await response.json();
        
        if (result.success) {
            Logger.info('✓ Configuración guardada exitosamente');
            Logger.info('El servidor se está reconectando a ComfyUI...');
            document.getElementById('currentUrl').textContent = `URL actual: ${comfyUrl}`;
            // Verificar por HTTP si la URL nueva responde (no esperar al WS)
            setTimeout(pingConnection, 1500);
        } else {
            Logger.error('Error al guardar: ' + (result.error || 'Unknown error'));
            alert((window.i18nT ? window.i18nT('Error al guardar configuración: ') : 'Error al guardar configuración: ') + (result.error || 'Unknown error'));
            updateStatusIndicator(false);
        }
    } catch (error) {
        Logger.error('Error de red: ' + error.message);
        alert(window.i18nT ? window.i18nT('Error al guardar configuración') : 'Error al guardar configuración');
        updateStatusIndicator(false);
    }
}

// Guarda la API key de comfy.org (Video / Seedance 2.0). Endpoint separado de
// saveConfig() para no pisar comfyUrl/isRemote ni disparar la reconexión del WS.
async function saveComfyOrgApiKey() {
    const input = document.getElementById('comfyOrgApiKey');
    const status = document.getElementById('comfyOrgApiKeyStatus');
    const apiKey = (input && input.value || '').trim();
    if (!apiKey) {
        if (status) status.textContent = '❌ Pegá la key antes de guardar.';
        return;
    }
    try {
        const resp = await fetch(apiUrl('/api/comfy-org-key'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey })
        });
        const d = await resp.json();
        if (d.success) {
            if (status) status.textContent = '✅ Key guardada.';
            if (input) input.value = '';
            Logger.info('✓ API key de comfy.org guardada');
        } else {
            if (status) status.textContent = '❌ ' + (d.error || 'no se pudo guardar');
        }
    } catch (e) {
        if (status) status.textContent = '❌ Error de red: ' + e.message;
    }
}

// Preset para localhost
function setLocalhost() {
    document.getElementById('comfyUrl').value = 'http://localhost:8188';
}

// Preset para Colab: NO hardcodea ninguna URL (cambian en cada reinicio del tunel).
// Deja la URL guardada actual y la selecciona para reemplazarla fácil pegando la nueva.
function setColab() {
    const urlInput = document.getElementById('comfyUrl');
    urlInput.placeholder = window.i18nT ? window.i18nT('Pegá la URL *.trycloudflare.com del Colab') : 'Pegá la URL *.trycloudflare.com del Colab';
    urlInput.focus();
    urlInput.select(); // selecciona lo que haya para sobrescribir pegando
}

// Actualizar indicador de estado
function updateStatusIndicator(connected) {
    const indicator = document.getElementById('statusIndicator');
    if (connected) {
        indicator.classList.remove('status-disconnected');
        indicator.classList.add('status-connected');
    } else {
        indicator.classList.remove('status-connected');
        indicator.classList.add('status-disconnected');
    }
}

// Banner accionable (A3): se crea una sola vez, arriba de todo. Cuando el Colab está
// caído avisa qué hacer; cuando la GPU es T4 avisa que Editar no entra (OOM).
function ensureBanner() {
    let b = document.getElementById('backendBanner');
    if (!b) {
        b = document.createElement('div');
        b.id = 'backendBanner';
        b.style.cssText = 'display:none;padding:10px 16px;margin:0 0 16px;border-radius:8px;font-size:14px;font-weight:500;line-height:1.4;';
        const host = document.querySelector('.content') || document.querySelector('.container') || document.body;
        host.insertBefore(b, host.firstChild);
    }
    return b;
}
function showBanner(kind, html) {
    const b = ensureBanner();
    const styles = {
        down:  'background:#fdecea;color:#9b1c1c;border:1px solid #f5b5b0;',
        warn:  'background:#fff6e5;color:#8a5a00;border:1px solid #f0d28a;',
    };
    b.style.cssText = b.style.cssText.replace(/background:[^;]*;color:[^;]*;border:[^;]*;?/g, '') + (styles[kind] || '');
    b.style.display = 'block';
    b.innerHTML = html;
}
function hideBanner() { const b = document.getElementById('backendBanner'); if (b) b.style.display = 'none'; }

// Habilita/deshabilita un botón por id con un title explicativo.
function setBtnEnabled(id, enabled, disabledTitle) {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !enabled;
    el.style.opacity = enabled ? '' : '0.5';
    el.style.cursor = enabled ? '' : 'not-allowed';
    el.title = enabled ? '' : (disabledTitle || '');
}

// Ping HTTP al backend (via /api/ping del server) para reflejar si el Colab esta VIVO,
// independiente del WebSocket (que los tuneles free cortan). Mantiene el indicador, la
// linea "URL actual", el banner accionable (A3) y el aviso de GPU para Editar (A6).
// Se llama al cargar, al guardar y cada 15s.
async function pingConnection() {
    const txt = document.getElementById('currentUrl');
    try {
        const r = await fetch(apiUrl('/api/ping'));
        const d = await r.json();
        updateStatusIndicator(d.alive);
        const statusText = document.getElementById('statusText');
        if (d.alive) {
            const gpuTxt = d.gpu ? `  ·  ${d.gpu}${d.vramGB ? ' (' + d.vramGB + ' GB)' : ''}` : '';
            if (statusText) statusText.textContent = 'Colab vivo' + (d.gpuTier ? ` · ${d.gpuTier}` : '');
            if (txt) txt.textContent = `✅ URL actual (viva): ${d.url}` + (d.info ? `  ·  ComfyUI ${d.info}` : '') + gpuTxt;

            // Colab vivo → Generar habilitado, banner según GPU
            setBtnEnabled('generateButton', true);
            if (d.gpuTier === 'T4') {
                // A6: en T4, Qwen-Image-Edit hace OOM → deshabilitar Editar y avisar
                setBtnEnabled('editBtn', false, 'Editar necesita una L4. Esta sesión es T4 (15 GB): el modelo no entra y da OOM.');
                showBanner('warn', '⚠️ <b>GPU T4 detectada (15 GB).</b> Generar, LoRA, ControlNet y Describir andan bien. <b>Editar imagen (Qwen-Image-Edit) NO entra</b> en T4 — para eso cambiá el entorno a <b>L4</b> en Colab.');
            } else {
                setBtnEnabled('editBtn', true);
                hideBanner();
            }
        } else {
            if (statusText) statusText.textContent = 'Sin respuesta';
            if (txt) txt.textContent = `⚠️ URL actual NO responde: ${d.url} — pegá la URL nueva del Colab y Guardá`;
            // A3: Colab caído → deshabilitar Generar/Editar y banner accionable
            setBtnEnabled('generateButton', false, 'El Colab no responde. Reiniciá el notebook primero.');
            setBtnEnabled('editBtn', false, 'El Colab no responde.');
            showBanner('down', '🔴 <b>El Colab no responde.</b> Andá al notebook de Colab, <b>reconectá / Ejecutá todas</b> las celdas, esperá el banner de la URL, y si cambió la URL pegala arriba y Guardá. Mientras tanto Generar está deshabilitado.');
        }
        return d.alive;
    } catch (e) {
        updateStatusIndicator(false);
        if (txt) txt.textContent = '⚠️ No se pudo verificar la conexión';
        setBtnEnabled('generateButton', false, 'No se pudo verificar la conexión.');
        showBanner('down', '🔴 <b>No se pudo verificar la conexión</b> con el server local. ¿Está corriendo comfyweb?');
        return false;
    }
}

// Cargar configuración al cargar la página + arrancar el ping periódico
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    pingConnection();
    setInterval(pingConnection, 15000);
});
