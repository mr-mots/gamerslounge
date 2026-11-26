// Contact form: sends the message to the API and shows the result under the form.
(function () {
  const form = document.getElementById('contact-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const button = form.querySelector('input[type="submit"]');

  function show(text, ok) {
    status.textContent = text;
    status.style.color = ok ? '#1aeeef' : '#ff6b6b';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      name: form.elements.name.value,
      email: form.elements.email.value,
      message: form.elements.message.value,
    };
    button.disabled = true;
    show('Sending...', true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        form.reset();
        show(data.message, true);
      } else if (data.details && data.details.length) {
        const friendly = {
          name: 'Please enter your name.',
          email: 'Please enter a valid email address.',
          message: 'Your message must be at least 10 characters.',
        };
        const fields = [...new Set(data.details.map((d) => d.field))];
        show(fields.map((f) => friendly[f] || 'Please check the ' + f + ' field.').join(' '), false);
      } else {
        show(data.error || 'Something went wrong.', false);
      }
    } catch {
      show('Could not reach the server.', false);
    } finally {
      button.disabled = false;
    }
  });
})();
