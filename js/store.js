(function () {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PEGAR_") && !cfg.SUPABASE_ANON_KEY.includes("PEGAR_");
  window.db = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;
  window.formatMoney = value => new Intl.NumberFormat("es-UY", {
    style: "currency", currency: "UYU", maximumFractionDigits: 0
  }).format(Number(value || 0));
  window.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  window.toast = message => {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message; el.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
  };
  window.requireConfig = () => {
    if (!window.db) {
      toast("Falta configurar Supabase. Revisá js/config.js.");
      return false;
    }
    return true;
  };
})();