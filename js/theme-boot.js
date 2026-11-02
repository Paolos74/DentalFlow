// Applica il tema salvato (Altro → Aspetto) prima del primo disegno, così chi usa il tema scuro
// non vede un lampo chiaro all'avvio. Script classico e sincrono: app.js (modulo) arriva dopo.
(function () {
  var theme = 'light';
  try {
    var p = JSON.parse(localStorage.getItem('dentalflow:prefs') || 'null');
    if (p && (p.theme === 'light' || p.theme === 'dark' || p.theme === 'auto')) theme = p.theme;
  } catch (e) { /* preferenze illeggibili: tema chiaro */ }
  document.documentElement.setAttribute('data-theme', theme);
}());
