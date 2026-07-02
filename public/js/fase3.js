// fase3.js — interacciones del rediseño Fase 3 (dossier §6 + §7.2):
//   · Selector de intención (Generar / Guiar con imagen / Editar) que reemplaza
//     al wizard de 6 checkboxes Y al workflow-selector.
//   · La capa EDUCATIVA es la base permanente de la interfaz (decisión de Leo
//     2026-06-30): no hay toggle para apagarla. La clase `learn` queda fija en
//     <body> y las explicaciones (.section-desc, bienvenida, notas, "Probá esto")
//     se muestran siempre. Los tooltips (i) también.
//   · Acordeones de las secciones secundarias.
//   · Popover de configuración del Colab (⚙ de la topbar).
//   · Guía con pestañas (Nivel 2: Preprocesadores · Parámetros · LoRA · ControlNet).
//   · "Probá esto" (Nivel 3): botones que setean valores de demostración.
// NO toca la lógica data-modes/data-wiz ni el dispatch de generación (script.js).

(function () {
    'use strict';

    // ── Acordeones (secciones colapsables) ────────────────────────────────────
    window.toggleSection = function (header) {
        const s = header.closest('.param-section, .welcome');
        if (s) s.classList.toggle('collapsed');
    };

    // ── Popover de configuración (⚙) ──────────────────────────────────────────
    window.toggleConfig = function () {
        const p = document.getElementById('configPanel');
        if (p) p.classList.toggle('open');
    };

    // ── Selector de intención ─────────────────────────────────────────────────
    const INTENT_DESC = {
        generar:   'Creás una imagen desde una descripción (y, si querés, partiendo de una imagen).',
        editar:    'Subís una imagen y le cambiás algo puntual con una instrucción. Necesita L4.',
        restaurar: 'Subís una foto y la agrandás reconstruyendo detalle real (img2img + upscale).',
        video:     'Generás un video corto desde texto o desde una imagen con Wan 2.2 (local en tu Colab, sin costo por clip).'
    };
    window.setIntent = function (k) {
        document.body.classList.remove('intent-generar', 'intent-guiar', 'intent-editar', 'intent-restaurar', 'intent-video');
        document.body.classList.add('intent-' + k);
        document.querySelectorAll('#intentSel button').forEach(function (b) {
            b.classList.toggle('active', b.dataset.intent === k);
        });
        const d = document.getElementById('intentDesc');
        if (d) d.textContent = INTENT_DESC[k] || '';
        // Abrir la sección de la intención elegida (si estaba colapsada)
        if (k === 'guiar')  { const cn = document.getElementById('sec-cn');        if (cn) cn.classList.remove('collapsed'); }
        if (k === 'editar') { const ed = document.getElementById('sec-qwen-edit'); if (ed) ed.classList.remove('collapsed'); }
        if (k === 'video')  { const vd = document.getElementById('sec-video');     if (vd) vd.classList.remove('collapsed'); }
        try { localStorage.setItem('cw-intent', k); } catch (e) {}
    };

    // ── "Probá esto" (Nivel 3): setea un valor de demostración en un control ──
    // Actualiza el display de los sliders y dispara input/change para que los
    // listeners (script.js, preproc.js) reaccionen igual que si lo moviera el user.
    window.demo = function (id, value, displayId) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value;
        if (displayId) {
            const d = document.getElementById(displayId);
            if (d) d.textContent = isNaN(Number(value)) ? value : Number(value).toFixed(2);
        }
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Llevar el control a la vista para que se vea el cambio
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    };

    // ── Guía con pestañas (Nivel 2) ───────────────────────────────────────────
    window.switchGuideTab = function (tab) {
        document.querySelectorAll('.guide-tab').forEach(function (b) {
            b.classList.toggle('active', b.dataset.gtab === tab);
        });
        document.querySelectorAll('.guide-pane').forEach(function (p) {
            p.classList.toggle('active', p.id === 'gpane-' + tab);
        });
    };
    window.openGuide = function (tab) {
        // La pestaña "Preprocesadores" la dibuja preproc.js desde los datos de familias
        if (typeof renderPreprocGuide === 'function') renderPreprocGuide();
        window.switchGuideTab(tab || 'preproc');
        const m = document.getElementById('preprocGuide');
        if (m) m.classList.add('open');
    };

    document.addEventListener('DOMContentLoaded', function () {
        // Intención inicial (persistida, default 'generar').
        let savedIntent = null;
        try { savedIntent = localStorage.getItem('cw-intent'); } catch (e) {}
        setIntent(savedIntent || 'generar');

        // Las dos acciones de la imagen (ControlNet / img2img) son excluyentes.
        var cnChk = document.getElementById('useControlnet');
        var i2iChk = document.getElementById('useImg2img');
        if (cnChk && i2iChk) {
            cnChk.addEventListener('change', function () { if (cnChk.checked) i2iChk.checked = false; });
            i2iChk.addEventListener('change', function () { if (i2iChk.checked) cnChk.checked = false; });
        }

        // Cerrar el popover de config al click afuera.
        document.addEventListener('click', function (e) {
            const p = document.getElementById('configPanel');
            const g = document.getElementById('configGear');
            if (!p || !p.classList.contains('open')) return;
            if (p.contains(e.target)) return;
            if (g && (g === e.target || g.contains(e.target))) return;
            p.classList.remove('open');
        });
    });
})();
