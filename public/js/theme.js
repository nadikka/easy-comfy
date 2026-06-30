// theme.js — toggle claro/oscuro con persistencia (Fase 2 del dossier).
// El tema se aplica ANTES del primer pintado vía un mini-script inline en <head>
// (evita el "flash" blanco). Acá manejamos el toggle y el ícono.

const THEME_KEY = 'cw-theme';

function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    const btn = document.getElementById('themeToggle');
    if (btn) {
        // Mostramos el ícono del tema al que vas a SALTAR (affordance)
        btn.textContent = theme === 'dark' ? '☀️' : '🌙';
        btn.title = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    }
}

function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

// Al cargar: sincronizar el ícono con el tema ya aplicado por el head-script.
document.addEventListener('DOMContentLoaded', () => applyTheme(currentTheme()));
