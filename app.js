// ═══════════════════════════════════════════════════════
// app.js — NUTECH Vault Main Application Logic
// Version: 2.1 — Credentials connected, visibility column added,
//               storage bucket created via SDK, all fixes applied
// ═══════════════════════════════════════════════════════

// ── Supabase Configuration ───────────────────────────────
const SUPABASE_URL  = 'https://tzbnbuuhbxmiymqaplaz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Ym5idXVoYnhtaXltcWFwbGF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MDU0NDYsImV4cCI6MjA5MjI4MTQ0Nn0.GPYSIeUv5gZ4hbK1jVeb63G1WNPufwOlE0JVrkvR6B0';

// Initialise the Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Global App State ─────────────────────────────────────
let currentUser    = null;
let currentProfile = null;
let allMemories    = [];
let isInitialising = true;


// ═══════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const target = document.getElementById('page-' + pageId);
  if (!target) {
    document.getElementById('page-home').classList.add('active');
    return;
  }
  target.classList.add('active');

  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === pageId);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (pageId === 'memories')    loadMemories();
  if (pageId === 'profile')     loadProfile();
  if (pageId === 'departments') renderDepartments();
}

function navigateTo(pageId) {
  const protectedPages = ['memories', 'profile', 'departments'];

  if (protectedPages.includes(pageId) && !currentUser) {
    showToast('Please sign in to access this section.', 'info');
    showPage('login');
    return;
  }

  showPage(pageId);
}

// ── Navbar scroll shadow ──────────────────────────────────
window.addEventListener('scroll', () => {
  document.querySelector('.navbar').classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

// ── Hamburger menu ────────────────────────────────────────
document.getElementById('hamburger-btn').addEventListener('click', () => {
  document.getElementById('mobile-menu').classList.toggle('open');
});

document.querySelectorAll('.mobile-menu a').forEach(a => {
  a.addEventListener('click', () => {
    document.getElementById('mobile-menu').classList.remove('open');
  });
});


// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════

supabaseClient.auth.onAuthStateChange((event, session) => {
  // WARNING: No async/await or Supabase API calls allowed directly inside
  // this callback. It causes a deadlock in supabase-js — the auth lock never
  // releases, freezing sign-in. All async work is deferred via setTimeout.

  const previousUser = currentUser;
  currentUser = session?.user ?? null;

  if (currentUser) {
    setTimeout(async () => {
      try {
        await fetchProfile();
      } catch (e) {
        console.error('fetchProfile failed:', e);
        currentProfile = null;
      }

      // Ghost account guard
      const meta = currentUser?.user_metadata || {};
      const hasMetadata = !!(meta.full_name || meta.student_id);
      const isProfileBroken = !currentProfile || (!currentProfile.full_name && !currentProfile.student_id);

      if (isProfileBroken && !hasMetadata && event !== 'SIGNED_OUT') {
        console.warn('Ghost/incomplete account detected — signing out.');
        await supabaseClient.auth.signOut();
        currentUser    = null;
        currentProfile = null;
        updateNavForGuest();
        if (!isInitialising) {
          showToast('⚠️ Your previous signup was incomplete. Please create your account again.', 'error');
          showPage('signup');
        }
        return;
      }

      updateNavForUser();
    }, 0);

  } else {
    currentProfile = null;
    updateNavForGuest();

    if (previousUser && !isInitialising) {
      showPage('home');
    }
  }
});
async function fetchProfile() {
  if (!currentUser) return;

  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .single();

    if (!error && data) {
      const meta = currentUser.user_metadata || {};
      const needsUpdate =
        !data.full_name ||
        !data.student_id ||
        !data.department ||
        !data.batch_year;

      if (needsUpdate && (meta.full_name || meta.student_id || meta.department || meta.batch_year)) {
        const patch = {};
        if (!data.full_name && meta.full_name) patch.full_name = meta.full_name;
        if (!data.student_id && meta.student_id) patch.student_id = meta.student_id;
        if (!data.department && meta.department) patch.department = meta.department;
        if (!data.batch_year && meta.batch_year) patch.batch_year = parseInt(meta.batch_year);

        if (Object.keys(patch).length) {
          const { data: patched, error: patchError } = await supabaseClient
            .from("profiles")
            .update(patch)
            .eq("id", currentUser.id)
            .select()
            .single();

          if (patchError) throw patchError;

          currentProfile = patched || { ...data, ...patch };
          return;
        }
      }

      currentProfile = data;
      return;
    }

    // Profile row missing (or query error) -> try create only if metadata exists
    const meta = currentUser.user_metadata || {};
    if (meta.full_name || meta.student_id) {
      const { data: created, error: createError } = await supabaseClient
        .from("profiles")
        .upsert(
          {
            id: currentUser.id,
            full_name: meta.full_name || null,
            student_id: meta.student_id || null,
            department: meta.department || null,
            batch_year: meta.batch_year ? parseInt(meta.batch_year) : null,
          },
          { onConflict: "id" }
        )
        .select()
        .single();

      if (createError) throw createError;

      currentProfile = created || null;
      return;
    }

    currentProfile = null;
  } catch (e) {
    console.error("fetchProfile error:", e);
    // fail open: never keep UI stuck
    currentProfile = null;
  }
}

function updateNavForUser() {
  document.getElementById('nav-guest-actions').style.display  = 'none';
  document.getElementById('nav-user-actions').style.display   = 'flex';
  document.getElementById('nav-links-guest').style.display    = 'none';
  document.getElementById('nav-links-auth').style.display     = '';

  const name = currentProfile?.full_name || currentUser.email.split('@')[0];
  document.getElementById('nav-user-initials').textContent = getInitials(name);
  document.getElementById('nav-user-name').textContent = name;

  ['mob-memories-link', 'mob-departments-link', 'mob-profile-link'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  const mobLogin   = document.getElementById('mob-login-link');
  const mobSignup  = document.getElementById('mob-signup-link');
  const mobLogout  = document.getElementById('mob-logout-link');
  if (mobLogin)  mobLogin.style.display  = 'none';
  if (mobSignup) mobSignup.style.display = 'none';
  if (mobLogout) mobLogout.style.display = '';
}

function updateNavForGuest() {
  document.getElementById('nav-guest-actions').style.display = 'flex';
  document.getElementById('nav-user-actions').style.display  = 'none';
  document.getElementById('nav-links-guest').style.display   = '';
  document.getElementById('nav-links-auth').style.display    = 'none';

  ['mob-memories-link', 'mob-departments-link', 'mob-profile-link'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const mobLogin   = document.getElementById('mob-login-link');
  const mobSignup  = document.getElementById('mob-signup-link');
  const mobLogout  = document.getElementById('mob-logout-link');
  if (mobLogin)  mobLogin.style.display  = '';
  if (mobSignup) mobSignup.style.display = '';
  if (mobLogout) mobLogout.style.display = 'none';
}

// ── Sign Up ───────────────────────────────────────────────
// Track last signup attempt to prevent 429 rate-limit errors
let lastSignupAttempt = 0;
const SIGNUP_COOLDOWN_MS = 60000; // 60 seconds between attempts

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('signup-alert');

  // Enforce cooldown to avoid Supabase 429 rate limit on /signup
  const now = Date.now();
  const elapsed = now - lastSignupAttempt;
  if (lastSignupAttempt > 0 && elapsed < SIGNUP_COOLDOWN_MS) {
    const remaining = Math.ceil((SIGNUP_COOLDOWN_MS - elapsed) / 1000);
    showAlert('signup-alert',
      `⏳ Please wait ${remaining} seconds before trying again. A confirmation email was already sent — check your inbox (and spam folder).`,
      'error');
    return;
  }

  const fullName    = document.getElementById('signup-name').value.trim();
  const studentId   = document.getElementById('signup-student-id').value.trim();
  const department  = document.getElementById('signup-department').value;
  const batchYear   = parseInt(document.getElementById('signup-batch').value);
  const email       = document.getElementById('signup-email').value.trim();
  const password    = document.getElementById('signup-password').value;
  const termsAgreed = document.getElementById('signup-terms').checked;

  if (!fullName || !studentId || !department || !batchYear || !email || !password) {
    showAlert('signup-alert', 'Please fill in all required fields to create your account.', 'error');
    return;
  }

  if (password.length < 6) {
    showAlert('signup-alert', 'Your password must be at least 6 characters long.', 'error');
    return;
  }

  if (batchYear < 2021 || batchYear > 2026) {
    showAlert('signup-alert', 'Please select a valid batch year between 2021 and 2026.', 'error');
    return;
  }

  if (!termsAgreed) {
    showAlert('signup-alert', 'Please read and agree to our Terms of Use and Privacy Policy to continue.', 'error');
    return;
  }

  setLoading('btn-signup', true, 'Creating Account…');
  lastSignupAttempt = Date.now();

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name:  fullName,
        student_id: studentId,
        department: department,
        batch_year: batchYear
      }
    }
  });

  setLoading('btn-signup', false, 'Create Account');

  if (error) {
    lastSignupAttempt = 0; // reset so they can try again if it was a real error
    if (error.message.toLowerCase().includes('rate limit') ||
        error.message.toLowerCase().includes('429') ||
        error.status === 429) {
      showAlert('signup-alert',
        '⏳ Too many signup attempts. Please wait 60 seconds then try again. If you already signed up, check your email inbox for the confirmation link.',
        'error');
      lastSignupAttempt = Date.now(); // keep cooldown active
    } else if (error.message.toLowerCase().includes('already registered') ||
        error.message.toLowerCase().includes('already')) {
      showAlert('signup-alert',
        'An account with this email address already exists. Please sign in instead.', 'error');
    } else {
      showAlert('signup-alert', error.message, 'error');
    }
    return;
  }

  if (data.session) {
    // Explicitly upsert profile data in case the DB trigger was delayed or missed
    await supabaseClient.from('profiles').upsert({
      id:         data.user.id,
      full_name:  fullName,
      student_id: studentId,
      department: department,
      batch_year: batchYear
    }, { onConflict: 'id' });

    showToast('🎉 Welcome to NUTECH Vault! Your account has been created successfully.', 'success');
    showPage('memories');
  } else {
    showAlert('signup-alert',
      '✅ Account created! Please check your email inbox and click the confirmation link before signing in.',
      'success');
    document.getElementById('signup-form').reset();
  }
});

// ── Sign In ───────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('login-alert');

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showAlert('login-alert', 'Please enter both your email address and password.', 'error');
    return;
  }

  setLoading('btn-login', true, 'Signing In…');
  clearAlert('login-alert');

  let loginSuccess = false;
  try {
    // Race sign-in against a 15-second timeout so the button never stays stuck
    const signInPromise = supabaseClient.auth.signInWithPassword({ email, password });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Sign-in timed out. Please check your connection and try again.')), 15000)
    );

    const { data, error } = await Promise.race([signInPromise, timeoutPromise]);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('invalid login credentials') || msg.includes('invalid')) {
        showAlert('login-alert',
          'The email address or password you entered is incorrect. Please check and try again.', 'error');
      } else if (msg.includes('email not confirmed')) {
        showAlert('login-alert',
          '⚠️ Your email has not been confirmed yet. Please check your inbox (and spam folder) for the confirmation link from NUTECH Vault, click it, then come back here to sign in.', 'error');
      } else {
        showAlert('login-alert', error.message, 'error');
      }
    } else if (!data?.session) {
      showAlert('login-alert', 'Login did not complete. Please try again.', 'error');
    } else {
      loginSuccess = true;
    }
  } catch (err) {
    showAlert('login-alert', err instanceof Error ? err.message : 'Login failed. Please try again.', 'error');
  }

  // Always re-enable the button no matter what happened above
  setLoading('btn-login', false, 'Sign In to NUTECH Vault');

  if (loginSuccess) {
    showToast('✅ Welcome back! You\'ve successfully signed in.', 'success');
    // Fetch profile in background — do NOT await so navigation is never blocked
    try { fetchProfile().then(() => updateNavForUser()); } catch (_) {}
    updateNavForUser();
    showPage('memories');
  }
});

// ── Sign Out ──────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  showToast('You have been signed out. Come back soon!', 'info');
});

// ── Forgot Password — send reset email ───────────────────
document.getElementById('reset-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('reset-alert');

  const email = document.getElementById('reset-email').value.trim();

  if (!email) {
    showAlert('reset-alert', 'Please enter your email address.', 'error');
    return;
  }

  setLoading('btn-reset', true, 'Sending…');

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  setLoading('btn-reset', false, 'Send Reset Link');

  if (error) {
    showAlert('reset-alert', error.message, 'error');
    return;
  }

  // Always show success — don't reveal whether the email exists
  showAlert('reset-alert',
    '✅ If an account with that email exists, a password reset link has been sent. Please check your inbox (and spam folder).',
    'success');
  document.getElementById('reset-password-form').reset();
});

// ── New Password — set password after clicking reset link ─
document.getElementById('new-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('new-password-alert');

  const newPass     = document.getElementById('new-password').value;
  const confirmPass = document.getElementById('new-password-confirm').value;

  if (!newPass || !confirmPass) {
    showAlert('new-password-alert', 'Please fill in both password fields.', 'error');
    return;
  }

  if (newPass.length < 6) {
    showAlert('new-password-alert', 'Your password must be at least 6 characters long.', 'error');
    return;
  }

  if (newPass !== confirmPass) {
    showAlert('new-password-alert', 'The passwords do not match. Please try again.', 'error');
    return;
  }

  setLoading('btn-set-new-password', true, 'Updating…');

  const { error } = await supabaseClient.auth.updateUser({ password: newPass });

  setLoading('btn-set-new-password', false, 'Update My Password');

  if (error) {
    showAlert('new-password-alert', error.message, 'error');
    return;
  }

  showToast('✅ Your password has been updated. You are now signed in.', 'success');
  document.getElementById('new-password-form').reset();
  showPage('memories');
});


// ═══════════════════════════════════════════════════════
// MEMORIES
// ═══════════════════════════════════════════════════════

async function loadMemories() {
  showMemoriesLoading();

  try {
    const { data, error } = await supabaseClient
      .from('memories')
      .select(`
        *,
        profiles (
          full_name,
          student_id,
          department,
          batch_year
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Client-side privacy filter
    const filtered = (data || []).filter(m => {
      const visibility = m.visibility || (m.is_public ? 'public' : 'private');

      if (visibility === 'public') return true;
      if (!currentUser) return false;

      if (visibility === 'private') {
        return m.user_id === currentUser.id;
      }

      if (visibility === 'department') {
        return m.user_id === currentUser.id ||
               m.department === currentProfile?.department;
      }

      return false;
    });

    // Check which memories the current user has liked
    let likedIds = new Set();
    if (currentUser) {
      const { data: likedRows } = await supabaseClient
        .from('likes')
        .select('memory_id')
        .eq('user_id', currentUser.id);
      if (likedRows) likedRows.forEach(r => likedIds.add(r.memory_id));
    }

    filtered.forEach(m => { m.userLiked = likedIds.has(m.id); });
    allMemories = filtered;
    renderMemories(allMemories);

  } catch (err) {
    console.error('loadMemories error:', err);
    showToast('Unable to load memories. Please refresh the page and try again.', 'error');
    renderMemories([]);
  }
}

function showMemoriesLoading() {
  const grid = document.getElementById('memories-grid');
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="memory-card">
      <div class="memory-card-img skeleton"></div>
      <div class="memory-card-body">
        <div class="skeleton" style="height:16px;width:55%;margin-bottom:12px;border-radius:4px"></div>
        <div class="skeleton" style="height:20px;width:90%;margin-bottom:10px;border-radius:4px"></div>
        <div class="skeleton" style="height:14px;width:70%;border-radius:4px"></div>
      </div>
    </div>
  `).join('');
}

function renderMemories(list) {
  const grid = document.getElementById('memories-grid');
  if (!grid) return;

  if (!list || !list.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-title">No memories found</div>
        <p class="empty-state-desc">
          ${currentUser
            ? 'No memories match your current filters. Try adjusting them or be the first to share a new memory!'
            : 'Sign in to view and share memories with your fellow NUTECH students.'}
        </p>
        ${currentUser ? `<button class="btn-primary" style="margin-top:20px"
          onclick="document.getElementById('btn-add-memory').click()">Share the First Memory</button>` : ''}
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map(m => memoryCardHTML(m)).join('');
}

function memoryCardHTML(m) {
  const profile  = m.profiles || {};
  const initials = getInitials(profile.full_name || 'U');
  const name     = profile.full_name || 'Anonymous';
  const year     = m.year || profile.batch_year || '';

  const imgHTML = m.photo_url
    ? `<img src="${escapeHTML(getPhotoUrl(m.photo_url))}"
            alt="${escapeHTML(m.title)}" loading="lazy"
            draggable="false"
            style="-webkit-user-drag:none;user-drag:none;pointer-events:none"
            onerror="this.parentElement.innerHTML=getCategoryEmojiInner('${escapeHTML(m.category)}')">`
    : getCategoryEmoji(m.category);

  const isOwner = currentProfile && m.user_id === currentProfile.id;
  const visibilityBadge = isOwner
    ? `<span class="visibility-badge" title="Memory visibility">
        ${m.visibility === 'private' ? '🔐 Private'
          : m.visibility === 'department' ? '🏛️ Dept Only'
          : '🌍 Public'}
      </span>`
    : '';

  return `
    <div class="memory-card" data-id="${m.id}">
      <div class="memory-card-img">${imgHTML}</div>
      <div class="memory-card-body">
        <div class="memory-card-top-row">
          ${m.category ? `<div class="memory-card-cat">${escapeHTML(m.category)}</div>` : '<div></div>'}
          ${visibilityBadge}
        </div>
        <div class="memory-card-title">${escapeHTML(m.title)}</div>
        ${m.content ? `<p class="memory-card-content">${escapeHTML(m.content)}</p>` : ''}
        <div class="memory-card-footer">
          <div class="memory-author">
            <div class="memory-author-avatar">${initials}</div>
            <div class="memory-author-info">
              <div class="memory-author-name">${escapeHTML(name)}</div>
              ${year ? `<div class="memory-author-year">Batch ${year}</div>` : ''}
            </div>
          </div>
          <div class="memory-actions">
            <button class="btn-like ${m.userLiked ? 'liked' : ''}"
                    onclick="toggleLike('${m.id}', this)"
                    title="Like this memory" aria-label="Like memory">
              ♥ <span>${m.likes || 0}</span>
            </button>
            <button class="btn-view-memory" onclick="openMemory('${m.id}')"
                    aria-label="View full memory">View</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getCategoryEmojiInner(cat) {
  const map = {
    'Event':'🎉','Graduation':'🎓','Sports':'🏆','Cultural':'🎭',
    'Academic':'📚','Trip':'✈️','Friendship':'🤝','Achievement':'🏅',
    'Farewell':'👋','Welcome':'🌟','Workshop':'🔧','Research':'🔬',
    'Internship':'💼','Conference':'🎤'
  };
  return `<span>${map[cat] || '📸'}</span>`;
}

function getCategoryEmoji(cat) {
  const map = {
    'Event':'🎉','Graduation':'🎓','Sports':'🏆','Cultural':'🎭',
    'Academic':'📚','Trip':'✈️','Friendship':'🤝','Achievement':'🏅',
    'Farewell':'👋','Welcome':'🌟','Workshop':'🔧','Research':'🔬',
    'Internship':'💼','Conference':'🎤'
  };
  return `<span style="font-size:2.5rem;line-height:1">${map[cat] || '📸'}</span>`;
}

function getPhotoUrl(path) {
  if (!path) return '';
  // If it contains a comma, return the first photo as the cover
  const first = path.split(',')[0].trim();
  if (first.startsWith('http')) return first;
  const { data } = supabaseClient.storage.from('memory-photos').getPublicUrl(first);
  return data?.publicUrl || '';
}

function getPhotoUrls(path) {
  if (!path) return [];
  return path.split(',').map(p => {
    const trimmed = p.trim();
    if (trimmed.startsWith('http')) return trimmed;
    const { data } = supabaseClient.storage.from('memory-photos').getPublicUrl(trimmed);
    return data?.publicUrl || '';
  }).filter(Boolean);
}


// ── Search & Filter ───────────────────────────────────────

document.getElementById('memory-search').addEventListener('input', filterMemories);
document.getElementById('memory-cat-filter').addEventListener('change', filterMemories);
document.getElementById('memory-dept-filter').addEventListener('change', filterMemories);

function filterMemories() {
  const q    = document.getElementById('memory-search').value.toLowerCase().trim();
  const cat  = document.getElementById('memory-cat-filter').value;
  const dept = document.getElementById('memory-dept-filter').value;

  const filtered = allMemories.filter(m => {
    const matchQ    = !q || (m.title || '').toLowerCase().includes(q)
                         || (m.content || '').toLowerCase().includes(q)
                         || (m.profiles?.full_name || '').toLowerCase().includes(q);
    const matchCat  = !cat  || m.category === cat;
    const matchDept = !dept || m.department === dept;
    return matchQ && matchCat && matchDept;
  });

  renderMemories(filtered);
}

function filterByDept(deptName) {
  if (!currentUser) {
    showToast('Please sign in to browse department memories.', 'info');
    showPage('login');
    return;
  }
  document.getElementById('memory-dept-filter').value = deptName;
  showPage('memories');
  setTimeout(filterMemories, 600);
}


// ── Like / Unlike ─────────────────────────────────────────

async function toggleLike(memoryId, btn) {
  if (!currentUser) {
    showToast('Please sign in to like memories.', 'info');
    showPage('login');
    return;
  }

  const countSpan = btn.querySelector('span');
  let count = parseInt(countSpan.textContent) || 0;

  const { data: existingLike } = await supabaseClient
    .from('likes')
    .select('id')
    .eq('memory_id', memoryId)
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (existingLike) {
    btn.classList.remove('liked');
    countSpan.textContent = Math.max(0, count - 1);

    await supabaseClient.from('likes').delete().eq('id', existingLike.id);
    await supabaseClient.from('memories')
      .update({ likes: Math.max(0, count - 1) })
      .eq('id', memoryId);

    const m = allMemories.find(x => x.id === memoryId);
    if (m) { m.likes = Math.max(0, count - 1); m.userLiked = false; }

  } else {
    btn.classList.add('liked');
    countSpan.textContent = count + 1;

    await supabaseClient.from('likes')
      .insert({ memory_id: memoryId, user_id: currentUser.id });
    await supabaseClient.from('memories')
      .update({ likes: count + 1 })
      .eq('id', memoryId);

    const m = allMemories.find(x => x.id === memoryId);
    if (m) { m.likes = count + 1; m.userLiked = true; }
  }
}


// ── Open Memory Detail Modal ──────────────────────────────

async function openMemory(id) {
  const m = allMemories.find(x => x.id === id);
  if (!m) return;

  const profile  = m.profiles || {};
  const name     = profile.full_name || 'Anonymous';
  const initials = getInitials(name);
  const date     = new Date(m.created_at).toLocaleDateString('en-PK', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  // Build photo gallery HTML
  const photos = m.photo_url ? getPhotoUrls(m.photo_url) : [];
  let galleryHTML = '';

  // Store photos in a registry keyed by memory id so onclick handlers can retrieve them safely
  window._galleryRegistry = window._galleryRegistry || {};
  window._galleryRegistry[m.id] = photos;

  if (photos.length === 1) {
    // Single photo — show it with a fullscreen button
    galleryHTML = `
      <div class="memory-gallery protected-gallery" style="position:relative;cursor:pointer"
           data-memory-id="${escapeHTML(m.id)}" data-photo-index="0"
           onclick="openLightboxFromGallery(this, 0)">
        <img class="memory-detail-img protected-img" src="${escapeHTML(photos[0])}" alt="${escapeHTML(m.title)}"
             draggable="false" style="width:100%;display:block;pointer-events:none">
        <div class="gallery-fullscreen-hint" style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.5);color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;pointer-events:none">⛶ Full screen</div>
      </div>`;
  } else if (photos.length > 1) {
    // Multiple photos — show slider with arrows + dots + fullscreen
    const thumbs = photos.map((url, i) =>
      `<img src="${escapeHTML(url)}" data-index="${i}"
            draggable="false"
            class="protected-img"
            style="width:52px;height:52px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid ${i === 0 ? 'var(--green)' : 'transparent'};opacity:${i === 0 ? '1' : '0.6'};transition:all 0.2s"
            onclick="switchGalleryPhoto(${i})">`
    ).join('');

    galleryHTML = `
      <div class="memory-gallery protected-gallery" style="position:relative">
        <div style="position:relative;background:#000;overflow:hidden;cursor:zoom-in"
             data-memory-id="${escapeHTML(m.id)}"
             onclick="openLightboxFromGallery(this, window.currentGalleryIndex||0)">
          <img id="gallery-main-img" class="memory-detail-img protected-img"
               src="${escapeHTML(photos[0])}" alt="${escapeHTML(m.title)}"
               draggable="false"
               style="width:100%;display:block;max-height:400px;object-fit:contain;pointer-events:none">
          <div style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.5);color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;pointer-events:none">⛶ Full screen</div>
          <div id="gallery-counter" style="position:absolute;bottom:10px;left:10px;background:rgba(0,0,0,0.5);color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;pointer-events:none">1 / ${photos.length}</div>
        </div>
        ${photos.length > 1 ? `
        <button onclick="event.stopPropagation();switchGalleryPhoto((window.currentGalleryIndex||0) - 1)"
                style="position:absolute;top:50%;left:8px;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:34px;height:34px;font-size:18px;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center">‹</button>
        <button onclick="event.stopPropagation();switchGalleryPhoto((window.currentGalleryIndex||0) + 1)"
                style="position:absolute;top:50%;right:8px;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:34px;height:34px;font-size:18px;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center">›</button>
        ` : ''}
        <div id="gallery-thumbs" style="display:flex;gap:6px;padding:8px 10px;background:#f5f5f5;flex-wrap:wrap">${thumbs}</div>
      </div>`;
  }

  // Store photo array globally for gallery navigation
  window.currentGalleryPhotos = photos;
  window.currentGalleryIndex  = 0;

  const isOwner  = currentProfile && m.user_id === currentProfile.id;
  const deleteBtn = isOwner
    ? `<button class="btn-delete-memory" onclick="deleteMemory('${m.id}')" 
              title="Delete this memory">🗑️ Delete</button>`
    : '';

  document.getElementById('memory-detail-content').innerHTML = `
    ${galleryHTML}
    <div class="memory-detail-body">
      <div class="memory-detail-meta">
        ${m.category ? `<span class="memory-detail-cat">${escapeHTML(m.category)}</span>` : ''}
        <span class="memory-detail-date">${date}</span>
        ${m.department ? `<span class="memory-detail-date">· ${escapeHTML(m.department)}</span>` : ''}
        ${m.year ? `<span class="memory-detail-date">· ${m.year}</span>` : ''}
      </div>
      <h2 class="memory-detail-title">${escapeHTML(m.title)}</h2>
      ${m.content ? `<p class="memory-detail-content-text">${escapeHTML(m.content).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="memory-detail-footer">
        <div class="memory-author" style="align-items:center">
          <div class="memory-author-avatar" style="width:40px;height:40px;font-size:0.9rem">${initials}</div>
          <div class="memory-author-info">
            <div class="memory-author-name">${escapeHTML(name)}</div>
            ${profile.department ? `<div class="memory-author-year">${escapeHTML(profile.department)}${profile.batch_year ? ` · Batch ${profile.batch_year}` : ''}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn-like ${m.userLiked ? 'liked' : ''}" onclick="toggleLike('${m.id}', this)"
                  aria-label="Like this memory">
            ♥ <span>${m.likes || 0}</span>
          </button>
          ${deleteBtn}
        </div>
      </div>

      <!-- Comments Section -->
      <div class="comments-section">
        <div class="comments-title">💬 Comments</div>
        <div id="comments-list">
          <div class="comment-loading">Loading comments…</div>
        </div>

        ${currentUser
          ? `<div class="comment-form">
               <input type="text" id="comment-input"
                      placeholder="Add a thoughtful comment…"
                      maxlength="500"
                      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();postComment('${m.id}')}">
               <button class="btn-comment" onclick="postComment('${m.id}')">Post</button>
             </div>`
          : `<p class="comments-signin-prompt">
               <a onclick="closeAllModals();showPage('login')"
                  style="color:var(--teal);cursor:pointer;font-weight:600">Sign in</a>
               to share your thoughts on this memory.
             </p>`
        }
      </div>
    </div>
  `;

  document.getElementById('modal-memory-detail').classList.add('open');
  document.body.style.overflow = 'hidden';

  loadComments(id);
}

// ── Gallery navigation ────────────────────────────────────
function switchGalleryPhoto(index) {
  const photos = window.currentGalleryPhotos || [];
  if (!photos.length) return;

  // Wrap around
  index = ((index % photos.length) + photos.length) % photos.length;
  window.currentGalleryIndex = index;

  const mainImg = document.getElementById('gallery-main-img');
  const counter = document.getElementById('gallery-counter');
  const thumbs  = document.querySelectorAll('#gallery-thumbs img');

  if (mainImg) mainImg.src = photos[index];
  if (counter) counter.textContent = `${index + 1} / ${photos.length}`;

  thumbs.forEach((t, i) => {
    t.style.border   = i === index ? '2px solid var(--green)' : '2px solid transparent';
    t.style.opacity  = i === index ? '1' : '0.6';
  });
}

// ── Safe gallery opener (avoids JSON.stringify in inline onclick) ──
function openLightboxFromGallery(el, startIndex) {
  const memId = el.dataset.memoryId || (el.closest('[data-memory-id]') && el.closest('[data-memory-id]').dataset.memoryId);
  const photos = (window._galleryRegistry && memId && window._galleryRegistry[memId])
    || window.currentGalleryPhotos
    || [];
  openLightbox(photos, startIndex || 0);
}

// ── Image Protection ──────────────────────────────────────
(function initImageProtection() {
  // 1. Block right-click on images site-wide
  document.addEventListener('contextmenu', function(e) {
    const t = e.target;
    if (t.tagName === 'IMG' || (t.closest && t.closest('.protected-gallery, #lightbox-overlay'))) {
      e.preventDefault();
      return false;
    }
  });

  // 2. Block drag-start on all images
  document.addEventListener('dragstart', function(e) {
    if (e.target.tagName === 'IMG') { e.preventDefault(); return false; }
  });

  // 3. Block middle-click (open in new tab) on images
  document.addEventListener('auxclick', function(e) {
    if (e.button === 1 && e.target.tagName === 'IMG') { e.preventDefault(); return false; }
  });

  // 4. Inject protection CSS once DOM is ready
  const protStyle = document.createElement('style');
  protStyle.id = 'img-protection-styles';
  protStyle.textContent = `
    img {
      -webkit-user-drag: none;
      user-drag: none;
      -webkit-user-select: none;
      user-select: none;
    }
    /* Print / screenshot deterrence: images become invisible when printing */
    @media print {
      body * { visibility: hidden !important; }
      body::after {
        content: "NUTECH Vault — Content is protected.";
        visibility: visible !important;
        position: fixed; top: 50%; left: 50%;
        transform: translate(-50%,-50%);
        font-size: 24px; color: #333; text-align: center;
      }
    }
    /* Lightbox screenshot guard watermark */
    #lb-screenshot-guard {
      position: absolute; inset: 0; z-index: 5;
      pointer-events: none;
      background-image: repeating-linear-gradient(
        45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px,
        transparent 1px, transparent 20px
      );
    }
    .protected-gallery, #lb-img-wrap {
      -webkit-user-select: none;
      user-select: none;
    }
    /* Prevent highlighting/selecting images inside cards */
    .memory-card-img { pointer-events: none; }
    .memory-card-img img { pointer-events: none !important; }
  `;
  document.head.appendChild(protStyle);
})();

// ── Lightbox (fullscreen viewer) ──────────────────────────
function openLightbox(photos, startIndex) {
  const existing = document.getElementById('lightbox-overlay');
  if (existing) existing.remove();
  if (!photos || !photos.length) return;

  let idx = ((startIndex % photos.length) + photos.length) % photos.length;

  // Zoom / pan state
  let scale      = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastPinchDist = null;
  let isAnimating   = false;

  // Inject styles once
  if (!document.getElementById('lb-styles')) {
    const s = document.createElement('style');
    s.id = 'lb-styles';
    s.textContent = `
      #lightbox-overlay {
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,0);
        display:flex;flex-direction:column;
        align-items:center;justify-content:center;
        touch-action:none;
        transition:background 0.38s cubic-bezier(.4,0,.2,1);
        backdrop-filter:blur(0px);-webkit-backdrop-filter:blur(0px);
      }
      #lightbox-overlay.lb-visible {
        background:rgba(4,4,10,0.97);
        backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
      }
      #lb-topbar {
        position:absolute;top:0;left:0;right:0;height:66px;
        display:flex;align-items:center;justify-content:space-between;
        padding:0 18px;
        background:linear-gradient(to bottom,rgba(0,0,0,0.72) 0%,transparent 100%);
        z-index:10;
        opacity:0;transform:translateY(-14px);
        transition:opacity 0.38s ease,transform 0.38s ease;
      }
      #lightbox-overlay.lb-visible #lb-topbar{opacity:1;transform:translateY(0);}
      #lb-counter{
        background:rgba(255,255,255,0.12);
        backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,0.18);
        color:#fff;font-size:13px;font-weight:600;
        padding:6px 16px;border-radius:20px;letter-spacing:0.3px;
      }
      #lb-zoom-group{
        display:flex;align-items:center;gap:5px;
        background:rgba(255,255,255,0.10);
        backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,0.16);
        border-radius:26px;padding:5px 8px;
      }
      .lb-zoom-btn{
        background:none;border:none;color:#fff;
        width:32px;height:32px;border-radius:50%;
        font-size:20px;font-weight:300;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:background 0.18s ease,transform 0.15s ease;line-height:1;
      }
      .lb-zoom-btn:hover{background:rgba(255,255,255,0.22);transform:scale(1.12);}
      .lb-zoom-btn:active{transform:scale(0.94);}
      #lb-zoom-pct{
        color:rgba(255,255,255,0.88);font-size:12px;font-weight:700;
        min-width:40px;text-align:center;letter-spacing:0.5px;
        cursor:pointer;padding:3px 6px;border-radius:7px;
        transition:background 0.18s;
      }
      #lb-zoom-pct:hover{background:rgba(255,255,255,0.18);}
      #lb-close{
        background:rgba(255,255,255,0.10);
        backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,0.16);
        color:#fff;width:40px;height:40px;border-radius:50%;
        font-size:20px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:background 0.2s,transform 0.2s;
      }
      #lb-close:hover{background:rgba(200,40,40,0.65);transform:scale(1.1) rotate(90deg);}
      #lb-img-wrap{
        overflow:hidden;width:94vw;height:80vh;
        display:flex;align-items:center;justify-content:center;
        cursor:default;border-radius:8px;position:relative;
      }
      #lb-img{
        max-width:100%;max-height:100%;object-fit:contain;
        border-radius:6px;user-select:none;-webkit-user-drag:none;
        transform-origin:center center;will-change:transform;
        pointer-events:none;
        box-shadow:0 28px 72px rgba(0,0,0,0.65);
        opacity:0;transition:opacity 0.22s ease;
      }
      #lb-img.lb-img-ready{opacity:1;}
      #lb-img.lb-slide-out-left {animation:lbOutL 0.22s ease forwards;}
      #lb-img.lb-slide-out-right{animation:lbOutR 0.22s ease forwards;}
      #lb-img.lb-slide-in-left  {animation:lbInL  0.26s cubic-bezier(.34,1.4,.64,1) forwards;}
      #lb-img.lb-slide-in-right {animation:lbInR  0.26s cubic-bezier(.34,1.4,.64,1) forwards;}
      @keyframes lbOutL {to{opacity:0;transform:translateX(-65px) scale(0.93);}}
      @keyframes lbOutR {to{opacity:0;transform:translateX( 65px) scale(0.93);}}
      @keyframes lbInL  {from{opacity:0;transform:translateX( 65px) scale(0.93);}to{opacity:1;transform:translateX(0) scale(1);}}
      @keyframes lbInR  {from{opacity:0;transform:translateX(-65px) scale(0.93);}to{opacity:1;transform:translateX(0) scale(1);}}
      .lb-nav-btn{
        position:absolute;top:50%;
        transform:translateY(-50%);
        background:rgba(255,255,255,0.10);
        backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,0.16);
        color:#fff;width:52px;height:52px;border-radius:50%;
        font-size:28px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        z-index:10;
        opacity:0;
        transition:opacity 0.38s ease,background 0.2s,transform 0.2s;
      }
      #lightbox-overlay.lb-visible .lb-nav-btn{opacity:1;}
      .lb-nav-btn:hover{background:rgba(255,255,255,0.26);transform:translateY(-50%) scale(1.1);}
      .lb-nav-btn:active{transform:translateY(-50%) scale(0.95);}
      #lb-prev{left:14px;}
      #lb-next{right:14px;}
      #lb-bottombar{
        position:absolute;bottom:0;left:0;right:0;
        padding:0 0 14px;
        background:linear-gradient(to top,rgba(0,0,0,0.78) 0%,transparent 100%);
        z-index:10;
        opacity:0;transform:translateY(14px);
        transition:opacity 0.38s ease,transform 0.38s ease;
        display:flex;flex-direction:column;align-items:center;gap:9px;
      }
      #lightbox-overlay.lb-visible #lb-bottombar{opacity:1;transform:translateY(0);}
      #lb-hint{
        color:rgba(255,255,255,0.35);font-size:11px;letter-spacing:0.4px;
        display:flex;gap:16px;align-items:center;
      }
      #lb-hint span{display:flex;align-items:center;gap:4px;}
      #lb-thumbs{
        display:flex;gap:7px;max-width:92vw;overflow-x:auto;
        padding:4px 8px;scrollbar-width:none;
      }
      #lb-thumbs::-webkit-scrollbar{display:none;}
      .lb-thumb{
        width:52px;height:52px;flex-shrink:0;
        object-fit:cover;border-radius:7px;cursor:pointer;
        border:2px solid transparent;opacity:0.42;
        transition:opacity 0.22s ease,border-color 0.22s ease,
                    transform 0.22s cubic-bezier(.34,1.4,.64,1),box-shadow 0.22s ease;
      }
      .lb-thumb:hover{opacity:0.78;transform:scale(1.08);}
      .lb-thumb.lb-thumb-active{
        opacity:1;border-color:#fff;
        transform:scale(1.13);
        box-shadow:0 4px 18px rgba(0,0,0,0.55);
      }
      #lb-zoom-ring{
        position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        background:rgba(0,0,0,0.58);backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,0.22);
        color:#fff;font-size:22px;font-weight:700;
        padding:12px 24px;border-radius:14px;
        pointer-events:none;opacity:0;
        transition:opacity 0.2s ease;z-index:20;letter-spacing:0.5px;
      }
      #lb-zoom-ring.lb-ring-show{opacity:1;}
    `;
    document.head.appendChild(s);
  }

  // Build DOM
  const lb = document.createElement('div');
  lb.id = 'lightbox-overlay';
  lb.innerHTML = `
    <div id="lb-topbar">
      <div id="lb-counter">${idx + 1} / ${photos.length}</div>
      <div id="lb-zoom-group">
        <button class="lb-zoom-btn" id="lb-zoom-out" title="Zoom out (−)">−</button>
        <div id="lb-zoom-pct" title="Click to reset zoom">100%</div>
        <button class="lb-zoom-btn" id="lb-zoom-in" title="Zoom in (+)">+</button>
      </div>
      <button id="lb-close" title="Close (Esc)" aria-label="Close">✕</button>
    </div>
    <div id="lb-img-wrap">
      <img id="lb-img" src="${escapeHTML(photos[idx])}" alt="Memory photo" draggable="false"
           oncontextmenu="event.preventDefault();return false;"
           style="-webkit-user-drag:none;user-drag:none">
      <div id="lb-screenshot-guard"></div>
      <div id="lb-zoom-ring">100%</div>
    </div>
    ${photos.length > 1 ? `
    <button class="lb-nav-btn" id="lb-prev" title="Previous (←)" aria-label="Previous">&#8249;</button>
    <button class="lb-nav-btn" id="lb-next" title="Next (→)"     aria-label="Next">&#8250;</button>
    ` : ''}
    <div id="lb-bottombar">
      ${photos.length > 1 ? `
      <div id="lb-thumbs">
        ${photos.map((url, i) =>
          `<img src="${escapeHTML(url)}" data-i="${i}"
               class="lb-thumb ${i === idx ? 'lb-thumb-active' : ''}"
               alt="Photo ${i + 1}" draggable="false">`
        ).join('')}
      </div>` : ''}
      <div id="lb-hint">
        <span>🖱 Scroll to zoom</span>
        <span>Double-click to zoom</span>
        ${photos.length > 1 ? '<span>&#8592; &#8594; Navigate</span>' : ''}
        <span>Esc Close</span>
      </div>
    </div>
  `;
  document.body.appendChild(lb);

  const img      = document.getElementById('lb-img');
  const wrap     = document.getElementById('lb-img-wrap');
  const zoomPct  = document.getElementById('lb-zoom-pct');
  const zoomRing = document.getElementById('lb-zoom-ring');
  const counter  = document.getElementById('lb-counter');

  // Animate in
  requestAnimationFrame(() => requestAnimationFrame(() => lb.classList.add('lb-visible')));
  img.onload = () => img.classList.add('lb-img-ready');
  if (img.complete) img.classList.add('lb-img-ready');

  // Zoom ring flash
  let zoomRingTimer = null;
  function showZoomRing(v) {
    if (!zoomRing) return;
    zoomRing.textContent = Math.round(v * 100) + '%';
    zoomRing.classList.add('lb-ring-show');
    clearTimeout(zoomRingTimer);
    zoomRingTimer = setTimeout(() => zoomRing.classList.remove('lb-ring-show'), 850);
  }

  function applyTransform(animated) {
    if (animated) {
      img.style.transition = 'transform 0.22s cubic-bezier(.4,0,.2,1)';
      setTimeout(() => { img.style.transition = ''; }, 240);
    } else {
      img.style.transition = 'none';
    }
    img.style.transform = `translate(${translateX}px,${translateY}px) scale(${scale})`;
    if (zoomPct) zoomPct.textContent = Math.round(scale * 100) + '%';
    wrap.style.cursor = scale > 1 ? 'grab' : 'default';
  }

  function clampTranslate() {
    if (scale <= 1) { translateX = 0; translateY = 0; return; }
    const renderedW = Math.min(img.naturalWidth  || wrap.clientWidth,  wrap.clientWidth)  * scale;
    const renderedH = Math.min(img.naturalHeight || wrap.clientHeight, wrap.clientHeight) * scale;
    const maxX = Math.max(0, (renderedW - wrap.clientWidth)  / 2);
    const maxY = Math.max(0, (renderedH - wrap.clientHeight) / 2);
    translateX = Math.max(-maxX, Math.min(maxX, translateX));
    translateY = Math.max(-maxY, Math.min(maxY, translateY));
  }

  function resetZoom(animated) {
    scale = 1; translateX = 0; translateY = 0;
    applyTransform(animated !== false);
    if (zoomPct) zoomPct.textContent = '100%';
    wrap.style.cursor = 'default';
  }

  function zoomTo(newScale, animated) {
    scale = Math.min(6, Math.max(1, newScale));
    if (scale === 1) { translateX = 0; translateY = 0; }
    else clampTranslate();
    applyTransform(animated !== false);
    showZoomRing(scale);
  }

  function zoomBy(delta) { zoomTo(scale + delta); }

  // Scroll wheel
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.25 : -0.25);
  }, { passive: false });

  // Zoom buttons
  document.getElementById('lb-zoom-in').onclick  = e => { e.stopPropagation(); zoomBy(0.5); };
  document.getElementById('lb-zoom-out').onclick = e => { e.stopPropagation(); zoomBy(-0.5); };
  if (zoomPct) zoomPct.onclick = e => { e.stopPropagation(); resetZoom(); };

  // Drag to pan
  wrap.addEventListener('mousedown', e => {
    if (scale <= 1) return;
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX - translateX;
    dragStartY = e.clientY - translateY;
    wrap.style.cursor = 'grabbing';
    img.style.transition = 'none';
  });
  function handleMouseMove(e) {
    if (!isDragging) return;
    translateX = e.clientX - dragStartX;
    translateY = e.clientY - dragStartY;
    clampTranslate();
    img.style.transform = `translate(${translateX}px,${translateY}px) scale(${scale})`;
  }
  function handleMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    wrap.style.cursor = scale > 1 ? 'grab' : 'default';
  }
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);

  // Double-click to toggle zoom
  wrap.addEventListener('dblclick', () => {
    if (scale > 1) resetZoom(); else zoomTo(2.5);
  });

  // Pinch-to-zoom
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !lastPinchDist) return;
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    zoomTo(scale * (dist / lastPinchDist), false);
    lastPinchDist = dist;
  }, { passive: false });
  wrap.addEventListener('touchend', () => { lastPinchDist = null; });

  // Navigate
  function updateLb(newIdx, direction) {
    if (isAnimating || photos.length < 2) return;
    newIdx = ((newIdx % photos.length) + photos.length) % photos.length;
    if (newIdx === idx) return;
    isAnimating = true;
    direction = direction || 'right';
    const outCls = direction === 'right' ? 'lb-slide-out-left'  : 'lb-slide-out-right';
    const inCls  = direction === 'right' ? 'lb-slide-in-left'   : 'lb-slide-in-right';
    resetZoom(false);
    img.classList.add(outCls);
    setTimeout(() => {
      img.classList.remove(outCls);
      img.classList.remove('lb-img-ready');
      idx = newIdx;
      img.src = photos[idx];
      img.onload = () => img.classList.add('lb-img-ready');
      if (img.complete) img.classList.add('lb-img-ready');
      img.classList.add(inCls);
      if (counter) counter.textContent = `${idx + 1} / ${photos.length}`;
      document.querySelectorAll('.lb-thumb').forEach((t, i) => t.classList.toggle('lb-thumb-active', i === idx));
      const at = document.querySelector('.lb-thumb-active');
      if (at) at.scrollIntoView({ inline: 'center', behavior: 'smooth' });
      setTimeout(() => { img.classList.remove(inCls); isAnimating = false; }, 270);
    }, 200);
  }

  // Arrows
  const prevBtn = document.getElementById('lb-prev');
  const nextBtn = document.getElementById('lb-next');
  if (prevBtn) prevBtn.onclick = e => { e.stopPropagation(); updateLb(idx - 1, 'left'); };
  if (nextBtn) nextBtn.onclick = e => { e.stopPropagation(); updateLb(idx + 1, 'right'); };

  // Thumbnail clicks
  document.querySelectorAll('.lb-thumb').forEach(t => {
    t.onclick = e => { e.stopPropagation(); const ti = parseInt(t.dataset.i); updateLb(ti, ti > idx ? 'right' : 'left'); };
  });

  // Touch swipe
  let touchStartX = 0;
  lb.addEventListener('touchstart', e => { if (e.touches.length === 1) touchStartX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (scale > 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 52) updateLb(dx < 0 ? idx + 1 : idx - 1, dx < 0 ? 'right' : 'left');
  }, { passive: true });

  // Close
  function closeLightbox() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    lb.classList.remove('lb-visible');
    setTimeout(() => lb.remove(), 400);
  }
  document.getElementById('lb-close').onclick = e => { e.stopPropagation(); closeLightbox(); };
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

  // Keyboard
  function onKey(e) {
    if (e.key === 'ArrowRight') updateLb(idx + 1, 'right');
    if (e.key === 'ArrowLeft')  updateLb(idx - 1, 'left');
    if (e.key === '+' || e.key === '=') zoomBy(0.5);
    if (e.key === '-') zoomBy(-0.5);
    if (e.key === '0') resetZoom();
    if (e.key === 'Escape') closeLightbox();
  }
  document.addEventListener('keydown', onKey);
}
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(o => o.classList.remove('open'));
  document.body.style.overflow = '';
}


// ── Comments ──────────────────────────────────────────────

async function loadComments(memoryId) {
  const list = document.getElementById('comments-list');
  if (!list) return;

  const { data: comments, error } = await supabaseClient
    .from('comments')
    .select('*, profiles(full_name)')
    .eq('memory_id', memoryId)
    .order('created_at', { ascending: true });

  if (error) {
    list.innerHTML = '<p style="font-size:0.85rem;color:var(--red)">Failed to load comments.</p>';
    return;
  }

  if (!comments || !comments.length) {
    list.innerHTML = `<p class="comments-empty">No comments yet. Be the first to say something!</p>`;
    return;
  }

  list.innerHTML = comments.map(c => {
    const name     = c.profiles?.full_name || 'Anonymous';
    const initials = getInitials(name);
    const date     = new Date(c.created_at).toLocaleDateString('en-PK', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    const isOwner  = currentProfile && c.user_id === currentProfile.id;
    return `
      <div class="comment-item">
        <div class="comment-avatar">${initials}</div>
        <div class="comment-bubble">
          <div class="comment-header">
            <div class="comment-author">${escapeHTML(name)}</div>
            <div class="comment-date">${date}</div>
          </div>
          <div class="comment-text">${escapeHTML(c.content)}</div>
        </div>
        ${isOwner ? `<button class="comment-delete-btn" onclick="deleteComment('${c.id}','${memoryId}')"
                             title="Delete comment">×</button>` : ''}
      </div>
    `;
  }).join('');
}

async function postComment(memoryId) {
  if (!currentUser) return;

  const input = document.getElementById('comment-input');
  const text  = input?.value?.trim();

  if (!text) {
    input?.focus();
    return;
  }

  if (!currentProfile) {
    await fetchProfile();
  }

  const profileId = currentProfile?.id;
  if (!profileId) {
    showToast('Your profile could not be verified. Please sign out and back in.', 'error');
    return;
  }

  const btn = input.nextElementSibling;
  if (btn) btn.disabled = true;

  const { error } = await supabaseClient
    .from('comments')
    .insert({
      memory_id: memoryId,
      user_id:   profileId,
      content:   text
    });

  if (btn) btn.disabled = false;

  if (error) {
    showToast('Failed to post your comment. Please try again.', 'error');
    return;
  }

  input.value = '';
  loadComments(memoryId);
}

async function deleteComment(commentId, memoryId) {
  showConfirm({
    title: 'Delete Comment',
    message: 'Are you sure you want to delete this comment?',
    confirmText: '🗑️ Yes, Delete',
    cancelText: 'Cancel',
    icon: '💬',
    onConfirm: async () => {
      const { error } = await supabaseClient
        .from('comments')
        .delete()
        .eq('id', commentId);

      if (error) {
        showToast('Failed to delete comment.', 'error');
        return;
      }

      loadComments(memoryId);
    }
  });
}


// ── Add Memory Modal ──────────────────────────────────────

let selectedPhotoFiles = []; // now an array for multiple files

document.getElementById('btn-add-memory').addEventListener('click', () => {
  if (!currentUser) {
    showToast('Please sign in to share a memory.', 'info');
    showPage('login');
    return;
  }
  if (currentProfile?.department) {
    const deptSelect = document.getElementById('memory-department');
    if (deptSelect) deptSelect.value = currentProfile.department;
  }
  document.getElementById('modal-add-memory').classList.add('open');
  document.body.style.overflow = 'hidden';
});

// Modal close handlers
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
  });
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const overlay = btn.closest('.modal-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  });
});

// ── Category Pills ────────────────────────────────────────

document.querySelectorAll('.cat-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const isActive = pill.classList.contains('active');
    document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
    if (!isActive) {
      pill.classList.add('active');
      document.getElementById('memory-category').value = pill.dataset.value;
    } else {
      document.getElementById('memory-category').value = '';
    }
  });
});

// ── Multi-Photo Upload ────────────────────────────────────

const uploadArea = document.getElementById('photo-upload-area');
const fileInput  = document.getElementById('photo-file-input');

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) {
    handlePhotoSelect(Array.from(fileInput.files));
  }
  // reset so same files can be re-added if needed
  fileInput.value = '';
});

function handlePhotoSelect(files) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  files.forEach(file => {
    if (file.size > 10 * 1024 * 1024) {
      showToast(`"${file.name}" exceeds the 10 MB limit — skipped.`, 'error');
      return;
    }
    if (!allowedTypes.includes(file.type)) {
      showToast(`"${file.name}" is not a supported image type — skipped.`, 'error');
      return;
    }
    // Avoid duplicates by name+size
    const isDupe = selectedPhotoFiles.some(f => f.name === file.name && f.size === file.size);
    if (!isDupe) selectedPhotoFiles.push(file);
  });

  renderPhotoThumbs();
}

function renderPhotoThumbs() {
  const thumbsContainer   = document.getElementById('photo-thumbs');
  const previewGrid       = document.getElementById('photo-previews-grid');
  const uploadPrompt      = document.getElementById('photo-upload-prompt');

  thumbsContainer.innerHTML = '';

  if (selectedPhotoFiles.length === 0) {
    previewGrid.style.display   = 'none';
    uploadArea.style.display    = '';
    uploadPrompt.style.display  = '';
    return;
  }

  // Hide the big upload zone once files are chosen; show preview grid instead
  uploadArea.style.display  = 'none';
  previewGrid.style.display = '';

  selectedPhotoFiles.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const thumb = document.createElement('div');
      thumb.style.cssText = 'position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:2px solid var(--border);flex-shrink:0';
      thumb.innerHTML = `
        <img src="${e.target.result}" alt="${escapeHTML(file.name)}"
             style="width:100%;height:100%;object-fit:cover">
        <button type="button" title="Remove"
          style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center"
          data-idx="${idx}">✕</button>
      `;
      thumb.querySelector('button').addEventListener('click', () => {
        selectedPhotoFiles.splice(idx, 1);
        renderPhotoThumbs();
      });
      thumbsContainer.appendChild(thumb);
    };
    reader.readAsDataURL(file);
  });
}

// ── Submit New Memory ─────────────────────────────────────

document.getElementById('add-memory-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const title      = document.getElementById('memory-title').value.trim();
  const content    = document.getElementById('memory-content').value.trim();
  const category   = document.getElementById('memory-category').value;
  const department = document.getElementById('memory-department').value;
  const year       = parseInt(document.getElementById('memory-year').value) || null;

  const privacyRadio = document.querySelector('input[name="memory-privacy"]:checked');
  const visibility   = privacyRadio ? privacyRadio.value : 'public';

  if (!title) {
    showToast('Please provide a title for your memory.', 'error');
    return;
  }

  if (!currentProfile) {
    await fetchProfile();
    if (!currentProfile) {
      showToast('Your profile could not be found. Please sign out and sign back in.', 'error');
      return;
    }
  }

  setLoading('btn-submit-memory', true, 'Saving Memory…');

  // Upload all selected photos and store ALL paths comma-separated in photo_url
  let photo_url = null;
  const allUploadedPaths = [];

  if (selectedPhotoFiles.length > 0) {
    showProgress(true, 0);
    const totalFiles = selectedPhotoFiles.length;
    let uploaded = 0;

    for (const file of selectedPhotoFiles) {
      const ext  = file.name.split('.').pop().toLowerCase();
      const rand = Math.random().toString(36).substring(2, 8);
      const path = `${currentUser.id}/${Date.now()}-${rand}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('memory-photos')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      uploaded++;
      showProgress(true, Math.round((uploaded / totalFiles) * 100));

      if (uploadError) {
        setLoading('btn-submit-memory', false, 'Share Memory');
        showProgress(false);
        if (uploadError.message.includes('Bucket not found')) {
          showToast('Storage not configured. Please create the "memory-photos" bucket in Supabase.', 'error');
        } else if (uploadError.message.includes('not authorized')) {
          showToast('Photo upload permission denied. Check your Supabase storage policies.', 'error');
        } else {
          showToast(`Photo upload failed: ${uploadError.message}`, 'error');
        }
        return;
      }

      // Collect every uploaded path
      allUploadedPaths.push(uploadData.path);
    }

    // Store all paths as comma-separated string; first path is the cover
    photo_url = allUploadedPaths.join(',');

    await new Promise(r => setTimeout(r, 300));
    showProgress(false);
  }

  const { error: insertError } = await supabaseClient.from('memories').insert({
    user_id:    currentProfile.id,
    title,
    content:    content || null,
    category:   category || null,
    department: department || null,
    year,
    photo_url,
    visibility,
    is_public:  visibility === 'public',
    likes:      0
  });

  setLoading('btn-submit-memory', false, 'Share Memory');

  if (insertError) {
    // If visibility column doesn't exist yet, retry without it
    if (insertError.message && insertError.message.includes('visibility')) {
      const { error: retryError } = await supabaseClient.from('memories').insert({
        user_id:    currentProfile.id,
        title,
        content:    content || null,
        category:   category || null,
        department: department || null,
        year,
        photo_url,
        is_public:  visibility === 'public',
        likes:      0
      });
      if (retryError) {
        showToast('Failed to save your memory. Please try again.', 'error');
        return;
      }
    } else {
      showToast('Failed to save your memory. Please try again.', 'error');
      return;
    }
  }

  resetAddMemoryForm();
  document.getElementById('modal-add-memory').classList.remove('open');
  document.body.style.overflow = '';
  showToast('🎉 Your memory has been shared successfully!', 'success');
  loadMemories();
});

function resetAddMemoryForm() {
  document.getElementById('add-memory-form').reset();
  selectedPhotoFiles = [];
  // Reset upload zone visibility
  const uploadArea    = document.getElementById('photo-upload-area');
  const previewGrid   = document.getElementById('photo-previews-grid');
  const thumbs        = document.getElementById('photo-thumbs');
  const uploadPrompt  = document.getElementById('photo-upload-prompt');
  if (uploadArea)   uploadArea.style.display    = '';
  if (previewGrid)  previewGrid.style.display   = 'none';
  if (thumbs)       thumbs.innerHTML            = '';
  if (uploadPrompt) uploadPrompt.style.display  = '';
  // Reset category pills
  document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
  document.getElementById('memory-category').value = '';
  showProgress(false);
  const publicRadio = document.querySelector('input[name="memory-privacy"][value="public"]');
  if (publicRadio) publicRadio.checked = true;
}

function showProgress(show, percent = 0) {
  const progressEl = document.getElementById('upload-progress');
  const fillEl     = document.getElementById('upload-progress-fill');
  const textEl     = document.getElementById('upload-progress-text');

  if (!progressEl || !fillEl) return;

  progressEl.style.display = show ? 'block' : 'none';
  if (show) {
    fillEl.style.width = `${percent}%`;
    if (textEl) {
      textEl.textContent = percent < 100 ? `Uploading photo… ${percent}%` : 'Upload complete ✓';
    }
  }
}


// ── Custom Confirm Dialog ─────────────────────────────────
function showConfirm({ title, message, confirmText = 'Delete', cancelText = 'Cancel', icon = '🗑️', onConfirm }) {
  const existing = document.getElementById('custom-confirm-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'custom-confirm-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:999999',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0)', 'transition:background 0.3s ease',
    'padding:20px'
  ].join(';');

  overlay.innerHTML =
    '<div id="custom-confirm-box" style="' + [
      'background:#fff',
      'border-radius:20px',
      'padding:36px 32px 28px',
      'max-width:420px',
      'width:100%',
      'box-shadow:0 25px 60px rgba(0,0,0,0.3),0 8px 20px rgba(0,0,0,0.15)',
      'transform:scale(0.85) translateY(20px)',
      'opacity:0',
      'transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s ease',
      'text-align:center',
      'position:relative',
      'overflow:hidden'
    ].join(';') + '">' +
      '<div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#c0392b,#e74c3c,#c0392b);background-size:200%;animation:shimmer 2s linear infinite"></div>' +
      '<div style="' + [
        'width:72px', 'height:72px',
        'background:linear-gradient(135deg,#fde8e8,#ffc5c5)',
        'border-radius:50%',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-size:32px',
        'margin:0 auto 20px',
        'box-shadow:0 4px 15px rgba(231,76,60,0.3)',
        'animation:iconPulse 0.6s ease 0.3s both'
      ].join(';') + '">' + icon + '</div>' +
      '<h3 style="margin:0 0 10px;font-size:1.3rem;color:#1a1a1a;font-weight:700;letter-spacing:-0.3px">' + title + '</h3>' +
      '<p style="margin:0 0 28px;font-size:0.95rem;color:#666;line-height:1.6">' + message + '</p>' +
      '<div style="display:flex;gap:12px;justify-content:center">' +
        '<button id="confirm-cancel-btn" style="' + [
          'flex:1', 'padding:12px 20px',
          'border:2px solid #e0e0e0',
          'border-radius:12px',
          'background:#fff',
          'color:#555',
          'font-size:0.95rem',
          'font-weight:600',
          'cursor:pointer',
          'transition:all 0.2s ease',
          'letter-spacing:0.2px'
        ].join(';') + '">' + cancelText + '</button>' +
        '<button id="confirm-delete-btn" style="' + [
          'flex:1', 'padding:12px 20px',
          'border:none',
          'border-radius:12px',
          'background:linear-gradient(135deg,#e74c3c,#c0392b)',
          'color:#fff',
          'font-size:0.95rem',
          'font-weight:700',
          'cursor:pointer',
          'transition:all 0.2s ease',
          'box-shadow:0 4px 15px rgba(231,76,60,0.4)',
          'letter-spacing:0.2px'
        ].join(';') + '">' + confirmText + '</button>' +
      '</div>' +
    '</div>';

  // Add keyframe animations
  if (!document.getElementById('confirm-styles')) {
    const style = document.createElement('style');
    style.id = 'confirm-styles';
    style.textContent =
      '@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}' +
      '@keyframes iconPulse{0%{transform:scale(0) rotate(-20deg);opacity:0}70%{transform:scale(1.15) rotate(5deg)}100%{transform:scale(1) rotate(0deg);opacity:1}}' +
      '#confirm-cancel-btn:hover{background:#f5f5f5!important;border-color:#bbb!important;transform:translateY(-1px)}' +
      '#confirm-delete-btn:hover{transform:translateY(-2px)!important;box-shadow:0 8px 25px rgba(231,76,60,0.5)!important}' +
      '#confirm-delete-btn:active{transform:translateY(0)!important}';
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.background = 'rgba(0,0,0,0.6)';
      const box = document.getElementById('custom-confirm-box');
      if (box) { box.style.transform = 'scale(1) translateY(0)'; box.style.opacity = '1'; }
    });
  });

  function closeConfirm() {
    overlay.style.background = 'rgba(0,0,0,0)';
    const box = document.getElementById('custom-confirm-box');
    if (box) { box.style.transform = 'scale(0.9) translateY(10px)'; box.style.opacity = '0'; }
    setTimeout(() => overlay.remove(), 300);
  }

  document.getElementById('confirm-cancel-btn').addEventListener('click', closeConfirm);
  document.getElementById('confirm-delete-btn').addEventListener('click', function() {
    closeConfirm();
    setTimeout(onConfirm, 150);
  });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeConfirm(); });
  function onEsc(e) { if (e.key === 'Escape') { closeConfirm(); document.removeEventListener('keydown', onEsc); } }
  document.addEventListener('keydown', onEsc);
}

// ── Delete Memory ─────────────────────────────────────────

async function deleteMemory(id) {
  showConfirm({
    title: 'Delete Memory',
    message: 'Are you sure you want to permanently delete this memory? This action cannot be undone.',
    confirmText: '🗑️ Yes, Delete',
    cancelText: 'Keep It',
    icon: '🗑️',
    onConfirm: async () => {
      if (!currentUser) {
        showToast('You must be signed in to delete a memory.', 'error');
        return;
      }

      const m = allMemories.find(x => x.id === id);

      const { error } = await supabaseClient
        .from('memories')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Delete memory error:', error);
        showToast('Failed to delete this memory. Please try again.', 'error');
        return;
      }

      if (m?.photo_url && !m.photo_url.startsWith('http')) {
        await supabaseClient.storage.from('memory-photos').remove([m.photo_url]);
      }

      allMemories = allMemories.filter(x => x.id !== id);
      closeAllModals();
      showToast('🗑️ Memory deleted successfully.', 'success');
      loadMemories();

      const profilePage = document.getElementById('page-profile');
      if (profilePage && profilePage.classList.contains('active')) {
        loadUserMemories();
      }
    }
  });
}


// ═══════════════════════════════════════════════════════
// DEPARTMENTS PAGE
// ═══════════════════════════════════════════════════════

const DEPARTMENTS = [
  // ── NUSIT ─────────────────────────────────────────────
  {
    name: 'Computer Science', short: 'CS', icon: '💻', iconClass: 'teal', school: 'NUSIT',
    degrees: ['BS Computer Science', 'MS Computer Science', 'PhD Computer Science']
  },
  {
    name: 'Artificial Intelligence', short: 'AI', icon: '🤖', iconClass: 'teal', school: 'NUSIT',
    degrees: ['BS Artificial Intelligence', 'MS Artificial Intelligence']
  },
  {
    name: 'Software Engineering', short: 'SE', icon: '🛠️', iconClass: 'teal', school: 'NUSIT',
    degrees: ['BS Software Engineering', 'MS Software Engineering']
  },
  {
    name: 'Information Technology', short: 'IT', icon: '🌐', iconClass: 'teal', school: 'NUSIT',
    degrees: ['BS Information Technology']
  },
  {
    name: 'Cyber Security', short: 'CySec', icon: '🔒', iconClass: 'teal', school: 'NUSIT',
    degrees: ['BS Cyber Security']
  },
  // ── NUSET ─────────────────────────────────────────────
  {
    name: 'Electrical Engineering', short: 'EE', icon: '⚡', iconClass: 'gold', school: 'NUSET',
    degrees: ['BS Electrical Engineering']
  },
  {
    name: 'Mechanical Engineering', short: 'ME', icon: '⚙️', iconClass: 'gold', school: 'NUSET',
    degrees: ['BS Mechanical Engineering']
  },
  {
    name: 'Civil Engineering', short: 'CE', icon: '🏗️', iconClass: 'gold', school: 'NUSET',
    degrees: ['BS Civil Engineering', 'BET Civil']
  },
  {
    name: 'Computer Engineering', short: 'CpE', icon: '🖥️', iconClass: 'gold', school: 'NUSET',
    degrees: ['BS Computer Engineering']
  },
  // ── NUSASH ────────────────────────────────────────────
  {
    name: 'Physics', short: 'PHY', icon: '⚛️', iconClass: 'cream', school: 'NUSASH',
    degrees: ['Applied Sciences']
  },
  {
    name: 'Mathematics', short: 'MATH', icon: '📐', iconClass: 'cream', school: 'NUSASH',
    degrees: ['Applied Sciences']
  },
  {
    name: 'Chemistry', short: 'CHEM', icon: '🧪', iconClass: 'cream', school: 'NUSASH',
    degrees: ['Applied Sciences']
  },
  {
    name: 'English', short: 'ENG', icon: '📝', iconClass: 'cream', school: 'NUSASH',
    degrees: ['Humanities']
  },
];

function renderDepartments() {
  const grid = document.getElementById('dept-grid');
  if (!grid) return;

  // Group by school
  const schools = [
    { key: 'NUSIT', label: 'NUTECH School of Information Technology' },
    { key: 'NUSET', label: 'NUTECH School of Engineering Technology' },
    { key: 'NUSASH', label: 'NUTECH School of Applied Science & Humanity' },
  ];

  grid.innerHTML = schools.map(school => {
    const depts = DEPARTMENTS.filter(d => d.school === school.key);
    return `
      <div class="dept-school-section">
        <div class="dept-school-label">${school.key} — ${school.label}</div>
        <div class="dept-school-grid">
          ${depts.map(d => `
            <div class="dept-card">
              <div class="dept-card-header">
                <div class="dept-icon ${d.iconClass}">${d.icon}</div>
                <div class="dept-info">
                  <div class="dept-name">${d.name}</div>
                  <div class="dept-short">${d.short}</div>
                </div>
              </div>
              <div class="dept-card-body">
                <div class="dept-degrees">
                  <div class="dept-degree-list">
                    ${d.degrees.map(deg => `<span class="dept-degree-item">🎓 ${deg}</span>`).join('')}
                  </div>
                </div>
              </div>
              <div class="dept-card-footer">
                <button class="btn-dept-memories" onclick="filterByDept('${d.name}')">
                  📸 View Memories
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}


// ═══════════════════════════════════════════════════════
// PROFILE PAGE
// ═══════════════════════════════════════════════════════

async function loadProfile() {
  if (!currentUser) return;

  await fetchProfile();

  const p = currentProfile;
  if (!p || (!p.full_name && !p.student_id)) {
    // Ghost/incomplete account — sign out and redirect to signup
    showToast('⚠️ Your account is incomplete. Please sign up again to continue.', 'error');
    await supabaseClient.auth.signOut();
    showPage('signup');
    return;
  }

  const initials = getInitials(p.full_name || currentUser.email);
  document.getElementById('profile-avatar-initials').textContent = initials;
  document.getElementById('profile-display-name').textContent    = p.full_name || 'No name set';
  document.getElementById('profile-display-id').textContent      =
    p.student_id ? `Student ID: ${p.student_id}` : currentUser.email;

  if (p.department) {
    const badge = document.getElementById('profile-badge-dept');
    badge.style.display = 'inline-flex';
    badge.querySelector('span').textContent = p.department;
  }
  if (p.batch_year) {
    const badge = document.getElementById('profile-badge-batch');
    badge.style.display = 'inline-flex';
    badge.querySelector('span').textContent = `Batch ${p.batch_year}`;
  }

  document.getElementById('edit-full-name').value  = p.full_name   || '';
  document.getElementById('edit-student-id').value = p.student_id  || '';
  document.getElementById('edit-department').value = p.department  || '';
  document.getElementById('edit-batch-year').value = p.batch_year  || '';

  loadUserMemories();
}

async function loadUserMemories() {
  if (!currentUser || !currentProfile) return;

  const container = document.getElementById('my-memories-grid');
  if (!container) return;

  container.innerHTML = Array(3).fill(0).map(() => `
    <div class="memory-card">
      <div class="memory-card-img skeleton"></div>
      <div class="memory-card-body">
        <div class="skeleton" style="height:16px;width:55%;margin-bottom:12px;border-radius:4px"></div>
        <div class="skeleton" style="height:20px;width:90%;border-radius:4px"></div>
      </div>
    </div>
  `).join('');

  const { data, error } = await supabaseClient
    .from('memories')
    .select('*')
    .eq('user_id', currentProfile.id)
    .order('created_at', { ascending: false });

  if (error || !data || !data.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✍️</div>
        <div class="empty-state-title">No memories shared yet</div>
        <p class="empty-state-desc">
          Share your first NUTECH memory today and let it live on for generations to come.
        </p>
        <button class="btn-primary" style="margin-top:20px"
          onclick="showPage('memories');setTimeout(()=>document.getElementById('btn-add-memory').click(),300)">
          Share Your First Memory
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = data.map(m => `
    <div class="memory-card">
      <div class="memory-card-img">
        ${m.photo_url
          ? `<img src="${escapeHTML(getPhotoUrl(m.photo_url))}"
                  alt="${escapeHTML(m.title)}" loading="lazy">`
          : getCategoryEmoji(m.category)}
      </div>
      <div class="memory-card-body">
        <div class="memory-card-top-row">
          ${m.category ? `<div class="memory-card-cat">${escapeHTML(m.category)}</div>` : '<div></div>'}
          <span class="visibility-badge">
            ${(m.visibility || (m.is_public ? 'public' : 'private')) === 'private' ? '🔐 Private'
              : (m.visibility || '') === 'department' ? '🏛️ Dept'
              : '🌍 Public'}
          </span>
        </div>
        <div class="memory-card-title">${escapeHTML(m.title)}</div>
        ${m.content ? `<p class="memory-card-content">${escapeHTML(m.content)}</p>` : ''}
        <div class="memory-card-footer">
          <span style="font-size:0.78rem;color:var(--ink-faint)">
            ${new Date(m.created_at).toLocaleDateString('en-PK', { day:'numeric', month:'short', year:'numeric' })}
          </span>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="btn-like liked" style="pointer-events:none">♥ ${m.likes || 0}</span>
            <button class="btn-view-memory"
                    onclick="deleteMemory('${m.id}')"
                    style="background:var(--red-pale);color:var(--red)">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Profile Tab Switching ─────────────────────────────────
document.querySelectorAll('.profile-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const content = document.getElementById(tab.dataset.tab);
    if (content) content.classList.add('active');
  });
});

// ── Save Profile ──────────────────────────────────────────
document.getElementById('save-profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fullName  = document.getElementById('edit-full-name').value.trim();
  const studentId = document.getElementById('edit-student-id').value.trim();
  const dept      = document.getElementById('edit-department').value;
  const batchYear = parseInt(document.getElementById('edit-batch-year').value) || null;

  if (!fullName) {
    showToast('Please enter your full name.', 'error');
    return;
  }

  const updates = {
    full_name:  fullName,
    student_id: studentId || null,
    department: dept || null,
    batch_year: batchYear
  };

  setLoading('btn-save-profile', true, 'Saving…');

  const { error } = await supabaseClient
    .from('profiles')
    .update(updates)
    .eq('id', currentUser.id);

  setLoading('btn-save-profile', false, 'Save Changes');

  if (error) {
    showToast('Failed to save your profile. Please try again.', 'error');
    return;
  }

  await fetchProfile();
  updateNavForUser();
  loadProfile();
  showToast('✅ Your profile has been updated successfully.', 'success');
});


// ═══════════════════════════════════════════════════════
// UTILITY HELPERS
// ═══════════════════════════════════════════════════════

function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0].toUpperCase())
    .join('');
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showAlert(elementId, message, type = 'error') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.innerHTML = `<span>${type === 'error' ? '⚠️' : '✅'}</span> ${escapeHTML(message)}`;
  el.style.display = 'flex';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAlert(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

function setLoading(buttonId, isLoading, label) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.innerHTML = isLoading
    ? `<span class="spinner"></span> ${escapeHTML(label)}`
    : escapeHTML(label);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span>${escapeHTML(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}


// ═══════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════

(async () => {
  try {
    // ── Handle email confirmation & password reset redirects ─
    // Supabase sends #access_token=...&type=recovery for password reset
    // and #access_token=...&type=signup for email confirmation.
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace('#', '?'));
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const tokenType    = params.get('type'); // 'recovery' | 'signup' | null

    if (accessToken && refreshToken) {
      // Only call setSession for password-reset links (type=recovery).
      // For signup confirmation (type=signup), Supabase handles the session
      // automatically — calling setSession here with those tokens causes
      // "Refresh Token Not Found" errors when they expire or are reused.
      if (tokenType === 'recovery') {
        try {
          await supabaseClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        } catch (e) {
          console.warn('setSession from URL hash failed:', e);
        }
        history.replaceState(null, '', window.location.pathname);
        showPage('new-password');
        isInitialising = false;
        return; // skip the rest of init — page is already set
      }
      // For signup confirmations just clear the hash — session is already active
      history.replaceState(null, '', window.location.pathname);
    } else {
      // Also handle PKCE / OTP code flow (newer Supabase versions)
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');
      if (code) {
        try {
          await supabaseClient.auth.exchangeCodeForSession(code);
        } catch (e) {
          console.warn('exchangeCodeForSession failed:', e);
        }
        history.replaceState(null, '', window.location.pathname);
      }
    }
    // ── End confirmation / reset handler ─────────────────────

    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user ?? null;

    if (currentUser) {
      await fetchProfile();

      // Ghost guard — only sign out if profile is broken AND user has no metadata
      const meta = currentUser?.user_metadata || {};
      const hasMetadata = !!(meta.full_name || meta.student_id);
      const isProfileBroken = !currentProfile || (!currentProfile.full_name && !currentProfile.student_id);

      if (isProfileBroken && !hasMetadata) {
        console.warn('Ghost account detected on init — signing out.');
        await supabaseClient.auth.signOut();
        currentUser    = null;
        currentProfile = null;
        updateNavForGuest();
      } else {
        updateNavForUser();
      }
    } else {
      updateNavForGuest();
    }
  } catch (err) {
    console.error('Initialisation error:', err);
    updateNavForGuest();
  } finally {
    isInitialising = false;
  }

  showPage('home');
})();