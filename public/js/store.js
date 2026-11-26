// Store page: loads games from the API, filters by platform, and searches by title or genre.
(function () {
  const grid = document.getElementById('cardBx');
  const tabs = document.querySelectorAll('.games .list');
  const searchInput = document.querySelector('.searchBx input');
  let platform = '';
  let query = '';
  let timer;

  function money(cents) {
    const dollars = cents / 100;
    return '$' + (Number.isInteger(dollars) ? dollars : dollars.toFixed(2));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Built with textContent (never innerHTML) so game titles can't inject HTML.
  function card(game) {
    const root = el('div', 'card');
    root.dataset.item = game.platform;

    const img = el('img');
    img.src = game.image || '';
    img.alt = game.title;
    root.appendChild(img);

    const content = el('div', 'content');
    content.appendChild(el('h4', '', game.title));

    const bar = el('div', 'progress-line');
    bar.appendChild(el('span'));
    content.appendChild(bar);

    const info = el('div', 'info');
    const price = el('p', '', 'Pricing ');
    price.appendChild(el('br'));
    price.appendChild(el('span', '', money(game.priceCents)));
    info.appendChild(price);
    const buy = el('a', '', 'Buy');
    buy.href = '#';
    buy.dataset.gameId = game.id;
    buy.addEventListener('click', (event) => {
      event.preventDefault();
      GL.cart.add(game);
      GL.toast(game.title + ' added to cart');
    });
    info.appendChild(buy);
    content.appendChild(info);

    root.appendChild(content);
    return root;
  }

  function message(text) {
    const p = el('p', '', text);
    p.style.color = '#dbd9d9';
    p.style.padding = '40px 0';
    grid.replaceChildren(p);
  }

  async function load() {
    const params = new URLSearchParams({ limit: '100' });
    if (platform) params.set('platform', platform);
    if (query) params.set('q', query);
    try {
      const res = await fetch('/api/games?' + params);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { data } = await res.json();
      if (!data.length) return message('No games found.');
      grid.replaceChildren(...data.map(card));
    } catch (err) {
      console.error(err);
      message('Could not load games. Is the server running?');
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.dataset.filter;
      platform = filter === 'all' ? '' : filter;
      load();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = searchInput.value.trim();
        load();
      }, 250);
    });
  }

  load();
})();
