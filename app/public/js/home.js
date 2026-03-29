// klyr — Landing Page

(function () {
  // ---- Reveal on scroll (Intersection Observer) ----
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1, rootMargin: '-60px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => {
    revealObserver.observe(el);
  });

  // ---- Navbar scroll effect ----
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  });

  // ---- Scroll-driven word reveal ----
  const scrollTextSection = document.getElementById('scrollText');
  if (scrollTextSection) {
    const paragraphs = scrollTextSection.querySelectorAll('.scroll-paragraph');

    paragraphs.forEach((p) => {
      const text = p.textContent.trim();
      const highlights = (p.dataset.highlight || '').split(',').map((w) => w.trim().toLowerCase());
      const words = text.split(/\s+/);

      p.innerHTML = words
        .map((word) => {
          const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
          const isHighlight = highlights.includes(clean);
          return `<span class="scroll-word${isHighlight ? ' highlight' : ''}">${word} </span>`;
        })
        .join('');
    });

    // Animate words on scroll
    function updateScrollText() {
      const rect = scrollTextSection.getBoundingClientRect();
      const viewH = window.innerHeight;

      // Progress: 0 when section top hits viewport bottom, 1 when section bottom hits viewport top
      const sectionH = rect.height;
      const rawProgress = (viewH - rect.top) / (viewH + sectionH);
      const progress = Math.max(0, Math.min(1, rawProgress));

      const words = scrollTextSection.querySelectorAll('.scroll-word');
      const total = words.length;

      words.forEach((word, i) => {
        const wordThreshold = (i / total) * 0.8; // spread over 80% of scroll
        if (progress > wordThreshold) {
          word.classList.add('visible');
        } else {
          word.classList.remove('visible');
        }
      });
    }

    window.addEventListener('scroll', updateScrollText, { passive: true });
    updateScrollText();
  }

  // ---- Copy install command ----
  const copyCurl = document.getElementById('copyCurl');
  if (copyCurl) {
    copyCurl.addEventListener('click', () => {
      navigator.clipboard.writeText('curl -fsSL localhost:8000/install | bash').then(() => {
        copyCurl.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          copyCurl.innerHTML =
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    });
  }

  // ---- Session input (Go button) ----
  const sessionInput = document.getElementById('sessionInput');
  const goBtn = document.getElementById('goBtn');

  function goToSession() {
    const id = sessionInput.value.trim().toLowerCase();
    if (id) window.location.href = `/${id}`;
  }

  if (goBtn) goBtn.addEventListener('click', goToSession);
  if (sessionInput) {
    sessionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') goToSession();
    });
  }

  // ---- New session button ----
  const newSessionBtn = document.getElementById('newSessionBtn');
  if (newSessionBtn) {
    newSessionBtn.addEventListener('click', async () => {
      newSessionBtn.disabled = true;
      const orig = newSessionBtn.textContent;
      newSessionBtn.innerHTML = '<span class="loading"></span>';

      try {
        const res = await fetch('/api/sessions', { method: 'POST' });
        const data = await res.json();
        window.location.href = `/${data.sessionId}`;
      } catch {
        newSessionBtn.textContent = 'Error — retry';
        newSessionBtn.disabled = false;
        setTimeout(() => {
          newSessionBtn.textContent = orig;
        }, 2000);
      }
    });
  }

  // ---- Smooth scroll for nav links ----
  document.querySelectorAll('.nav-link[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });
})();
