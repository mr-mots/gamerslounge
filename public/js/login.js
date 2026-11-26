// Login / sign-up page.
(function () {
  const tabs = document.querySelectorAll('.auth-tabs button');
  const forms = { login: document.getElementById('login-form'), register: document.getElementById('register-form') };

  // Only allow redirecting to our own pages (e.g. cart.html), never to another site.
  const next = new URLSearchParams(location.search).get('next');
  const target = next && /^[a-z0-9_-]+\.html$/i.test(next) ? next : 'store.html';

  function select(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    Object.entries(forms).forEach(([key, form]) => form.classList.toggle('active', key === name));
  }
  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));
  if (location.hash === '#register') select('register');

  const FRIENDLY = {
    username: 'Username must be 3-30 characters: letters, numbers and underscores only.',
    email: 'Please enter a valid email address.',
    password: 'Password must be at least 8 characters.',
  };

  function wire(form, path, fields) {
    const msg = form.querySelector('.form-msg');
    const button = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = {};
      fields.forEach((f) => { body[f] = form.elements[f].value; });
      button.disabled = true;
      msg.style.color = '#1aeeef';
      msg.textContent = 'Please wait...';
      const res = await GL.api('POST', path, body).catch(() => null);
      button.disabled = false;
      if (!res) {
        msg.style.color = '#ff6b6b';
        msg.textContent = 'Could not reach the server.';
      } else if (res.ok) {
        window.location.href = target;
      } else {
        msg.style.color = '#ff6b6b';
        const bad = res.data && res.data.details ? [...new Set(res.data.details.map((d) => d.field))] : [];
        msg.textContent = bad.length
          ? bad.map((f) => FRIENDLY[f] || 'Please check the ' + f + ' field.').join(' ')
          : (res.data && res.data.error) || 'Something went wrong.';
      }
    });
  }

  wire(forms.login, '/api/auth/login', ['email', 'password']);
  wire(forms.register, '/api/auth/register', ['username', 'email', 'password']);

  // Already logged in? Skip the form.
  GL.me().then((user) => { if (user) window.location.replace(target); });
})();
