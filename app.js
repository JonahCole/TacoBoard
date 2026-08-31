(() => {
  'use strict';

  const STORAGE_KEY = 'tacoboard:poc:v1';
  const COLORS = ['#fff4b8', '#ffd9c8', '#d9edc7', '#d7e9ff', '#ead9ff', '#ffffff'];
  const THEMES = ['fiesta', 'verde', 'night', 'sunset', 'paper'];
  const STICKERS = ['🌮','🌶️','🥑','🧀','🍋‍🟩','🔥','✨','💛','🎉','🤠','🫶','💯','🏆','🪩','😎','🦖','👑','🚀','🍻','🤘'];

  const seed = {
    title: 'A TacoBoard for Someone Awesome',
    subtitle: 'Leave a note. Drop a GIF. Make it weirdly heartfelt.',
    theme: 'fiesta',
    posts: [],
    stickers: [
      { id: cryptoId(), emoji: '🌮', x: 72, y: 70, rotation: -10, size: 1.18 },
      { id: cryptoId(), emoji: '✨', x: 83, y: 76, rotation: 9, size: .82 }
    ]
  };

  let state = loadState();
  let selectedColor = COLORS[0];
  let editingPostId = null;
  let uploadedMediaData = '';
  let dragState = null;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const boardItems = $('boardItems');
  const emptyState = $('emptyState');
  const postDialog = $('postDialog');
  const stickerDialog = $('stickerDialog');
  const settingsDialog = $('settingsDialog');
  const postForm = $('postForm');

  setupStaticUI();
  render();

  function setupStaticUI() {
    $('addPostBtn').addEventListener('click', () => openPostDialog());
    $('emptyAddBtn').addEventListener('click', () => openPostDialog());
    $('addStickerBtn').addEventListener('click', () => stickerDialog.showModal());
    $('openSettingsBtn').addEventListener('click', openSettings);
    $('messageInput').addEventListener('input', updateCharCount);
    $('postForm').addEventListener('submit', handlePostSubmit);
    $('settingsForm').addEventListener('submit', handleSettingsSubmit);
    $('resetBoardBtn').addEventListener('click', resetBoard);

    document.querySelectorAll('.dialog-close').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('dialog')?.close());
    });

    $('exportMenuBtn').addEventListener('click', (event) => {
      event.stopPropagation();
      $('exportMenu').hidden = !$('exportMenu').hidden;
    });
    document.addEventListener('click', () => { $('exportMenu').hidden = true; });
    $('exportMenu').addEventListener('click', (e) => e.stopPropagation());

    $('exportPngBtn').addEventListener('click', exportPNG);
    $('exportPdfBtn').addEventListener('click', exportPDF);
    $('exportJsonBtn').addEventListener('click', exportJSON);
    $('importJsonInput').addEventListener('change', importJSON);

    $('mediaFileInput').addEventListener('change', handleMediaUpload);
    $('mediaUrlInput').addEventListener('input', () => {
      uploadedMediaData = '';
      renderMediaPreview($('mediaUrlInput').value.trim());
    });

    document.querySelectorAll('.media-tab').forEach(btn => {
      btn.addEventListener('click', () => switchMediaTab(btn.dataset.mediaTab));
    });

    COLORS.forEach((color, index) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch' + (index === 0 ? ' selected' : '');
      swatch.style.background = color;
      swatch.setAttribute('aria-label', `Card color ${index + 1}`);
      swatch.addEventListener('click', () => {
        selectedColor = color;
        document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('selected', s === swatch));
      });
      $('colorSwatches').appendChild(swatch);
    });

    STICKERS.forEach(emoji => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sticker-choice';
      button.textContent = emoji;
      button.setAttribute('aria-label', `Add ${emoji} sticker`);
      button.addEventListener('click', () => {
        addSticker(emoji);
        stickerDialog.close();
      });
      $('stickerGrid').appendChild(button);
    });

    THEMES.forEach(theme => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-choice';
      button.dataset.theme = theme;
      button.title = theme;
      button.addEventListener('click', () => {
        document.querySelectorAll('.theme-choice').forEach(t => t.classList.toggle('selected', t === button));
        $('themeGrid').dataset.selected = theme;
      });
      $('themeGrid').appendChild(button);
    });

    boardItems.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    window.addEventListener('resize', () => {
      clampAllItemsToBoard();
      render();
    });
  }

  function render() {
    board.dataset.theme = state.theme || 'fiesta';
    $('boardTitleDisplay').textContent = state.title;
    $('boardSubtitleDisplay').textContent = state.subtitle;
    boardItems.innerHTML = '';

    state.posts.forEach((post, index) => boardItems.appendChild(createPostElement(post, index)));
    state.stickers.forEach(sticker => boardItems.appendChild(createStickerElement(sticker)));
    emptyState.hidden = state.posts.length > 0;
    requestAnimationFrame(updateBoardHeight);
  }

  function createPostElement(post, index) {
    const el = document.createElement('article');
    el.className = 'note-card';
    el.dataset.id = post.id;
    el.dataset.kind = 'post';
    el.style.background = post.color;
    el.style.left = `${post.x}%`;
    el.style.top = `${post.y}px`;
    el.style.transform = `rotate(${post.rotation}deg)`;
    el.style.zIndex = String(10 + index);

    const grip = document.createElement('span');
    grip.className = 'card-grip';
    grip.textContent = '•••';
    el.appendChild(grip);

    if (post.media) {
      const media = document.createElement('div');
      media.className = 'media';
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'eager';
      if (!post.media.startsWith('data:') && !post.media.startsWith('blob:')) img.crossOrigin = 'anonymous';
      img.src = post.media;
      img.onload = () => updateBoardHeight();
      img.onerror = () => { media.remove(); updateBoardHeight(); };
      media.appendChild(img);
      el.appendChild(media);
    }

    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = post.message;
    el.appendChild(message);

    const author = document.createElement('div');
    author.className = 'author';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = getInitial(post.author);
    const name = document.createElement('span');
    name.textContent = post.author;
    author.append(avatar, name);

    const actions = document.createElement('span');
    actions.className = 'card-actions no-export-controls';
    const editBtn = miniButton('✏️', 'Edit note', (e) => { e.stopPropagation(); openPostDialog(post.id); });
    const deleteBtn = miniButton('×', 'Delete note', (e) => { e.stopPropagation(); deletePost(post.id); });
    actions.append(editBtn, deleteBtn);
    author.appendChild(actions);
    el.appendChild(author);
    return el;
  }

  function createStickerElement(sticker) {
    const el = document.createElement('div');
    el.className = 'board-sticker';
    el.dataset.id = sticker.id;
    el.dataset.kind = 'sticker';
    el.style.left = `${sticker.x}%`;
    el.style.top = `${sticker.y}px`;
    el.style.transform = `rotate(${sticker.rotation}deg) scale(${sticker.size || 1})`;
    el.textContent = sticker.emoji;

    const remove = document.createElement('button');
    remove.className = 'remove-sticker no-export-controls';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove sticker');
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      state.stickers = state.stickers.filter(s => s.id !== sticker.id);
      saveState();
      render();
    });
    el.appendChild(remove);
    return el;
  }

  function miniButton(text, label, fn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-mini-btn';
    btn.textContent = text;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', fn);
    return btn;
  }

  function openPostDialog(postId = null) {
    editingPostId = postId;
    const post = postId ? state.posts.find(p => p.id === postId) : null;
    $('authorInput').value = post?.author || localStorage.getItem('tacoboard:last-author') || '';
    $('messageInput').value = post?.message || '';
    selectedColor = post?.color || COLORS[Math.floor(Math.random() * COLORS.length)];
    $('mediaUrlInput').value = post && !post.media?.startsWith('data:') ? post.media : '';
    uploadedMediaData = post?.media?.startsWith('data:') ? post.media : '';
    $('mediaFileInput').value = '';
    renderMediaPreview(post?.media || '');
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('selected', rgbToHex(s.style.backgroundColor) === selectedColor.toLowerCase()));
    updateCharCount();
    $('submitPostBtn').textContent = post ? 'Update taco note 🌮' : 'Drop it on the board 🌮';
    postDialog.showModal();
    setTimeout(() => (post ? $('messageInput') : $('authorInput')).focus(), 30);
  }

  function handlePostSubmit(event) {
    event.preventDefault();
    const author = $('authorInput').value.trim();
    const message = $('messageInput').value.trim();
    if (!author || !message) return;

    const media = uploadedMediaData || $('mediaUrlInput').value.trim();
    localStorage.setItem('tacoboard:last-author', author);

    if (editingPostId) {
      const post = state.posts.find(p => p.id === editingPostId);
      if (post) Object.assign(post, { author, message, media, color: selectedColor });
      showToast('Taco note updated');
    } else {
      const position = nextPostPosition();
      state.posts.push({
        id: cryptoId(), author, message, media, color: selectedColor,
        x: position.x, y: position.y, rotation: randomBetween(-3.2, 3.2)
      });
      showToast('Taco delivered 🌮');
    }

    saveState();
    postDialog.close();
    render();
  }

  function deletePost(id) {
    if (!confirm('Remove this taco note from the board?')) return;
    state.posts = state.posts.filter(p => p.id !== id);
    saveState();
    render();
    showToast('Note removed');
  }

  function addSticker(emoji) {
    state.stickers.push({
      id: cryptoId(), emoji,
      x: randomBetween(8, 85), y: randomBetween(60, Math.max(80, board.clientHeight - 120)),
      rotation: randomBetween(-16, 16), size: randomBetween(.78, 1.22)
    });
    saveState();
    render();
    showToast(`${emoji} sticker added`);
  }

  function openSettings() {
    $('boardTitleInput').value = state.title;
    $('boardSubtitleInput').value = state.subtitle;
    $('themeGrid').dataset.selected = state.theme;
    document.querySelectorAll('.theme-choice').forEach(t => t.classList.toggle('selected', t.dataset.theme === state.theme));
    settingsDialog.showModal();
  }

  function handleSettingsSubmit(event) {
    event.preventDefault();
    state.title = $('boardTitleInput').value.trim() || seed.title;
    state.subtitle = $('boardSubtitleInput').value.trim() || seed.subtitle;
    state.theme = $('themeGrid').dataset.selected || state.theme;
    saveState();
    settingsDialog.close();
    render();
    showToast('Board updated');
  }

  function resetBoard() {
    if (!confirm('Reset the entire TacoBoard? This clears all notes and stickers.')) return;
    state = structuredCloneSafe(seed);
    saveState();
    settingsDialog.close();
    render();
    showToast('Fresh tortilla, fresh board');
  }

  function updateBoardHeight() {
    let maxBottom = 690;
    boardItems.querySelectorAll('[data-kind]').forEach(el => {
      maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight + 42);
    });
    boardItems.style.height = `${maxBottom}px`;
  }

  function nextPostPosition() {
    const width = board.clientWidth || 1200;
    const cardWidth = width < 650 ? Math.min(310, width - 48) : 310;
    const colWidth = cardWidth + 24;
    const cols = Math.max(1, Math.floor((width - 40) / colWidth));
    const index = state.posts.length;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const xPx = 20 + col * colWidth + randomBetween(-5, 8);
    return {
      x: clamp((xPx / width) * 100, 1.5, Math.max(1.5, 100 - ((cardWidth + 15) / width * 100))),
      y: 26 + row * 245 + randomBetween(-4, 12)
    };
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button') || event.target.closest('.message')) return;
    const item = event.target.closest('[data-kind]');
    if (!item) return;
    const id = item.dataset.id;
    const kind = item.dataset.kind;
    const record = kind === 'post' ? state.posts.find(p => p.id === id) : state.stickers.find(s => s.id === id);
    if (!record) return;

    const boardRect = boardItems.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    dragState = {
      id, kind, item, boardRect,
      offsetX: event.clientX - itemRect.left,
      offsetY: event.clientY - itemRect.top,
      pointerId: event.pointerId
    };
    item.classList.add('dragging');
    item.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!dragState) return;
    const { item, boardRect, offsetX, offsetY, kind, id } = dragState;
    const itemWidth = item.offsetWidth;
    const itemHeight = item.offsetHeight;
    const xPx = clamp(event.clientX - boardRect.left - offsetX, 0, Math.max(0, boardRect.width - itemWidth));
    const yPx = clamp(event.clientY - boardRect.top - offsetY, 0, Math.max(0, boardRect.height - itemHeight));
    item.style.left = `${(xPx / boardRect.width) * 100}%`;
    item.style.top = `${yPx}px`;

    const record = kind === 'post' ? state.posts.find(p => p.id === id) : state.stickers.find(s => s.id === id);
    if (record) { record.x = (xPx / boardRect.width) * 100; record.y = yPx; }
    event.preventDefault();
  }

  function endDrag() {
    if (!dragState) return;
    dragState.item.classList.remove('dragging');
    saveState();
    dragState = null;
  }

  function clampAllItemsToBoard() {
    const width = board.clientWidth || 1200;
    const maxPostX = Math.max(2, 100 - ((310 + 15) / width * 100));
    state.posts.forEach(p => { p.x = clamp(p.x, 0, maxPostX); p.y = Math.max(0, p.y); });
    state.stickers.forEach(s => { s.x = clamp(s.x, 0, 94); s.y = Math.max(0, s.y); });
    saveState();
  }

  function switchMediaTab(tab) {
    document.querySelectorAll('.media-tab').forEach(b => b.classList.toggle('active', b.dataset.mediaTab === tab));
    $('uploadPane').classList.toggle('active', tab === 'upload');
    $('urlPane').classList.toggle('active', tab === 'url');
  }

  function handleMediaUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      showToast('That file is a bit huge — keep it under 3 MB for this browser-only POC');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      uploadedMediaData = String(reader.result || '');
      $('mediaUrlInput').value = '';
      renderMediaPreview(uploadedMediaData);
    };
    reader.readAsDataURL(file);
  }

  function renderMediaPreview(src) {
    const preview = $('mediaPreview');
    preview.innerHTML = '';
    if (!src) { preview.hidden = true; return; }
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Media preview';
    img.onload = () => { preview.hidden = false; };
    img.onerror = () => { preview.hidden = true; };
    preview.appendChild(img);
  }

  function updateCharCount() { $('charCount').textContent = String($('messageInput').value.length); }

  async function captureBoard() {
    if (!window.html2canvas) throw new Error('Export library failed to load');
    document.body.classList.add('exporting');
    const previous = board.style.overflow;
    board.style.overflow = 'visible';
    try {
      const canvas = await html2canvas(board, {
        backgroundColor: null,
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
        allowTaint: false,
        logging: false
      });
      return canvas;
    } finally {
      board.style.overflow = previous;
      document.body.classList.remove('exporting');
    }
  }

  async function exportPNG() {
    $('exportMenu').hidden = true;
    showToast('Making your keepsake…');
    try {
      const canvas = await captureBoard();
      const link = document.createElement('a');
      link.download = `${slugify(state.title)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('PNG saved 🌮');
    } catch (err) {
      console.error(err);
      showToast('Could not export. Try uploaded media instead of a remote GIF URL.');
    }
  }

  async function exportPDF() {
    $('exportMenu').hidden = true;
    showToast('Pressing tortillas into PDF…');
    try {
      const canvas = await captureBoard();
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) throw new Error('PDF library failed to load');
      const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      const x = (pageW - w) / 2;
      const y = (pageH - h) / 2;
      pdf.addImage(canvas.toDataURL('image/jpeg', .94), 'JPEG', x, y, w, h, undefined, 'FAST');
      pdf.save(`${slugify(state.title)}.pdf`);
      showToast('PDF saved 🌮');
    } catch (err) {
      console.error(err);
      showToast('Could not export. Try uploaded media instead of a remote GIF URL.');
    }
  }

  function exportJSON() {
    $('exportMenu').hidden = true;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${slugify(state.title)}-data.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast('Board data exported');
  }

  async function importJSON(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const next = JSON.parse(await file.text());
      if (!next || !Array.isArray(next.posts) || !Array.isArray(next.stickers)) throw new Error('Invalid TacoBoard data');
      state = {
        title: String(next.title || seed.title),
        subtitle: String(next.subtitle || seed.subtitle),
        theme: THEMES.includes(next.theme) ? next.theme : 'fiesta',
        posts: next.posts,
        stickers: next.stickers
      };
      saveState();
      render();
      showToast('Board imported');
    } catch (err) {
      console.error(err);
      showToast('That does not look like TacoBoard data');
    } finally {
      event.target.value = '';
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneSafe(seed);
      const parsed = JSON.parse(raw);
      return {
        title: parsed.title || seed.title,
        subtitle: parsed.subtitle || seed.subtitle,
        theme: THEMES.includes(parsed.theme) ? parsed.theme : seed.theme,
        posts: Array.isArray(parsed.posts) ? parsed.posts : [],
        stickers: Array.isArray(parsed.stickers) ? parsed.stickers : structuredCloneSafe(seed.stickers)
      };
    } catch {
      return structuredCloneSafe(seed);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error(err);
      showToast('Browser storage is full — export the board data before adding more media.');
    }
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function getInitial(name) { return (name.trim()[0] || '🌮').toUpperCase(); }
  function randomBetween(min, max) { return min + Math.random() * (max - min); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function cryptoId() { return (globalThis.crypto?.randomUUID?.() || `taco-${Date.now()}-${Math.random().toString(16).slice(2)}`); }
  function slugify(text) { return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tacoboard'; }
  function structuredCloneSafe(value) { return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  function rgbToHex(rgb) {
    if (!rgb) return '';
    if (rgb.startsWith('#')) return rgb.toLowerCase();
    const nums = rgb.match(/\d+/g)?.slice(0,3).map(Number);
    return nums?.length === 3 ? `#${nums.map(n => n.toString(16).padStart(2,'0')).join('')}` : rgb;
  }
})();
