(() => {
  'use strict';

  const COLORS = ['#fff4b8', '#ffd9c8', '#d9edc7', '#d7e9ff', '#ead9ff', '#ffffff'];
  const THEMES = ['fiesta', 'verde', 'night', 'sunset', 'paper', 'corporate'];
  const STICKERS = ['🌮','🌶️','🥑','🧀','🍋‍🟩','🔥','✨','💛','🎉','🤠','🫶','💯','🏆','🪩','😎','🦖','👑','🚀','🍻','🤘'];
  const MAX_UPLOAD = 1.25 * 1024 * 1024;
  const CONFIG = window.TACOBOARD_CONFIG || {};
  const isRemote = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY && window.supabase?.createClient);
  const client = isRemote ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY) : null;

  let current = {
    slug: '', token: '', role: 'contributor', isAdmin: false,
    contributorToken: '', board: null, posts: [], stickers: [],
    userId: '', tacoName: '', isAuthenticated: false
  };
  let selectedColor = COLORS[0];
  let editingPostId = null;
  let uploadedMediaData = '';
  let selectedGifUrl = '';
  let dragState = null;
  let toastTimer = null;
  let realtimeChannel = null;
  let refreshTimer = null;
  let isRefreshing = false;
  let identityResolver = null;

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const boardItems = $('boardItems');
  const postDialog = $('postDialog');
  const settingsDialog = $('settingsDialog');
  const stickerDialog = $('stickerDialog');
  const shareDialog = $('shareDialog');
  const identityDialog = $('identityDialog');

  setupUI();
  boot();

  function setupUI() {
    $('brandButton').addEventListener('click', goHome);
    $('createBoardForm').addEventListener('submit', createBoard);
    $('addPostBtn').addEventListener('click', () => openPostDialog());
    $('emptyAddBtn').addEventListener('click', () => openPostDialog());
    $('addStickerBtn').addEventListener('click', () => stickerDialog.showModal());
    $('openSettingsBtn').addEventListener('click', openSettings);
    $('shareBtn').addEventListener('click', openShare);
    $('messageInput').addEventListener('input', updateCharCount);
    $('postForm').addEventListener('submit', submitPost);
    $('settingsForm').addEventListener('submit', saveSettings);
    $('toggleServeBtn').addEventListener('click', toggleServed);
    $('identityForm').addEventListener('submit', claimTacoIdentity);
    $('identityCancelBtn').addEventListener('click', cancelIdentity);
    identityDialog.addEventListener('cancel', event => { event.preventDefault(); cancelIdentity(); });

    $('exportMenuBtn').addEventListener('click', (event) => {
      event.stopPropagation();
      $('exportMenu').hidden = !$('exportMenu').hidden;
    });
    document.addEventListener('click', () => { $('exportMenu').hidden = true; });
    $('exportMenu').addEventListener('click', e => e.stopPropagation());
    $('exportPngBtn').addEventListener('click', exportPNG);
    $('exportPdfBtn').addEventListener('click', exportPDF);
    $('exportJsonBtn').addEventListener('click', exportJSON);

    document.querySelectorAll('.dialog-close').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog')?.close()));
    document.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => copyField(btn.dataset.copy)));

    $('mediaFileInput').addEventListener('change', handleMediaUpload);
    $('mediaUrlInput').addEventListener('input', () => {
      uploadedMediaData = '';
      selectedGifUrl = '';
      renderMediaPreview($('mediaUrlInput').value.trim());
    });
    document.querySelectorAll('.media-tab').forEach(btn => btn.addEventListener('click', () => switchMediaTab(btn.dataset.mediaTab)));
    $('giphySearchBtn').addEventListener('click', searchGiphy);
    $('giphySearchInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); searchGiphy(); }
    });

    COLORS.forEach((color, index) => {
      const swatch = document.createElement('button');
      swatch.type = 'button'; swatch.className = 'swatch' + (index === 0 ? ' selected' : ''); swatch.style.background = color;
      swatch.setAttribute('aria-label', `Card color ${index + 1}`);
      swatch.addEventListener('click', () => {
        selectedColor = color;
        document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('selected', s === swatch));
      });
      $('colorSwatches').appendChild(swatch);
    });

    STICKERS.forEach(emoji => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'sticker-choice'; button.textContent = emoji;
      button.addEventListener('click', async () => { stickerDialog.close(); await addSticker(emoji); });
      $('stickerGrid').appendChild(button);
    });

    THEMES.forEach(theme => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'theme-choice'; button.dataset.theme = theme; button.title = theme === 'corporate' ? 'Corporate Beige (tragic)' : theme;
      button.addEventListener('click', () => {
        document.querySelectorAll('.theme-choice').forEach(t => t.classList.toggle('selected', t === button));
        $('themeGrid').dataset.selected = theme;
      });
      $('themeGrid').appendChild(button);
    });

    boardItems.addEventListener('pointerdown', beginDrag);
    window.addEventListener('pointermove', moveDrag, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => { if (current.board) { clampItems(); renderBoard(); } });

    if (!CONFIG.GIPHY_API_KEY) {
      $('giphyTab').title = 'Add a GIPHY API key in config.js to enable search';
    }
  }

  async function boot() {
    if (!isRemote) {
      $('createModeHelp').textContent = 'Local preview mode — add Supabase config when you are ready to share.';
    }
    const params = new URLSearchParams(location.search);
    const slug = params.get('board');
    const admin = params.get('admin');
    const key = params.get('key');
    if (!slug) return showHome();
    current.slug = slug;
    current.token = admin || key || '';
    current.isAdmin = Boolean(admin);
    current.role = current.isAdmin ? 'admin' : 'contributor';
    if (isRemote) await restoreTacoIdentity();
    if (!current.token && !isRemote) current.token = 'local-admin';
    if (!current.token) return showFatal('Missing taco key', 'This TacoBoard link is incomplete. Ask the board owner for the contributor link again.');
    await loadBoard(true);
  }

  function showHome() {
    teardownRealtime();
    $('homeView').hidden = false;
    $('boardView').hidden = true;
    $('boardActions').hidden = true;
    document.title = 'TacoBoard 🌮';
  }

  function showBoardView() {
    $('homeView').hidden = true;
    $('boardView').hidden = false;
    $('boardActions').hidden = false;
    document.title = `${current.board?.title || 'TacoBoard'} 🌮`;
  }

  function goHome() {
    history.pushState({}, '', location.pathname);
    current = { slug:'', token:'', role:'contributor', isAdmin:false, contributorToken:'', board:null, posts:[], stickers:[], userId:current.userId||'', tacoName:current.tacoName||'', isAuthenticated:current.isAuthenticated||false };
    showHome();
  }

  async function createBoard(event) {
    event.preventDefault();
    const recipient = $('recipientInput').value.trim();
    const occasion = $('occasionInput').value.trim();
    if (!recipient) return;
    setBusy($('createBoardBtn'), true, 'Warming tortillas…');
    try {
      const title = `A TacoBoard for ${recipient}`;
      const subtitle = occasion || 'Leave a note. Drop a GIF. Make it weirdly heartfelt.';
      const created = isRemote ? await remoteCreateBoard(title, subtitle) : localCreateBoard(title, subtitle);
      current.slug = created.slug;
      current.token = created.admin_token;
      current.isAdmin = true;
      current.role = 'admin';
      current.contributorToken = created.contributor_token;
      const url = buildBoardUrl({ slug: created.slug, admin: created.admin_token });
      history.replaceState({}, '', url);
      await loadBoard(true);
      openShare();
      showToast(isRemote ? 'Fresh TacoBoard, ready to share 🌮' : 'Local TacoBoard created 🌮');
    } catch (err) {
      handleError(err, 'Could not create the TacoBoard');
    } finally {
      setBusy($('createBoardBtn'), false, 'Create TacoBoard 🌮');
    }
  }

  async function loadBoard(initial = false) {
    if (isRefreshing) return;
    isRefreshing = true;
    if (initial) $('syncStatus').textContent = 'Connecting the salsa…';
    try {
      const data = isRemote ? await remoteGetBoard() : localGetBoard();
      if (!data?.board) throw new Error('Board not found or taco key is invalid.');
      current.board = data.board;
      current.posts = data.posts || [];
      current.stickers = data.stickers || [];
      current.isAdmin = Boolean(data.is_admin ?? current.isAdmin);
      current.role = current.isAdmin ? 'admin' : 'contributor';
      current.contributorToken = data.contributor_token || current.contributorToken || '';
      current.isAuthenticated = Boolean(data.is_authenticated || current.userId);
      showBoardView();
      renderBoard();
      updateRoleUI();
      $('localNotice').hidden = isRemote;
      $('syncStatus').textContent = isRemote ? 'Shared board • live-ish salsa sync' : 'Saved locally in this browser';
      if (isRemote && initial) setupRealtime();
    } catch (err) {
      if (initial) showFatal('TacoBoard unavailable', friendlyError(err)); else console.error(err);
    } finally {
      isRefreshing = false;
    }
  }

  function renderBoard() {
    const b = current.board;
    if (!b) return;
    boardEl.dataset.theme = b.theme || 'fiesta';
    $('boardTitleDisplay').textContent = b.title;
    $('boardSubtitleDisplay').textContent = b.subtitle;
    $('boardEyebrow').textContent = b.status === 'served' ? '🍽️ THIS TACOBOARD HAS BEEN SERVED' : '🌮 OPEN FOR TACO BUSINESS';
    $('servedNotice').hidden = b.status !== 'served';
    $('addPostBtn').hidden = b.status === 'served';
    $('emptyAddBtn').hidden = b.status === 'served';
    boardItems.innerHTML = '';
    current.posts.forEach((post, index) => boardItems.appendChild(createPostElement(post, index)));
    current.stickers.forEach(sticker => boardItems.appendChild(createStickerElement(sticker)));
    $('emptyState').hidden = current.posts.length > 0;
    $('boardStats').textContent = `🌮 ${current.posts.length} taco${current.posts.length === 1 ? '' : 's'} • ${current.stickers.length} questionable sticker${current.stickers.length === 1 ? '' : 's'}`;
    requestAnimationFrame(updateBoardHeight);
  }

  function updateRoleUI() {
    document.querySelectorAll('.admin-only').forEach(el => el.hidden = !current.isAdmin);
    $('addStickerBtn').hidden = current.board?.status === 'served';
    $('rolePill').textContent = current.isAdmin ? '🌶️ Board boss' : (current.tacoName ? `🌮 ${current.tacoName}` : '🌮 Taco contributor');
    $('identityHint').hidden = current.isAdmin || Boolean(current.tacoName) || current.board?.status === 'served';
    if (current.board?.status === 'served') $('rolePill').textContent = current.isAdmin ? '🍽️ Served • admin' : (current.tacoName ? `🍽️ ${current.tacoName}` : '🍽️ Served');
  }

  function createPostElement(post, index) {
    const el = document.createElement('article');
    const canManage = current.isAdmin || (Boolean(post.is_owner) && current.board?.status === 'open');
    el.className = 'note-card' + (canManage ? ' admin-draggable' : '');
    el.dataset.id = post.id; el.dataset.kind = 'post';
    el.style.background = post.color || COLORS[0]; el.style.left = `${Number(post.x) || 0}%`; el.style.top = `${Number(post.y) || 0}px`; el.style.transform = `rotate(${Number(post.rotation) || 0}deg)`; el.style.zIndex = String(10 + index);
    const grip = document.createElement('span'); grip.className = 'card-grip'; grip.textContent = canManage ? '•••' : '🌮'; el.appendChild(grip);
    if (post.media) {
      const media = document.createElement('div'); media.className = 'media';
      const img = document.createElement('img'); img.alt = ''; img.loading = 'eager';
      if (!post.media.startsWith('data:') && !post.media.startsWith('blob:')) img.crossOrigin = 'anonymous';
      img.src = post.media; img.onload = updateBoardHeight; img.onerror = () => { media.remove(); updateBoardHeight(); };
      media.appendChild(img); el.appendChild(media);
    }
    const message = document.createElement('div'); message.className = 'message'; message.textContent = post.message; el.appendChild(message);
    const author = document.createElement('div'); author.className = 'author';
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = getInitial(post.author);
    const name = document.createElement('span'); name.textContent = post.author; author.append(avatar, name);
    if (post.is_owner && !current.isAdmin) { const yours=document.createElement('span'); yours.className='yours-pill'; yours.textContent='your taco'; author.appendChild(yours); }
    if (canManage) {
      const actions = document.createElement('span'); actions.className = 'card-actions no-export-controls';
      actions.append(miniButton('✏️','Edit note',e => { e.stopPropagation(); openPostDialog(post.id); }), miniButton('×','Delete note',e => { e.stopPropagation(); deletePost(post.id); }));
      author.appendChild(actions);
    }
    el.appendChild(author); return el;
  }

  function createStickerElement(sticker) {
    const el = document.createElement('div');
    const canManage = current.isAdmin || (Boolean(sticker.is_owner) && current.board?.status === 'open');
    el.className = 'board-sticker' + (canManage ? ' admin-draggable' : '');
    el.dataset.id = sticker.id; el.dataset.kind = 'sticker'; el.style.left = `${Number(sticker.x) || 0}%`; el.style.top = `${Number(sticker.y) || 0}px`; el.style.transform = `rotate(${Number(sticker.rotation) || 0}deg) scale(${Number(sticker.size) || 1})`; el.append(document.createTextNode(sticker.emoji));
    if (canManage) {
      const remove = document.createElement('button'); remove.className = 'remove-sticker no-export-controls'; remove.textContent = '×'; remove.setAttribute('aria-label','Remove sticker');
      remove.addEventListener('click', async e => { e.stopPropagation(); await deleteSticker(sticker.id); }); el.appendChild(remove);
    }
    return el;
  }

  function miniButton(text, label, fn) { const b=document.createElement('button'); b.type='button'; b.className='card-mini-btn'; b.textContent=text; b.setAttribute('aria-label',label); b.addEventListener('click',fn); return b; }

  async function restoreTacoIdentity() {
    if (!client) return;
    try {
      const {data,error}=await client.auth.getSession(); if(error) throw error;
      const user=data?.session?.user;
      if (user) {
        current.userId=user.id;
        current.isAuthenticated=true;
        current.tacoName=String(user.user_metadata?.taco_name || localStorage.getItem('tacoboard:taco-name') || '').trim();
      }
    } catch(err) { console.warn('Could not restore Taco identity',err); }
  }

  function ensureTacoIdentity() {
    if (current.isAdmin || !isRemote) return Promise.resolve(true);
    if (current.userId && current.tacoName) return Promise.resolve(true);
    $('identityNameInput').value=current.tacoName || localStorage.getItem('tacoboard:taco-name') || '';
    $('identityError').hidden=true;
    identityDialog.showModal();
    setTimeout(()=>$('identityNameInput').focus(),30);
    return new Promise(resolve=>{ identityResolver=resolve; });
  }

  async function claimTacoIdentity(event) {
    event.preventDefault();
    const name=$('identityNameInput').value.trim(); if(!name) return;
    setBusy($('claimIdentityBtn'),true,'Claiming taco…'); $('identityError').hidden=true;
    try {
      let user=null;
      const {data:sessionData,error:sessionError}=await client.auth.getSession(); if(sessionError) throw sessionError;
      user=sessionData?.session?.user || null;
      if (!user) {
        const {data,error}=await client.auth.signInAnonymously({options:{data:{taco_name:name}}}); if(error) throw error;
        user=data?.user || data?.session?.user || null;
      }
      current.userId=user?.id || '';
      current.isAuthenticated=Boolean(current.userId);
      current.tacoName=name;
      localStorage.setItem('tacoboard:taco-name',name);
      identityDialog.close();
      const resolve=identityResolver; identityResolver=null;
      await loadBoard(); updateRoleUI();
      showToast(`Taco claimed, ${name} 🌮`);
      resolve?.(true);
    } catch(err) {
      console.error(err); $('identityError').textContent=friendlyError(err); $('identityError').hidden=false;
    } finally { setBusy($('claimIdentityBtn'),false,'Claim my taco 🌮'); }
  }

  function cancelIdentity() {
    identityDialog.close(); const resolve=identityResolver; identityResolver=null; resolve?.(false);
  }

  async function openPostDialog(postId = null) {
    if (current.board?.status === 'served' && !current.isAdmin) return showToast('This board has already been served 🍽️');
    if (!current.isAdmin && !(await ensureTacoIdentity())) return;
    editingPostId = postId;
    const post = postId ? current.posts.find(p => p.id === postId) : null;
    if (post && !current.isAdmin && !post.is_owner) return showToast('That taco belongs to somebody else 🌮');
    $('authorInput').value = post?.author || (current.isAdmin ? (localStorage.getItem('tacoboard:last-author') || '') : current.tacoName);
    $('authorInput').readOnly = !current.isAdmin;
    $('authorInput').classList.toggle('identity-locked', !current.isAdmin);
    $('messageInput').value = post?.message || '';
    selectedColor = post?.color || COLORS[Math.floor(Math.random()*COLORS.length)];
    uploadedMediaData = post?.media?.startsWith('data:') ? post.media : '';
    selectedGifUrl = '';
    $('mediaUrlInput').value = post && !post.media?.startsWith('data:') ? post.media : '';
    $('mediaFileInput').value = ''; $('giphyResults').innerHTML = ''; $('giphySearchInput').value = '';
    renderMediaPreview(post?.media || '');
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('selected', rgbToHex(s.style.backgroundColor) === selectedColor.toLowerCase()));
    updateCharCount();
    $('submitPostBtn').textContent = post ? 'Update taco note 🌮' : 'Drop it on the board 🌮';
    postDialog.showModal(); setTimeout(() => (post ? $('messageInput') : $('authorInput')).focus(), 30);
  }

  async function submitPost(event) {
    event.preventDefault();
    const author = $('authorInput').value.trim(), message = $('messageInput').value.trim();
    if (!author || !message) return;
    const media = uploadedMediaData || selectedGifUrl || $('mediaUrlInput').value.trim();
    localStorage.setItem('tacoboard:last-author', author);
    setBusy($('submitPostBtn'), true, 'Adding salsa…');
    try {
      if (editingPostId) {
        const owned = current.posts.find(p=>p.id===editingPostId)?.is_owner;
        if (!current.isAdmin && !owned) throw new Error('You can only edit your own taco notes.');
        await mutate('update_post', { post_id: editingPostId, author, message, media, color: selectedColor });
        showToast('Taco note updated');
      } else {
        const pos = nextPostPosition();
        await mutate('add_post', { author, message, media, color:selectedColor, x:pos.x, y:pos.y, rotation:randomBetween(-2.7,2.7) });
        rainTacos(); showToast('Taco delivered 🌮');
      }
      postDialog.close();
      await loadBoard();
      broadcastRefresh();
    } catch (err) { handleError(err, 'Could not add that taco'); }
    finally { setBusy($('submitPostBtn'), false, editingPostId ? 'Update taco note 🌮' : 'Drop it on the board 🌮'); editingPostId = null; }
  }

  async function deletePost(id) {
    const post=current.posts.find(p=>p.id===id); if(!post) return;
    if (!(current.isAdmin || post.is_owner) || !confirm('Delete this taco note?')) return;
    try { await mutate('delete_post',{post_id:id}); await loadBoard(); broadcastRefresh(); showToast('Taco note removed'); } catch(err){ handleError(err,'Could not delete that note'); }
  }

  async function addSticker(emoji) {
    if (current.board?.status === 'served') return showToast('This board has already been served 🍽️');
    if (!current.isAdmin && !(await ensureTacoIdentity())) return;
    const y = 55 + Math.random() * Math.max(180, boardItems.clientHeight - 160);
    try { await mutate('add_sticker',{emoji,x:65+Math.random()*22,y,rotation:randomBetween(-15,15),size:randomBetween(.78,1.2)}); await loadBoard(); broadcastRefresh(); showToast(`${emoji} deployed`); } catch(err){ handleError(err,'Could not add that sticker'); }
  }

  async function deleteSticker(id) {
    const sticker=current.stickers.find(s=>s.id===id); if(!sticker) return;
    if (!(current.isAdmin || sticker.is_owner)) return;
    try { await mutate('delete_sticker',{sticker_id:id}); await loadBoard(); broadcastRefresh(); } catch(err){ handleError(err,'Could not remove that sticker'); }
  }

  function openSettings() {
    if (!current.isAdmin || !current.board) return;
    $('boardTitleInput').value = current.board.title; $('boardSubtitleInput').value = current.board.subtitle; $('themeGrid').dataset.selected = current.board.theme;
    document.querySelectorAll('.theme-choice').forEach(t => t.classList.toggle('selected', t.dataset.theme === current.board.theme));
    updateServeUI(); settingsDialog.showModal();
  }

  async function saveSettings(event) {
    event.preventDefault();
    const title = $('boardTitleInput').value.trim(), subtitle = $('boardSubtitleInput').value.trim(), theme = $('themeGrid').dataset.selected || current.board.theme;
    if (!title) return;
    try { await mutate('update_board',{title,subtitle,theme}); settingsDialog.close(); await loadBoard(); broadcastRefresh(); showToast('Board seasoned to taste'); } catch(err){ handleError(err,'Could not save board settings'); }
  }

  function updateServeUI() {
    const served = current.board?.status === 'served';
    $('serveTitle').textContent = served ? 'Board already served.' : 'Ready to serve?';
    $('serveHelp').textContent = served ? 'Reopen it if somebody forgot to say the nice thing.' : 'Close contributions and turn this into the finished keepsake.';
    $('toggleServeBtn').textContent = served ? '🌮 Reopen board' : '🍽️ Serve board';
  }

  async function toggleServed() {
    if (!current.isAdmin) return;
    const next = current.board.status === 'served' ? 'open' : 'served';
    if (next === 'served' && !confirm('Serve this TacoBoard? Contributors will no longer be able to add notes until you reopen it.')) return;
    try { await mutate('set_status',{status:next}); await loadBoard(); broadcastRefresh(); updateServeUI(); showToast(next === 'served' ? 'TacoBoard served 🍽️' : 'Kitchen reopened 🌮'); } catch(err){ handleError(err,'Could not change board status'); }
  }

  function openShare() {
    if (!current.isAdmin) return;
    if (!current.contributorToken && isRemote) return showToast('Reload the admin link to recover sharing controls');
    $('contributorLinkInput').value = buildBoardUrl({ slug:current.slug, key:current.contributorToken || 'local' });
    $('adminLinkInput').value = buildBoardUrl({ slug:current.slug, admin:current.token });
    shareDialog.showModal();
  }

  async function copyField(id) {
    const value = $(id).value;
    try { await navigator.clipboard.writeText(value); showToast('Copied. Pass the tacos 🌮'); }
    catch { $(id).select(); document.execCommand('copy'); showToast('Copied 🌮'); }
  }

  function beginDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button') || event.target.closest('.message')) return;
    const item = event.target.closest('[data-kind]'); if (!item) return;
    const record = item.dataset.kind === 'post' ? current.posts.find(p=>p.id===item.dataset.id) : current.stickers.find(s=>s.id===item.dataset.id); if (!record) return;
    const canMove = current.isAdmin || (Boolean(record.is_owner) && current.board?.status === 'open');
    if (!canMove) return;
    const boardRect = boardItems.getBoundingClientRect(), itemRect = item.getBoundingClientRect();
    dragState = { id:item.dataset.id, kind:item.dataset.kind, item, boardRect, offsetX:event.clientX-itemRect.left, offsetY:event.clientY-itemRect.top };
    item.classList.add('dragging'); item.setPointerCapture?.(event.pointerId); event.preventDefault();
  }

  function moveDrag(event) {
    if (!dragState) return;
    const {item,boardRect,offsetX,offsetY,kind,id}=dragState;
    const xPx=clamp(event.clientX-boardRect.left-offsetX,0,Math.max(0,boardRect.width-item.offsetWidth));
    const yPx=clamp(event.clientY-boardRect.top-offsetY,0,Math.max(0,boardRect.height-item.offsetHeight));
    item.style.left=`${(xPx/boardRect.width)*100}%`; item.style.top=`${yPx}px`;
    const record=kind==='post'?current.posts.find(p=>p.id===id):current.stickers.find(s=>s.id===id); if(record){record.x=(xPx/boardRect.width)*100;record.y=yPx;}
    event.preventDefault();
  }

  async function endDrag() {
    if (!dragState) return;
    const d=dragState; d.item.classList.remove('dragging'); dragState=null;
    const record=d.kind==='post'?current.posts.find(p=>p.id===d.id):current.stickers.find(s=>s.id===d.id); if(!record)return;
    try { await mutate(d.kind==='post'?'move_post':'move_sticker',{[d.kind==='post'?'post_id':'sticker_id']:d.id,x:record.x,y:record.y}); broadcastRefresh(); } catch(err){ console.error(err); showToast('That taco wandered off. Refreshing…'); await loadBoard(); }
  }

  function clampItems() {
    const width=boardEl.clientWidth||1200, maxPostX=Math.max(2,100-((310+15)/width*100));
    current.posts.forEach(p=>{p.x=clamp(Number(p.x)||0,0,maxPostX);p.y=Math.max(0,Number(p.y)||0)}); current.stickers.forEach(s=>{s.x=clamp(Number(s.x)||0,0,94);s.y=Math.max(0,Number(s.y)||0)});
  }

  function nextPostPosition() {
    const width=boardEl.clientWidth||1200, cardWidth=width<650?Math.min(310,width-48):310, colWidth=cardWidth+24, cols=Math.max(1,Math.floor((width-40)/colWidth)), index=current.posts.length, col=index%cols,row=Math.floor(index/cols),xPx=20+col*colWidth+randomBetween(-5,8);
    return {x:clamp((xPx/width)*100,1.5,Math.max(1.5,100-((cardWidth+15)/width*100))),y:26+row*245+randomBetween(-4,12)};
  }

  function updateBoardHeight() {
    let maxBottom=690; boardItems.querySelectorAll('[data-kind]').forEach(el=>{maxBottom=Math.max(maxBottom,el.offsetTop+el.offsetHeight+42)}); boardItems.style.height=`${maxBottom}px`;
  }

  function switchMediaTab(tab) {
    if (tab === 'giphy' && !CONFIG.GIPHY_API_KEY) { showToast('Add a GIPHY API key in config.js to enable GIF search'); return; }
    document.querySelectorAll('.media-tab').forEach(b=>b.classList.toggle('active',b.dataset.mediaTab===tab));
    ['upload','url','giphy'].forEach(name => $(`${name}Pane`).classList.toggle('active',name===tab));
  }

  function handleMediaUpload(event) {
    const file=event.target.files?.[0]; if(!file)return;
    if(file.size>MAX_UPLOAD){showToast('Keep uploads under 1.25 MB in TacoBoard 2.0');event.target.value='';return;}
    const reader=new FileReader(); reader.onload=()=>{uploadedMediaData=String(reader.result||'');selectedGifUrl='';$('mediaUrlInput').value='';renderMediaPreview(uploadedMediaData)}; reader.readAsDataURL(file);
  }

  async function searchGiphy() {
    const q=$('giphySearchInput').value.trim(); if(!q||!CONFIG.GIPHY_API_KEY)return;
    setBusy($('giphySearchBtn'),true,'…'); $('giphyResults').innerHTML='';
    try {
      const url=new URL('https://api.giphy.com/v1/gifs/search'); url.searchParams.set('api_key',CONFIG.GIPHY_API_KEY); url.searchParams.set('q',q); url.searchParams.set('limit','12'); url.searchParams.set('rating','pg-13'); url.searchParams.set('lang','en');
      const response=await fetch(url); if(!response.ok)throw new Error('GIPHY search failed'); const json=await response.json();
      json.data.forEach(gif=>{const imgUrl=gif.images?.fixed_width?.url||gif.images?.downsized?.url;const preview=gif.images?.fixed_width_small?.url||imgUrl;if(!imgUrl)return;const b=document.createElement('button');b.type='button';b.className='gif-choice';const img=document.createElement('img');img.src=preview;img.alt=gif.title||'GIF';b.appendChild(img);b.addEventListener('click',()=>{selectedGifUrl=imgUrl;uploadedMediaData='';$('mediaUrlInput').value='';document.querySelectorAll('.gif-choice').forEach(x=>x.classList.toggle('selected',x===b));renderMediaPreview(imgUrl)});$('giphyResults').appendChild(b)});
      if(!$('giphyResults').children.length)$('giphyResults').textContent='No GIF tacos found.';
    } catch(err){console.error(err);showToast('GIPHY is being dramatic right now');} finally{setBusy($('giphySearchBtn'),false,'Search');}
  }

  function renderMediaPreview(src) { const p=$('mediaPreview');p.innerHTML='';if(!src){p.hidden=true;return}const img=document.createElement('img');img.src=src;img.alt='Media preview';img.onload=()=>{p.hidden=false};img.onerror=()=>{p.hidden=true};p.appendChild(img); }
  function updateCharCount(){ $('charCount').textContent=String($('messageInput').value.length); }

  async function mutate(action, payload) {
    if (isRemote) {
      const map={
        add_post:['add_tacoboard_post',{p_slug:current.slug,p_token:current.token,p_author:payload.author,p_message:payload.message,p_media:payload.media||'',p_color:payload.color,p_x:payload.x,p_y:payload.y,p_rotation:payload.rotation}],
        update_post:['update_tacoboard_post',{p_slug:current.slug,p_admin_token:current.token,p_post_id:payload.post_id,p_author:payload.author,p_message:payload.message,p_media:payload.media||'',p_color:payload.color}],
        delete_post:['delete_tacoboard_post',{p_slug:current.slug,p_admin_token:current.token,p_post_id:payload.post_id}],
        move_post:['move_tacoboard_post',{p_slug:current.slug,p_admin_token:current.token,p_post_id:payload.post_id,p_x:payload.x,p_y:payload.y}],
        add_sticker:['add_tacoboard_sticker',{p_slug:current.slug,p_token:current.token,p_emoji:payload.emoji,p_x:payload.x,p_y:payload.y,p_rotation:payload.rotation,p_size:payload.size}],
        delete_sticker:['delete_tacoboard_sticker',{p_slug:current.slug,p_admin_token:current.token,p_sticker_id:payload.sticker_id}],
        move_sticker:['move_tacoboard_sticker',{p_slug:current.slug,p_admin_token:current.token,p_sticker_id:payload.sticker_id,p_x:payload.x,p_y:payload.y}],
        update_board:['update_tacoboard',{p_slug:current.slug,p_admin_token:current.token,p_title:payload.title,p_subtitle:payload.subtitle,p_theme:payload.theme}],
        set_status:['set_tacoboard_status',{p_slug:current.slug,p_admin_token:current.token,p_status:payload.status}]
      };
      const entry=map[action]; if(!entry)throw new Error(`Unknown action ${action}`); const {data,error}=await client.rpc(entry[0],entry[1]); if(error)throw error; return data;
    }
    return localMutate(action,payload);
  }

  async function remoteCreateBoard(title, subtitle) {
    const {data,error}=await client.rpc('create_tacoboard',{p_title:title,p_subtitle:subtitle,p_theme:'fiesta'}); if(error)throw error; return data;
  }
  async function remoteGetBoard() {
    const {data,error}=await client.rpc('get_tacoboard',{p_slug:current.slug,p_token:current.token}); if(error)throw error; return data;
  }

  function localKey(slug){return `tacoboard:v2:${slug}`}
  function localCreateBoard(title,subtitle){const slug=`local-${randomToken(5)}`,admin_token='local-admin',contributor_token='local';const state={board:{id:cryptoId(),slug,title,subtitle,theme:'fiesta',status:'open',created_at:new Date().toISOString()},posts:[],stickers:[{id:cryptoId(),emoji:'🌮',x:72,y:70,rotation:-10,size:1.18},{id:cryptoId(),emoji:'✨',x:83,y:76,rotation:9,size:.82}],contributor_token};localStorage.setItem(localKey(slug),JSON.stringify(state));return{slug,admin_token,contributor_token}}
  function localGetBoard(){const raw=localStorage.getItem(localKey(current.slug));if(!raw)return null;const state=JSON.parse(raw);return{...state,is_admin:current.token==='local-admin',is_authenticated:true,contributor_token:current.token==='local-admin'?state.contributor_token:null}}
  function localMutate(action,p){const raw=localStorage.getItem(localKey(current.slug));if(!raw)throw new Error('Local board not found');const s=JSON.parse(raw),admin=current.token==='local-admin';if(s.board.status==='served'&&['add_post','add_sticker'].includes(action)&&!admin)throw new Error('This board has been served.');if(['update_post','delete_post','delete_sticker','update_board','set_status'].includes(action)&&!admin)throw new Error('Admin taco key required.');if(['move_post','move_sticker'].includes(action)&&!admin&&s.board.status!=='open')throw new Error('This board has been served.');
    if(action==='add_post')s.posts.push({id:cryptoId(),author:p.author,message:p.message,media:p.media||'',color:p.color,x:p.x,y:p.y,rotation:p.rotation,created_at:new Date().toISOString()});
    if(action==='update_post'){const x=s.posts.find(v=>v.id===p.post_id);if(x)Object.assign(x,{author:p.author,message:p.message,media:p.media||'',color:p.color})}
    if(action==='delete_post')s.posts=s.posts.filter(v=>v.id!==p.post_id);
    if(action==='move_post'){const x=s.posts.find(v=>v.id===p.post_id);if(x)Object.assign(x,{x:p.x,y:p.y})}
    if(action==='add_sticker')s.stickers.push({id:cryptoId(),emoji:p.emoji,x:p.x,y:p.y,rotation:p.rotation,size:p.size});
    if(action==='delete_sticker')s.stickers=s.stickers.filter(v=>v.id!==p.sticker_id);
    if(action==='move_sticker'){const x=s.stickers.find(v=>v.id===p.sticker_id);if(x)Object.assign(x,{x:p.x,y:p.y})}
    if(action==='update_board')Object.assign(s.board,{title:p.title,subtitle:p.subtitle,theme:p.theme});
    if(action==='set_status')s.board.status=p.status;
    localStorage.setItem(localKey(current.slug),JSON.stringify(s));return true;}

  function setupRealtime() {
    teardownRealtime();
    realtimeChannel=client.channel(`tacoboard-${current.slug}`)
      .on('broadcast',{event:'refresh'},()=>scheduleRefresh())
      .subscribe(status=>{if(status==='SUBSCRIBED')$('syncStatus').textContent='Shared board • live taco sync'});
  }
  function teardownRealtime(){if(realtimeChannel&&client){client.removeChannel(realtimeChannel)}realtimeChannel=null;clearTimeout(refreshTimer)}
  function broadcastRefresh(){if(!realtimeChannel)return;realtimeChannel.send({type:'broadcast',event:'refresh',payload:{at:Date.now()}}).catch?.(()=>{});}
  function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>loadBoard(),140)}

  async function captureBoard() {
    if(!window.html2canvas)throw new Error('Export library failed to load');document.body.classList.add('exporting');const previous=boardEl.style.overflow;boardEl.style.overflow='visible';
    try{return await html2canvas(boardEl,{backgroundColor:null,scale:Math.min(2,window.devicePixelRatio||1.5),useCORS:true,allowTaint:false,logging:false})}finally{boardEl.style.overflow=previous;document.body.classList.remove('exporting')}
  }
  async function exportPNG(){ $('exportMenu').hidden=true;showToast('Making your keepsake…');try{const canvas=await captureBoard(),link=document.createElement('a');link.download=`${slugify(current.board.title)}.png`;link.href=canvas.toDataURL('image/png');link.click();showToast('PNG saved 🌮')}catch(err){console.error(err);showToast('Export tripped over a remote image. Uploading the image directly is most reliable.')}}
  function drawPdfConfetti(pdf,pageW,pageH){
    const dots=[
      [34,30,238,113,76,5],[54,52,51,122,92,3],[pageW-38,32,238,113,76,4],[pageW-62,55,51,122,92,3],
      [28,pageH-28,238,113,76,3],[52,pageH-42,51,122,92,4],[pageW-30,pageH-30,238,113,76,5],[pageW-58,pageH-46,51,122,92,3]
    ];
    dots.forEach(([x,y,r,g,b,size])=>{pdf.setFillColor(r,g,b);pdf.circle(x,y,size,'F')});
    pdf.setDrawColor(241,183,72);pdf.setLineWidth(2);
    pdf.line(72,34,88,42);pdf.line(pageW-92,43,pageW-76,35);pdf.line(76,pageH-34,90,pageH-42);pdf.line(pageW-90,pageH-42,pageW-74,pageH-34);
  }
  function drawPdfTacoMark(pdf,x,y,scale=1){
    pdf.setFillColor(245,190,72);pdf.roundedRect(x,y,34*scale,18*scale,8*scale,8*scale,'F');
    pdf.setFillColor(80,154,80);pdf.circle(x+9*scale,y+5*scale,3.2*scale,'F');pdf.circle(x+24*scale,y+5*scale,3*scale,'F');
    pdf.setFillColor(214,72,61);pdf.circle(x+16*scale,y+4*scale,2.6*scale,'F');
    pdf.setFillColor(255,224,91);pdf.circle(x+29*scale,y+7*scale,2.3*scale,'F');
  }
  async function exportPDF(){
    $('exportMenu').hidden=true;showToast('Pressing tortillas into PDF…');
    try{
      const canvas=await captureBoard(),{jsPDF}=window.jspdf||{};if(!jsPDF)throw new Error('PDF library failed');
      const orientation=canvas.width>=canvas.height?'landscape':'portrait',pdf=new jsPDF({orientation,unit:'pt',format:'a4'}),pageW=pdf.internal.pageSize.getWidth(),pageH=pdf.internal.pageSize.getHeight();
      const side=30,headerH=92,footerH=48,availableW=pageW-side*2,availableH=pageH-headerH-footerH,ratio=Math.min(availableW/canvas.width,availableH/canvas.height),w=canvas.width*ratio,h=canvas.height*ratio,x=(pageW-w)/2,y=headerH+(availableH-h)/2;
      pdf.setFillColor(255,249,232);pdf.rect(0,0,pageW,pageH,'F');drawPdfConfetti(pdf,pageW,pageH);drawPdfTacoMark(pdf,side,24,.9);
      pdf.setTextColor(91,48,26);pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.text('TACOBOARD',side+40,36);
      pdf.setFontSize(19);pdf.text(String(current.board.title||'TacoBoard'),side,58,{maxWidth:pageW-side*2});
      if(current.board.subtitle){pdf.setFont('helvetica','normal');pdf.setFontSize(9.5);pdf.setTextColor(118,83,61);const subtitle=pdf.splitTextToSize(String(current.board.subtitle),pageW-side*2);pdf.text(subtitle,side,73)}
      pdf.setFillColor(230,213,177);pdf.roundedRect(x+3,y+4,w,h,7,7,'F');pdf.setFillColor(255,255,255);pdf.roundedRect(x-2,y-2,w+4,h+4,7,7,'F');pdf.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',x,y,w,h,undefined,'FAST');
      pdf.setDrawColor(224,194,128);pdf.setLineWidth(.8);pdf.line(side,pageH-footerH+9,pageW-side,pageH-footerH+9);
      pdf.setFont('helvetica','bold');pdf.setFontSize(9);pdf.setTextColor(91,48,26);const count=current.posts.length;pdf.text(`SERVED WITH ${count} TACO NOTE${count===1?'':'S'}`,side,pageH-20);
      pdf.setFont('helvetica','normal');pdf.setTextColor(132,99,75);pdf.text('Made with TacoBoard • compliments taste better in a tortilla',pageW-side,pageH-20,{align:'right'});
      pdf.save(`${slugify(current.board.title)}.pdf`);showToast('PDF saved 🌮')
    }catch(err){console.error(err);showToast('PDF export tripped over a remote image.')}
  }
  function exportJSON(){ $('exportMenu').hidden=true;const data={board:current.board,posts:current.posts,stickers:current.stickers};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${slugify(current.board.title)}-data.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);showToast('Board data exported')}

  function rainTacos(){const rain=$('tacoRain');for(let i=0;i<16;i++){const t=document.createElement('span');t.className='falling-taco';t.textContent=i%5===0?'🌶️':'🌮';t.style.left=`${Math.random()*100}%`;t.style.animationDelay=`${Math.random()*.35}s`;t.style.fontSize=`${1.5+Math.random()*2}rem`;rain.appendChild(t);setTimeout(()=>t.remove(),2100)}}
  function showToast(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600)}
  function showFatal(title,message){$('errorTitle').textContent=title;$('errorMessage').textContent=message;$('errorDialog').showModal();showHome()}
  function handleError(err,title){console.error(err);$('errorTitle').textContent=title;$('errorMessage').textContent=friendlyError(err);$('errorDialog').showModal()}
  function friendlyError(err){const m=String(err?.message||err||'Unknown taco failure');if(/function .* does not exist|schema cache/i.test(m))return 'Supabase is connected, but TacoBoard setup.sql has not been run yet (or the schema cache needs a moment). Run setup.sql in the Supabase SQL editor and reload.';if(/invalid taco|not found/i.test(m))return 'This board link is invalid, expired, or missing its secret taco key.';return m}
  function setBusy(btn,busy,label){btn.disabled=busy;btn.textContent=label}
  function buildBoardUrl({slug,key,admin}){const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('board',slug);if(admin)url.searchParams.set('admin',admin);else if(key)url.searchParams.set('key',key);return url.toString()}
  function getInitial(name){return(name?.trim()?.[0]||'🌮').toUpperCase()} function randomBetween(min,max){return min+Math.random()*(max-min)} function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
  function cryptoId(){return globalThis.crypto?.randomUUID?.()||`taco-${Date.now()}-${Math.random().toString(16).slice(2)}`}
  function randomToken(bytes=12){const arr=new Uint8Array(bytes);crypto.getRandomValues(arr);return Array.from(arr,b=>b.toString(16).padStart(2,'0')).join('')}
  function slugify(text){return text.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'tacoboard'}
  function rgbToHex(rgb){if(!rgb)return'';if(rgb.startsWith('#'))return rgb.toLowerCase();const nums=rgb.match(/\d+/g)?.slice(0,3).map(Number);return nums?.length===3?`#${nums.map(n=>n.toString(16).padStart(2,'0')).join('')}`:rgb}
})();
