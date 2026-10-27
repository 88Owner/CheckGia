(() => {
  const MARK = "spc-page-data";
  let pending = "";

  function interesting(url, text) {
    if (/\/api\/v4\/(?:pdp\/get_pc|pdp\/get\b|item\/get)/.test(url)) return true;
    return text.includes("tier_variation") && (text.includes("modelid") || text.includes('"model_id"'));
  }

  function flush() {
    const root = document.documentElement;
    if (!root || !pending) return;
    let node = document.getElementById(MARK);
    if (!node) {
      node = document.createElement("script");
      node.id = MARK;
      node.type = "application/json";
      root.appendChild(node);
    }
    if ((node.textContent || "").length >= pending.length) return;
    node.textContent = pending;
  }

  function store(url, text) {
    if (!text || text.length < 40 || !interesting(String(url || ""), text)) return;
    if (text.length <= pending.length) return;
    pending = text.slice(0, 4000000);
    flush();
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (...args) {
      const input = args[0];
      const url = typeof input === "string" ? input : input && input.url ? input.url : "";
      return originalFetch.apply(this, args).then((response) => {
        try {
          response.clone().text().then((text) => store(url, text)).catch(() => undefined);
        } catch {
          // Giữ nguyên response của trang.
        }
        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__spcUrl = String(url || "");
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      try {
        if (typeof this.responseText === "string") store(this.__spcUrl || "", this.responseText);
      } catch {
        // Bỏ qua response không đọc được.
      }
    });
    return originalSend.apply(this, arguments);
  };

  document.addEventListener("DOMContentLoaded", flush);
})();
