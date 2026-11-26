// Tournament page: list, details, join/leave, live bracket, and admin controls.
(function () {
  const listView = document.getElementById('t-list-view');
  const detailView = document.getElementById('t-detail-view');
  const grid = document.getElementById('t-grid');
  const createBox = document.getElementById('t-create');
  const createForm = document.getElementById('t-create-form');
  const createMsg = document.getElementById('t-create-msg');

  const STATUS = { open: 'Open', in_progress: 'Live', completed: 'Finished' };
  let me = null;
  let pollTimer = null;
  let currentId = null;

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function formatDate(value) {
    if (!value) return 'Date to be announced';
    const d = new Date(value.replace(' ', 'T') + 'Z');
    return isNaN(d) ? value : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function badge(status) {
    return el('span', 'badge status-' + status, STATUS[status] || status);
  }

  function errorText(res, fallback) {
    return (res && res.data && res.data.error) || fallback;
  }

  // ---------------- list view ----------------
  function card(t) {
    const a = el('a', 't-card');
    a.href = '#t=' + t.id;
    const top = el('div', 'top');
    top.append(el('h3', '', t.name), badge(t.status));
    a.appendChild(top);
    a.appendChild(el('p', 'muted', t.game ? t.game.title : 'Open game'));
    a.appendChild(el('p', '', t.playerCount + ' / ' + t.maxPlayers + ' players'));
    a.appendChild(el('p', 'muted', t.status === 'completed' && t.winner ? 'Champion: ' + t.winner.username : formatDate(t.startsAt)));
    return a;
  }

  async function loadList() {
    const res = await GL.api('GET', '/api/tournaments').catch(() => null);
    if (!res || !res.ok) {
      grid.replaceChildren(el('p', 'muted', 'Could not load tournaments. Is the server running?'));
      return;
    }
    const rank = { in_progress: 0, open: 1, completed: 2 };
    const items = res.data.data.slice().sort((a, b) => rank[a.status] - rank[b.status] || a.id - b.id);
    grid.replaceChildren(...(items.length ? items.map(card) : [el('p', 'muted', 'No tournaments yet.')]));
  }

  async function setupCreate() {
    if (!me || me.role !== 'admin') return;
    createBox.hidden = false;
    const select = createForm.elements.gameId;
    const res = await GL.api('GET', '/api/games?limit=100').catch(() => null);
    if (res && res.ok) {
      res.data.data.forEach((g) => {
        const o = el('option', '', g.title);
        o.value = g.id;
        select.appendChild(o);
      });
    }
  }

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = createForm.elements;
    const body = { name: f.name.value, maxPlayers: Number(f.maxPlayers.value) };
    if (f.gameId.value) body.gameId = Number(f.gameId.value);
    if (f.startsAt.value) body.startsAt = new Date(f.startsAt.value).toISOString().slice(0, 19).replace('T', ' ');
    createMsg.style.color = '#1aeeef';
    createMsg.textContent = 'Creating...';
    const res = await GL.api('POST', '/api/tournaments', body).catch(() => null);
    if (res && res.ok) {
      createForm.reset();
      createMsg.textContent = '';
      location.hash = '#t=' + res.data.id;
    } else {
      createMsg.style.color = '#ff6b6b';
      const bad = res && res.data && res.data.details;
      createMsg.textContent = bad ? 'Please check: ' + bad.map((d) => d.field).join(', ') : errorText(res, 'Could not create the tournament.');
    }
  });

  // ---------------- detail view ----------------
  function roundName(round, total) {
    if (round === total) return 'Final';
    if (round === total - 1) return 'Semifinals';
    if (round === total - 2) return 'Quarterfinals';
    return 'Round ' + round;
  }

  function slot(player, match, isWinner) {
    const s = el('div', 'slot');
    if (player) {
      s.appendChild(el('span', '', player.username + (me && me.id === player.id ? ' (you)' : '')));
      if (match.winnerId) s.classList.add(isWinner ? 'win' : 'lose');
      if (me && me.id === player.id) s.classList.add('me');
    } else {
      s.classList.add('empty');
      s.appendChild(el('span', '', match.round === 1 ? 'BYE' : 'TBD'));
    }
    return s;
  }

  function matchBox(t, m) {
    const box = el('div', 'match' + (m.status === 'ready' ? ' ready' : ''));
    box.append(slot(m.player1, m, m.player1 && m.winnerId === m.player1.id), slot(m.player2, m, m.player2 && m.winnerId === m.player2.id));

    // Admin: report the winner of a match that is ready to be played.
    if (me && me.role === 'admin' && m.status === 'ready' && t.status === 'in_progress') {
      const bar = el('div', 'report');
      [m.player1, m.player2].forEach((p) => {
        const b = el('button', '', p.username + ' wins');
        b.type = 'button';
        b.addEventListener('click', () => report(t, m, p));
        bar.appendChild(b);
      });
      box.appendChild(bar);
    }
    return box;
  }

  function bracket(t) {
    const wrap = el('div', 'bracket');
    for (let r = 1; r <= t.totalRounds; r++) {
      const col = el('div', 'round');
      col.appendChild(el('h4', '', roundName(r, t.totalRounds)));
      const matches = el('div', 'matches');
      t.matches.filter((m) => m.round === r).sort((a, b) => a.position - b.position).forEach((m) => matches.appendChild(matchBox(t, m)));
      col.appendChild(matches);
      wrap.appendChild(col);
    }
    return wrap;
  }

  async function act(t, path, okText) {
    const res = await GL.api('POST', '/api/tournaments/' + t.id + path).catch(() => null);
    if (res && res.ok) {
      if (okText) GL.toast(okText);
      renderDetail(res.data);
    } else {
      GL.toast(errorText(res, 'Something went wrong.'));
    }
  }

  async function report(t, match, player) {
    if (!window.confirm('Record ' + player.username + ' as the winner? This cannot be undone.')) return;
    const res = await GL.api('POST', '/api/tournaments/' + t.id + '/matches/' + match.id + '/result', { winnerId: player.id }).catch(() => null);
    if (res && res.ok) {
      GL.toast(player.username + ' advances');
      renderDetail(res.data);
    } else {
      GL.toast(errorText(res, 'Could not record the result.'));
    }
  }

  function actions(t) {
    const bar = el('div', 'actions');
    if (t.status === 'open') {
      if (!me) {
        const a = el('a', 'btn-main', 'Log in to join');
        a.href = 'login.html?next=tournament.html';
        bar.appendChild(a);
      } else {
        const joined = t.players.some((p) => p.id === me.id);
        const full = t.playerCount >= t.maxPlayers;
        const b = el('button', 'btn-main', joined ? 'Leave tournament' : full ? 'Tournament full' : 'Join tournament');
        b.type = 'button';
        b.disabled = !joined && full;
        b.addEventListener('click', () => act(t, joined ? '/leave' : '/join', joined ? 'You left the tournament' : 'You joined!'));
        bar.appendChild(b);
      }
      if (me && me.role === 'admin') {
        const start = el('button', 'btn-main', 'Start tournament');
        start.type = 'button';
        start.disabled = t.playerCount < 2;
        start.title = t.playerCount < 2 ? 'At least 2 players are needed' : '';
        start.addEventListener('click', () => {
          if (window.confirm('Start now? Registration closes and the bracket is drawn.')) act(t, '/start', 'Bracket drawn. Good luck!');
        });
        bar.appendChild(start);
        if (t.playerCount < 2) bar.appendChild(el('span', 'muted', 'Needs at least 2 players to start'));
      }
    }
    return bar;
  }

  function renderDetail(t) {
    currentId = t.id;
    const back = el('a', 'back', '← All tournaments');
    back.href = '#';

    const title = el('h1');
    title.append(t.name + ' ', badge(t.status));

    const meta = el('p', 'muted', [t.game ? t.game.title : 'Open game', t.playerCount + ' / ' + t.maxPlayers + ' players', formatDate(t.startsAt)].join('  ·  '));

    const parts = [back, title, meta];

    if (t.status === 'completed' && t.winner) {
      const champ = el('div', 'champion');
      champ.append(el('span', 'trophy', '🏆'), el('span', '', 'Champion: ' + t.winner.username));
      parts.push(champ);
    }

    parts.push(actions(t));

    parts.push(el('h2', '', 'Players'));
    const chips = el('div', 'chips');
    if (t.players.length) {
      t.players.forEach((p) => chips.appendChild(el('span', 'chip' + (me && me.id === p.id ? ' me' : ''), (p.seed ? '#' + p.seed + ' ' : '') + p.username)));
    } else {
      chips.appendChild(el('span', 'muted', 'Nobody has joined yet. Be the first!'));
    }
    parts.push(chips);

    parts.push(el('h2', '', 'Bracket'));
    parts.push(t.matches.length ? bracket(t) : el('p', 'notice', 'The bracket is drawn when the tournament starts. Players are seeded at random, and if the number of players is not a power of two, the top seeds get a bye into round 2.'));

    detailView.replaceChildren(...parts);
  }

  async function showDetail(id, silent) {
    const res = await GL.api('GET', '/api/tournaments/' + id).catch(() => null);
    if (!res || !res.ok) {
      if (!silent) detailView.replaceChildren(el('p', 'muted', 'Tournament not found.'), Object.assign(el('a', 'back', '← All tournaments'), { href: '#' }));
      return;
    }
    // Don't redraw if we've navigated away while the request was in flight.
    if (currentRoute() !== id) return;
    renderDetail(res.data);
  }

  // ---------------- routing ----------------
  function currentRoute() {
    const m = /^#t=(\d+)$/.exec(location.hash);
    return m ? Number(m[1]) : null;
  }

  function route() {
    clearInterval(pollTimer);
    const id = currentRoute();
    if (id) {
      listView.hidden = true;
      detailView.hidden = false;
      detailView.replaceChildren(el('p', 'muted', 'Loading...'));
      showDetail(id);
      // Refresh every few seconds so the bracket updates "live" for everyone watching.
      pollTimer = setInterval(() => { if (!document.hidden) showDetail(id, true); }, 6000);
    } else {
      currentId = null;
      detailView.hidden = true;
      listView.hidden = false;
      loadList();
    }
  }

  window.addEventListener('hashchange', route);
  GL.me().then((user) => {
    me = user;
    setupCreate();
    route();
  });
})();
