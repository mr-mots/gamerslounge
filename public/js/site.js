// Shared by every page: session, cart, toast messages, and the header cart/login icons.
(function () {
  const GL = (window.GL = {});

  // Pull in the styles for the new pieces without touching your style.css.
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'account.css';
  document.head.appendChild(css);

  // ---------- image fallback ----------
  // If a picture can't load (for example the copyrighted game covers that are kept out of GitHub),
  // swap in a generated cover so the site never shows broken-image icons.
  function placeholder(label) {
    const text = (label || 'GamersLounge').slice(0, 40).replace(/[<>&"']/g, '');
    // Long titles wrap onto two lines at the space closest to the middle.
    let lines = [text];
    if (text.length > 16 && text.includes(' ')) {
      const mid = text.length / 2;
      let cut = -1;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
      }
      lines = [text.slice(0, cut), text.slice(cut + 1)];
    }
    const size = lines.length > 1 ? 21 : text.length > 12 ? 24 : 28;
    const y0 = lines.length > 1 ? 150 : 162;
    const tspans = lines
      .map((l, i) => "<text x='150' y='" + (y0 + i * 28) + "' text-anchor='middle' fill='#fff' font-family='Poppins,Arial,sans-serif' font-size='" + size + "' font-weight='700'>" + l + '</text>')
      .join('');
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 250'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#1b2141'/><stop offset='1' stop-color='#35407e'/></linearGradient></defs>" +
      "<rect width='300' height='250' fill='url(#g)'/>" +
      "<g fill='none' stroke='#1aeeef' stroke-width='3' opacity='.85'><rect x='110' y='56' width='80' height='46' rx='23'/><path d='M128 79h16M136 71v16'/><circle cx='164' cy='74' r='3'/><circle cx='174' cy='84' r='3'/></g>" +
      tspans + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function fixImage(img) {
    if (img.dataset.fallback) return; // never retry, so a failing fallback can't loop
    img.dataset.fallback = '1';
    img.src = placeholder(img.alt);
  }
  document.addEventListener('error', (event) => {
    if (event.target && event.target.tagName === 'IMG') fixImage(event.target);
  }, true);
  function scanImages() {
    document.querySelectorAll('img').forEach((img) => {
      if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) fixImage(img);
    });
  }
  scanImages();
  window.addEventListener('load', scanImages);

  // ---------- API helper ----------
  GL.api = async function (method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  };

  // ---------- current user ----------
  let mePromise;
  GL.me = function () {
    if (!mePromise) {
      mePromise = fetch('/api/auth/me')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d ? d.user : null))
        .catch(() => null);
    }
    return mePromise;
  };

  // ---------- cart (kept in the browser; the server re-prices it at checkout) ----------
  const KEY = 'gl_cart';
  let memory = null; // fallback if localStorage is blocked
  function read() {
    if (memory) return memory;
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function write(items) {
    memory = items;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
    refreshBadge();
    window.dispatchEvent(new Event('gl-cart-changed'));
  }
  const MAX_QTY = 10;

  GL.cart = {
    items: read,
    count: () => read().reduce((n, i) => n + i.qty, 0),
    totalCents: () => read().reduce((n, i) => n + i.priceCents * i.qty, 0),
    add(game) {
      const items = read().map((i) => ({ ...i }));
      const found = items.find((i) => i.id === game.id);
      if (found) found.qty = Math.min(MAX_QTY, found.qty + 1);
      else items.push({ id: game.id, title: game.title, priceCents: game.priceCents, image: game.image || '', qty: 1 });
      write(items);
    },
    setQty(id, qty) {
      const q = Math.max(0, Math.min(MAX_QTY, qty));
      write(read().map((i) => (i.id === id ? { ...i, qty: q } : i)).filter((i) => i.qty > 0));
    },
    remove: (id) => write(read().filter((i) => i.id !== id)),
    clear: () => write([]),
    replace: (items) => write(items),
  };
  GL.money = (cents) => '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  GL.MAX_QTY = MAX_QTY;

  // ---------- toast ----------
  let toastTimer;
  GL.toast = function (text) {
    let t = document.getElementById('gl-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'gl-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  };

  // ---------- header: cart icon + login/logout ----------
  let badge;
  function refreshBadge() {
    if (!badge) return;
    const n = GL.cart.count();
    badge.textContent = n;
    badge.style.display = n ? 'grid' : 'none';
  }

  function buildHeader() {
    const holder = document.querySelector('.nav-icons');
    if (!holder) return;

    const cart = document.createElement('a');
    cart.className = 'cart-link';
    cart.href = 'cart.html';
    cart.setAttribute('aria-label', 'Cart');
    cart.innerHTML = "<i class='bx bx-cart'></i>";
    badge = document.createElement('span');
    badge.className = 'cart-count';
    cart.appendChild(badge);
    holder.prepend(cart);
    refreshBadge();

    const acct = document.createElement('div');
    acct.className = 'acct';
    holder.appendChild(acct);

    GL.me().then((user) => {
      if (!user) {
        const a = document.createElement('a');
        a.href = 'login.html';
        a.className = 'acct-btn';
        a.textContent = 'Login';
        acct.appendChild(a);
        return;
      }
      const name = document.createElement('span');
      name.className = 'acct-name';
      name.textContent = user.username;
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'acct-btn';
      out.textContent = 'Logout';
      out.addEventListener('click', async () => {
        await GL.api('POST', '/api/auth/logout');
        window.location.href = 'index.html';
      });
      acct.append(name, out);
    });
  }

  buildHeader();
})();
