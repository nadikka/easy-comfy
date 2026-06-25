// Cargar configuración al iniciar
async function loadConfig() {
    try {
        Logger.info('Cargando configuración...');
        const response = await fetch(apiUrl('/api/config'));
        const config = await response.json();
        
        document.getElementById('comfyUrl').value = config.comfyUrl;
        document.getElementById('currentUrl').textContent = `URL actual: ${config.comfyUrl}`;
        
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
        alert('Por favor ingrese una URL válida');
        return;
    }
    
    // Validar formato de URL
    try {
        new URL(comfyUrl);
        Logger.info(`Validando URL: ${comfyUrl}`);
    } catch (e) {
        Logger.error('URL inválida: ' + e.message);
        alert('URL inválida. Debe incluir el protocolo (http:// o https://');
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
            alert('Error al guardar configuración: ' + (result.error || 'Unknown error'));
            updateStatusIndicator(false);
        }
    } catch (error) {
        Logger.error('Error de red: ' + error.message);
        alert('Error al guardar configuración');
        updateStatusIndicator(false);
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
    urlInput.placeholder = 'Pegá la URL *.trycloudflare.com del Colab';
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

// Ping HTTP al backend (via /api/ping del server) para reflejar si el Colab esta VIVO,
// independiente del WebSocket (que los tuneles free cortan). Mantiene el indicador y la
// linea "URL actual" siempre al dia. Se llama al cargar, al guardar y cada 15s.
async function pingConnection() {
    const txt = document.getElementById('currentUrl');
    try {
        const r = await fetch(apiUrl('/api/ping'));
        const d = await r.json();
        updateStatusIndicator(d.alive);
        const statusText = document.getElementById('statusText');
        if (d.alive) {
            if (statusText) statusText.textContent = 'Colab vivo';
            if (txt) txt.textContent = `✅ URL actual (viva): ${d.url}` + (d.info ? `  ·  ComfyUI ${d.info}` : '');
        } else {
            if (statusText) statusText.textContent = 'Sin respuesta';
            if (txt) txt.textContent = `⚠️ URL actual NO responde: ${d.url} — pegá la URL nueva del Colab y Guardá`;
        }
        return d.alive;
    } catch (e) {
        updateStatusIndicator(false);
        if (txt) txt.textContent = '⚠️ No se pudo verificar la conexión';
        return false;
    }
}

// Cargar configuración al cargar la página + arrancar el ping periódico
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    pingConnection();
    setInterval(pingConnection, 15000);
});
