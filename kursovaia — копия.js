// Начальные демонстрационные данные
const DEFAULT_MEDIA = [
  {
    id: '1',
    title: 'Genshin Impact',
    category: 'game',
    status: 'in-progress',
    genre: 'RPG, Открытый мир',
    poster: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80',
    rating: 5
  },
  {
    id: '2',
    title: 'Интерстеллар',
    category: 'movie',
    status: 'completed',
    genre: 'Фантастика, Драма',
    poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80',
    rating: 5
  },
  {
    id: '3',
    title: 'Задача трёх тел',
    category: 'book',
    status: 'planned',
    genre: 'Научная фантастика',
    poster: 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?auto=format&fit=crop&w=600&q=80',
    rating: 0
  },
  {
    id: '4',
    title: 'Магическая битва',
    category: 'manga',
    status: 'in-progress',
    genre: 'Сёнэн, Фэнтези',
    poster: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=600&q=80',
    rating: 4
  }
];

let mediaList = [];
let activeCategory = 'all';
let activeStatus = 'all';
let searchQuery = '';
let notesSaveTimeout = null;

function getCurrentUser() {
  return localStorage.getItem('starlight_current_user') || 'guest';
}

function getCurrentUserKey(baseKey) {
  return `${baseKey}_${getCurrentUser()}`;
}

function getSupabase() {
  return window.supabaseClient || null;
}

function loadLocalData() {
  const mediaKey = getCurrentUserKey('starlight_media');
  const raw = localStorage.getItem(mediaKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.error('Ошибка чтения localStorage:', e);
    }
  }
  const initial = [...DEFAULT_MEDIA];
  localStorage.setItem(mediaKey, JSON.stringify(initial));
  return initial;
}

function saveLocalData() {
  const mediaKey = getCurrentUserKey('starlight_media');
  localStorage.setItem(mediaKey, JSON.stringify(mediaList));
  updateCounters();
}

async function initApp() {
  updateAuthUI();

  // Сначала всегда поднимаем локальные данные, чтобы экран никогда не был пустым по ошибке
  mediaList = loadLocalData();

  const notesKey = getCurrentUserKey('starlight_notes');
  const notesInput = document.getElementById('notesInput');
  const savedLocalNotes = localStorage.getItem(notesKey);
  if (notesInput && savedLocalNotes !== null) {
    notesInput.value = savedLocalNotes;
  }

  updateCounters();
  renderCards();

  // Затем пытаемся синхронизироваться с Supabase
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('Supabase клиент не найден. Работает локальный режим.');
    return;
  }

  try {
    const { data: items, error } = await supabase
      .from('media_items')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      console.error('Ошибка чтения media_items из Supabase:', error.message);
      return;
    }

    if (items && items.length > 0) {
      mediaList = items.map(row => ({
        ...row,
        id: String(row.id),
        rating: Number(row.rating) || 0
      }));
      saveLocalData();
      renderCards();
    } else if (mediaList.length > 0) {
      // Если в облачной таблице пока пусто — выгружаем текущий список в базу
      const rowsToInsert = mediaList.map(item => ({
        title: item.title,
        category: item.category,
        status: item.status,
        genre: item.genre || '',
        poster: item.poster || '',
        rating: Number(item.rating) || 0
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('media_items')
        .insert(rowsToInsert)
        .select();

      if (insertError) {
        console.error('Ошибка первичной записи в media_items:', insertError.message);
      } else if (inserted && inserted.length > 0) {
        mediaList = inserted.map(row => ({
          ...row,
          id: String(row.id),
          rating: Number(row.rating) || 0
        }));
        saveLocalData();
        renderCards();
      }
    }

    // Загрузка заметок из Supabase
    const { data: notesRows, error: notesError } = await supabase
      .from('user_notes')
      .select('*')
      .order('id', { ascending: true })
      .limit(1);

    if (notesError) {
      console.error('Ошибка чтения user_notes из Supabase:', notesError.message);
    } else if (notesRows && notesRows.length > 0) {
      const dbContent = notesRows[0].content || '';
      if (dbContent) {
        if (notesInput) notesInput.value = dbContent;
        localStorage.setItem(notesKey, dbContent);
      }
    }
  } catch (err) {
    console.error('Сбой синхронизации с Supabase:', err);
  }
}

async function saveNotesToDB(content) {
  const notesKey = getCurrentUserKey('starlight_notes');
  localStorage.setItem(notesKey, content);

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { data: existing, error: selectErr } = await supabase
      .from('user_notes')
      .select('id')
      .order('id', { ascending: true })
      .limit(1);

    if (selectErr) {
      console.error('Ошибка проверки user_notes:', selectErr.message);
      return;
    }

    if (existing && existing.length > 0) {
      const { error: updErr } = await supabase
        .from('user_notes')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
      if (updErr) console.error('Ошибка обновления заметки:', updErr.message);
    } else {
      const { error: insErr } = await supabase
        .from('user_notes')
        .insert([{ content }]);
      if (insErr) console.error('Ошибка создания заметки:', insErr.message);
    }
  } catch (err) {
    console.error('Ошибка сохранения заметки в Supabase:', err);
  }
}

function updateAuthUI() {
  const currentUser = localStorage.getItem('starlight_current_user');
  const authButtonText = document.getElementById('authButtonText');
  if (authButtonText) {
    authButtonText.textContent = currentUser ? currentUser : 'Войти';
  }
}

function updateCounters() {
  const m = document.getElementById('countMovies');
  const b = document.getElementById('countBooks');
  const mg = document.getElementById('countManga');
  const g = document.getElementById('countGames');

  if (m) m.textContent = mediaList.filter(i => i.category === 'movie').length;
  if (b) b.textContent = mediaList.filter(i => i.category === 'book').length;
  if (mg) mg.textContent = mediaList.filter(i => i.category === 'manga').length;
  if (g) g.textContent = mediaList.filter(i => i.category === 'game').length;
}

function getCategoryBadge(category) {
  const badges = {
    movie: { icon: 'fa-film', text: 'Фильм', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    book: { icon: 'fa-book', text: 'Книга', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    manga: { icon: 'fa-book-open', text: 'Манга', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
    game: { icon: 'fa-gamepad', text: 'Игра', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' }
  };
  const b = badges[category] || badges.movie;
  return `<span class="inline-flex items-center space-x-1 border px-2 py-0.5 rounded-md text-[10px] font-medium ${b.color}">
            <i class="fa-solid ${b.icon}"></i>
            <span>${b.text}</span>
          </span>`;
}

function renderStarRatingHTML(id, currentRating) {
  let starsHTML = '';
  for (let i = 1; i <= 5; i++) {
    const isFilled = i <= currentRating;
    starsHTML += `
      <button onclick="updateRating('${id}', ${i})" class="focus:outline-none transition-transform hover:scale-125">
        <i class="fa-solid fa-star text-xs ${isFilled ? 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'text-slate-700'}"></i>
      </button>
    `;
  }
  return `<div class="flex items-center space-x-1">${starsHTML}</div>`;
}

function renderCards() {
  const mediaGrid = document.getElementById('mediaGrid');
  const emptyState = document.getElementById('emptyState');
  if (!mediaGrid) return;
  mediaGrid.innerHTML = '';

  const filtered = mediaList.filter(item => {
    const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
    const matchesStatus = activeStatus === 'all' || item.status === activeStatus;
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (item.genre && item.genre.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesStatus && matchesSearch;
  });

  if (filtered.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
  } else {
    if (emptyState) emptyState.classList.add('hidden');
    filtered.forEach(item => {
      const card = createCardElement(item);
      mediaGrid.appendChild(card);
    });
  }
}

function createCardElement(item) {
  const card = document.createElement('div');
  card.className = 'glass-card rounded-2xl overflow-hidden border border-slate-800 hover:border-slate-700 transition-all duration-300 flex flex-col group';
  const defaultImage = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80';

  card.innerHTML = `
    <div class="relative h-48 overflow-hidden bg-slate-900">
      <img src="${item.poster || defaultImage}" alt="${item.title}" 
           class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
           onerror="this.src='${defaultImage}'">
      <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
      
      <div class="absolute top-3 left-3">
        ${getCategoryBadge(item.category)}
      </div>

      <button onclick="deleteMedia('${item.id}')" 
              class="absolute top-3 right-3 w-8 h-8 rounded-lg bg-slate-950/60 text-slate-400 hover:text-red-400 hover:bg-slate-900 flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-200">
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    </div>

    <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
      <div>
        <h4 class="font-bold text-white text-base line-clamp-1 group-hover:text-starlight-400 transition-colors">${item.title}</h4>
        <p class="text-xs text-slate-400 mt-0.5 line-clamp-1">${item.genre || 'Без жанра'}</p>
      </div>

      <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
        ${renderStarRatingHTML(item.id, item.rating)}
        
        <select onchange="updateStatus('${item.id}', this.value)" 
                class="bg-slate-900/90 border border-slate-700/60 rounded-lg px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-starlight-500 cursor-pointer">
          <option value="planned" ${item.status === 'planned' ? 'selected' : ''}>Запланировано</option>
          <option value="in-progress" ${item.status === 'in-progress' ? 'selected' : ''}>В процессе</option>
          <option value="completed" ${item.status === 'completed' ? 'selected' : ''}>Завершено</option>
        </select>
      </div>
    </div>
  `;
  return card;
}

window.deleteMedia = async function(id) {
  if (!confirm('Вы уверены, что хотите удалить этот тайтл?')) return;

  mediaList = mediaList.filter(item => String(item.id) !== String(id));
  saveLocalData();
  renderCards();

  const supabase = getSupabase();
  if (supabase && /^\d+$/.test(String(id))) {
    const { error } = await supabase
      .from('media_items')
      .delete()
      .eq('id', Number(id));
    if (error) {
      console.error('Ошибка удаления из Supabase:', error.message);
    }
  }
};

window.updateStatus = async function(id, newStatus) {
  mediaList = mediaList.map(item => String(item.id) === String(id) ? { ...item, status: newStatus } : item);
  saveLocalData();

  const supabase = getSupabase();
  if (supabase && /^\d+$/.test(String(id))) {
    const { error } = await supabase
      .from('media_items')
      .update({ status: newStatus })
      .eq('id', Number(id));
    if (error) {
      console.error('Ошибка обновления статуса в Supabase:', error.message);
    }
  }
};

window.updateRating = async function(id, newRating) {
  mediaList = mediaList.map(item => String(item.id) === String(id) ? { ...item, rating: newRating } : item);
  saveLocalData();
  renderCards();

  const supabase = getSupabase();
  if (supabase && /^\d+$/.test(String(id))) {
    const { error } = await supabase
      .from('media_items')
      .update({ rating: newRating })
      .eq('id', Number(id));
    if (error) {
      console.error('Ошибка обновления оценки в Supabase:', error.message);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // Звездный фон
  const canvas = document.getElementById('star-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let stars = [];
    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    function createStars() {
      stars = [];
      for (let i = 0; i < 140; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: Math.random() * 1.5 + 0.5,
          color: ['#ffffff', '#818cf8', '#38bdf8', '#f59e0b'][Math.floor(Math.random() * 4)],
          alpha: Math.random(),
          speed: Math.random() * 0.02 + 0.005
        });
      }
    }
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach(star => {
        star.alpha += star.speed;
        if (star.alpha > 1 || star.alpha < 0) star.speed = -star.speed;
        ctx.save();
        ctx.globalAlpha = Math.abs(star.alpha);
        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      requestAnimationFrame(animate);
    }
    window.addEventListener('resize', () => { resizeCanvas(); createStars(); });
    resizeCanvas();
    createStars();
    animate();
  }

  initApp();

  // Баннер фокуса
  const focusBanner = document.getElementById('focusBanner');
  if (focusBanner) {
    focusBanner.addEventListener('click', () => {
      document.querySelectorAll('.category-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.category === 'game') btn.classList.add('active');
      });
      activeCategory = 'game';
      searchQuery = 'Genshin Impact';
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = searchQuery;
      renderCards();
      const mediaGrid = document.getElementById('mediaGrid');
      if (mediaGrid) mediaGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Табы категорий
  const categoryTabs = document.getElementById('categoryTabs');
  if (categoryTabs) {
    categoryTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.category-btn');
      if (!btn) return;
      document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.category;
      renderCards();
    });
  }

  // Фильтр статуса
  const statusFilter = document.getElementById('statusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      activeStatus = e.target.value;
      renderCards();
    });
  }

  // Поиск
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderCards();
    });
  }

  // Заметки
  const notesInput = document.getElementById('notesInput');
  if (notesInput) {
    notesInput.addEventListener('input', (e) => {
      const val = e.target.value;
      const notesKey = getCurrentUserKey('starlight_notes');
      localStorage.setItem(notesKey, val);

      clearTimeout(notesSaveTimeout);
      notesSaveTimeout = setTimeout(() => {
        saveNotesToDB(val);
      }, 400);
    });
  }

  // Модалка добавления тайтла
  const addModal = document.getElementById('addModal');
  const openAddModalBtn = document.getElementById('openAddModalBtn');
  const closeAddModalBtn = document.getElementById('closeAddModalBtn');
  const cancelAddModalBtn = document.getElementById('cancelAddModalBtn');
  const addMediaForm = document.getElementById('addMediaForm');

  function toggleAddModal(show) {
    if (!addModal) return;
    if (show) {
      addModal.classList.remove('hidden');
    } else {
      addModal.classList.add('hidden');
      if (addMediaForm) addMediaForm.reset();
    }
  }

  if (openAddModalBtn) openAddModalBtn.addEventListener('click', () => toggleAddModal(true));
  if (closeAddModalBtn) closeAddModalBtn.addEventListener('click', () => toggleAddModal(false));
  if (cancelAddModalBtn) cancelAddModalBtn.addEventListener('click', () => toggleAddModal(false));

  if (addMediaForm) {
    addMediaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: document.getElementById('modalTitle').value.trim(),
        category: document.getElementById('modalCategory').value,
        status: document.getElementById('modalStatus').value,
        genre: document.getElementById('modalGenre').value.trim(),
        poster: document.getElementById('modalPoster').value.trim(),
        rating: parseFloat(document.getElementById('modalRating').value) || 0
      };

      const supabase = getSupabase();
      let newMedia = {
        id: Date.now().toString(),
        ...payload
      };

      if (supabase) {
        const { data, error } = await supabase
          .from('media_items')
          .insert([payload])
          .select()
          .single();

        if (!error && data) {
          newMedia = {
            ...data,
            id: String(data.id),
            rating: Number(data.rating) || 0
          };
        } else if (error) {
          console.error('Ошибка добавления в Supabase:', error.message);
        }
      }

      mediaList.unshift(newMedia);
      saveLocalData();
      renderCards();
      toggleAddModal(false);
    });
  }

  // --- ЛОГИКА АВТОРИЗАЦИИ И МОДАЛЬНОГО ОКНА ВХОДА ---
  const authModal = document.getElementById('authModal');
  const openAuthModalBtn = document.getElementById('openAuthModalBtn');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
  const authForm = document.getElementById('authForm');
  const authToggleBtn = document.getElementById('authToggleBtn');
  const authError = document.getElementById('authError');
  const authUsernameInput = document.getElementById('authUsername');
  const authPasswordInput = document.getElementById('authPassword');
  
  const authFormContainer = document.getElementById('authFormContainer');
  const userProfileContainer = document.getElementById('userProfileContainer');
  const currentUsernameDisplay = document.getElementById('currentUsernameDisplay');
  const logoutBtn = document.getElementById('logoutBtn');
  const authModalTitleText = document.getElementById('authModalTitleText');
  const authSubmitBtn = document.getElementById('authSubmitBtn');

  let isRegisterMode = false;

  if (openAuthModalBtn) {
    openAuthModalBtn.addEventListener('click', () => {
      const currentUser = localStorage.getItem('starlight_current_user');
      if (currentUser) {
        if (currentUsernameDisplay) currentUsernameDisplay.textContent = currentUser;
        if (authModalTitleText) authModalTitleText.textContent = 'Личный кабинет';
        if (authFormContainer) authFormContainer.classList.add('hidden');
        if (userProfileContainer) userProfileContainer.classList.remove('hidden');
      } else {
        if (authModalTitleText) authModalTitleText.textContent = 'Авторизация';
        if (authFormContainer) authFormContainer.classList.remove('hidden');
        if (userProfileContainer) userProfileContainer.classList.add('hidden');
      }
      if (authModal) authModal.classList.remove('hidden');
    });
  }

  if (closeAuthModalBtn) {
    closeAuthModalBtn.addEventListener('click', () => {
      if (authModal) authModal.classList.add('hidden');
    });
  }

  if (authToggleBtn) {
    authToggleBtn.addEventListener('click', () => {
      isRegisterMode = !isRegisterMode;
      if (authError) authError.classList.add('hidden');
      if (isRegisterMode) {
        if (authModalTitleText) authModalTitleText.textContent = 'Регистрация';
        if (authSubmitBtn) authSubmitBtn.textContent = 'Создать';
        authToggleBtn.textContent = 'Уже есть аккаунт? Войти';
      } else {
        if (authModalTitleText) authModalTitleText.textContent = 'Авторизация';
        if (authSubmitBtn) authSubmitBtn.textContent = 'Войти';
        authToggleBtn.textContent = 'Нет аккаунта? Создать';
      }
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = authUsernameInput.value.trim();
      const password = authPasswordInput.value.trim();
      let users = JSON.parse(localStorage.getItem('starlight_users')) || {};

      if (isRegisterMode) {
        if (users[username]) {
          if (authError) {
            authError.textContent = 'Имя пользователя уже занято!';
            authError.classList.remove('hidden');
          }
          return;
        }
        users[username] = { password: password };
        localStorage.setItem('starlight_users', JSON.stringify(users));
        localStorage.setItem('starlight_current_user', username);
        window.location.reload();
      } else {
        if (users[username] && users[username].password === password) {
          localStorage.setItem('starlight_current_user', username);
          window.location.reload();
        } else {
          if (authError) {
            authError.textContent = 'Неверное имя или пароль';
            authError.classList.remove('hidden');
          }
        }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('starlight_current_user');
      window.location.reload();
    });
  }
});