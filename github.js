/* ============================================================
   GitHub → portfolio
   Adds your newest public repos under the pinned project(s) in the "Things I've built" list.
   Change the username below and everything else follows.
   If GitHub can't be reached, only the pinned project(s) from index.html show.
   ============================================================ */
(() => {
  'use strict';

  const GITHUB_USER = 'nikhil-online';
  const MAX_REPOS = 3;                           // plus the pinned project(s) already in the list
  const CACHE_KEY = 'gh-repos:' + GITHUB_USER;
  const CACHE_MS = 10 * 60 * 1000;               // GitHub allows 60 anonymous requests / hour

  const list = document.querySelector('.projects');
  if (!list) return;

  const EMOJI = {
    JavaScript: '⚡', TypeScript: '🔷', Python: '🐍', Java: '☕', HTML: '🌐', CSS: '🎨',
    'C++': '⚙️', C: '⚙️', 'C#': '🎮', Go: '🐹', Rust: '🦀', PHP: '🐘', Ruby: '💎', Kotlin: '🤖', Swift: '🕊️',
    'Jupyter Notebook': '📓', Shell: '💻',
  };

  const fromCache = () => {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      return c && Date.now() - c.t < CACHE_MS ? c.repos : null;
    } catch (e) { return null; }
  };
  const toCache = (repos) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), repos })); } catch (e) { /* private mode */ }
  };

  async function load() {
    const cached = fromCache();
    if (cached) return cached;
    const res = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=pushed`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('GitHub responded ' + res.status);
    const repos = (await res.json())
      .filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== GITHUB_USER.toLowerCase())
      .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
      .slice(0, MAX_REPOS)
      .map((r) => ({ name: r.name, url: r.html_url, desc: r.description, lang: r.language, stars: r.stargazers_count }));
    toCache(repos);
    return repos;
  }

  function render(repos) {
    if (!repos.length) return;                    // nothing public yet → keep just the pinned project(s)
    const frag = document.createDocumentFragment();
    repos.forEach((r) => {
      const li = document.createElement('li');

      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.textContent = EMOJI[r.lang] || '📦';

      const body = document.createElement('span');
      const a = document.createElement('a');
      a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
      const b = document.createElement('b');
      b.textContent = r.name;                     // textContent: repo data is never parsed as HTML
      a.appendChild(b);
      body.appendChild(a);
      body.appendChild(document.createTextNode(' · ' + (r.desc || (r.lang ? r.lang + ' project' : 'Project on GitHub'))));
      if (r.lang) {
        const tag = document.createElement('em');
        tag.className = 'lang';
        tag.textContent = r.lang;
        body.appendChild(tag);
      }

      li.append(ico, body);
      frag.appendChild(li);
    });
    list.querySelectorAll('li:not([data-pinned])').forEach((li) => li.remove());
    list.appendChild(frag);                       // pinned projects stay on top
    list.dataset.source = 'github';
  }

  load().then(render).catch(() => { /* offline or rate-limited: pinned project(s) still show */ });
})();
