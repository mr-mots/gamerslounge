// Cart page: shows the cart, places the order, and lists the user's past orders.
(function () {
  const list = document.getElementById('cart-list');
  const summary = document.getElementById('cart-summary');
  const total = document.getElementById('cart-total');
  const checkout = document.getElementById('checkout');
  const msg = document.getElementById('checkout-msg');
  const ordersBox = document.getElementById('orders');

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function row(item) {
    const r = el('div', 'cart-row');
    const img = el('img');
    img.src = item.image || '';
    img.alt = item.title;
    r.appendChild(img);

    const info = el('div');
    info.appendChild(el('div', 'title', item.title));
    info.appendChild(el('div', 'price', GL.money(item.priceCents) + ' each'));
    r.appendChild(info);

    const qty = el('div', 'qty');
    const minus = el('button', '', '-');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'Decrease quantity');
    minus.addEventListener('click', () => GL.cart.setQty(item.id, item.qty - 1));
    const plus = el('button', '', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Increase quantity');
    plus.disabled = item.qty >= GL.MAX_QTY;
    plus.addEventListener('click', () => GL.cart.setQty(item.id, item.qty + 1));
    qty.append(minus, el('span', '', String(item.qty)), plus);
    r.appendChild(qty);

    r.appendChild(el('div', 'line', GL.money(item.priceCents * item.qty)));

    const del = el('button', 'remove', '×');
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove ' + item.title);
    del.addEventListener('click', () => GL.cart.remove(item.id));
    r.appendChild(del);
    return r;
  }

  function render() {
    const items = GL.cart.items();
    if (!items.length) {
      const p = el('p', 'muted');
      p.append('Your cart is empty. ');
      const a = el('a', '', 'Browse the store');
      a.href = 'store.html';
      a.style.color = '#1aeeef';
      p.appendChild(a);
      list.replaceChildren(p);
      summary.hidden = true;
      return;
    }
    list.replaceChildren(...items.map(row));
    total.textContent = GL.money(GL.cart.totalCents());
    summary.hidden = false;
  }

  // Refresh prices from the server and drop games that were removed from the store.
  async function syncPrices() {
    const items = GL.cart.items();
    if (!items.length) return;
    const res = await GL.api('GET', '/api/games?limit=100').catch(() => null);
    if (!res || !res.ok) return;
    const live = new Map(res.data.data.map((g) => [g.id, g]));
    const fresh = items
      .filter((i) => live.has(i.id))
      .map((i) => ({ ...i, title: live.get(i.id).title, priceCents: live.get(i.id).priceCents }));
    if (JSON.stringify(fresh) !== JSON.stringify(items)) {
      GL.cart.replace(fresh);
      if (fresh.length < items.length) GL.toast('Some games are no longer available and were removed.');
    }
  }

  checkout.addEventListener('click', async () => {
    const user = await GL.me();
    if (!user) {
      window.location.href = 'login.html?next=cart.html';
      return;
    }
    checkout.disabled = true;
    msg.style.color = '#1aeeef';
    msg.textContent = 'Placing your order...';
    const body = { items: GL.cart.items().map((i) => ({ gameId: i.id, quantity: i.qty })) };
    const res = await GL.api('POST', '/api/orders', body).catch(() => null);
    checkout.disabled = false;
    if (res && res.ok) {
      GL.cart.clear();
      msg.textContent = '';
      GL.toast('Order #' + res.data.id + ' placed: ' + GL.money(res.data.totalCents));
      loadOrders();
    } else {
      msg.style.color = '#ff6b6b';
      msg.textContent = (res && res.data && res.data.error) || 'Could not place the order.';
    }
  });

  async function loadOrders() {
    const user = await GL.me();
    if (!user) {
      ordersBox.replaceChildren(el('p', 'muted', 'Log in to see your orders.'));
      return;
    }
    const res = await GL.api('GET', '/api/orders').catch(() => null);
    if (!res || !res.ok) return;
    if (!res.data.data.length) {
      ordersBox.replaceChildren(el('p', 'muted', 'No orders yet.'));
      return;
    }
    ordersBox.replaceChildren(
      ...res.data.data.map((o) => {
        const box = el('div', 'order');
        const head = el('div', 'head');
        head.append(
          el('span', '', 'Order #' + o.id + '  ·  ' + o.createdAt.slice(0, 10)),
          el('span', 'badge', o.status),
          el('span', '', GL.money(o.totalCents))
        );
        const ul = el('ul');
        o.items.forEach((i) => ul.appendChild(el('li', '', i.quantity + ' × ' + i.title)));
        box.append(head, ul);
        return box;
      })
    );
  }

  window.addEventListener('gl-cart-changed', render);
  render();
  syncPrices();
  loadOrders();
})();
