// ============================================
// MAIN APP LOGIC - Telegram ID Based Auth
// ============================================

let currentUser = null; // { uid: telegramId, ...userData }
let userData = null;
let tapsLeft = 50;
let tapResetTimer = null;

// ======================== INIT ========================
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Telegram WebApp
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.ready();
        Telegram.WebApp.expand();
        Telegram.WebApp.setHeaderColor('#111827');
        Telegram.WebApp.setBackgroundColor('#0a0e1a');
    }

    // Auto login if Telegram data available
    const tgData = getTelegramData();
    if (tgData && tgData.user) {
        authenticateWithTelegram(tgData);
    } else {
        hideLoading();
        showScreen('auth');
    }

    // Task filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTasks(btn.dataset.filter);
        });
    });
});

// ======================== SCREENS ========================
function showScreen(screen) {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-app').classList.add('hidden');

    if (screen === 'loading') document.getElementById('loading-screen').classList.remove('hidden');
    else if (screen === 'auth') document.getElementById('auth-screen').classList.remove('hidden');
    else if (screen === 'main') document.getElementById('main-app').classList.remove('hidden');
}

function hideLoading() {
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('hidden');
    }, 600);
}

// ======================== TELEGRAM DATA ========================
function getTelegramData() {
    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe) {
        const tgData = Telegram.WebApp.initDataUnsafe;
        if (tgData && tgData.user) {
            return tgData;
        }
    }
    return null;
}

// ======================== TELEGRAM AUTH ========================
function loginWithTelegram() {
    const tgData = getTelegramData();
    if (tgData && tgData.user) {
        authenticateWithTelegram(tgData);
        return;
    }

    // Demo mode (for testing outside Telegram)
    showToast('Open inside Telegram to login!');
}

async function authenticateWithTelegram(tgData) {
    try {
        showScreen('loading');
        const user = tgData.user;
        const uid = String(user.id); // Telegram user ID as document ID

        // Check if user exists in Firestore
        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            // ============ NEW USER ============
            // Check for referral from URL
            const urlParams = new URLSearchParams(window.location.search);
            const startParam = urlParams.get('start') || '';
            const referrerId = startParam.startsWith('ref') ? startParam.replace('ref', '') : null;

            // Create new user document with Telegram ID
            const newUser = {
                id: uid,
                firstName: user.first_name || 'User',
                lastName: user.last_name || '',
                username: user.username || '',
                photoUrl: user.photo_url || '',
                balance: 0,
                totalEarned: 0,
                tapsLeft: APP_SETTINGS.maxTapsPerRound,
                tapsResetAt: Date.now() + (APP_SETTINGS.tapResetMinutes * 60 * 1000),
                dailyStreak: 0,
                lastCheckin: null,
                completedTasks: [],
                adsWatchedToday: 0,
                adsLastDate: null,
                totalReferrals: 0,
                referralEarnings: 0,
                referredBy: referrerId || null,
                createdAt: Date.now(),
                lastActive: Date.now(),
                isAdmin: false,
                isBanned: false
            };

            await db.collection('users').doc(uid).set(newUser);

            // Handle referral bonus
            if (referrerId && referrerId !== uid) {
                const referrerDoc = await db.collection('users').doc(referrerId).get();
                if (referrerDoc.exists) {
                    // Give referrer reward
                    await db.collection('users').doc(referrerId).update({
                        balance: firebase.firestore.FieldValue.increment(APP_SETTINGS.referralReward),
                        totalEarned: firebase.firestore.FieldValue.increment(APP_SETTINGS.referralReward),
                        totalReferrals: firebase.firestore.FieldValue.increment(1),
                        referralEarnings: firebase.firestore.FieldValue.increment(APP_SETTINGS.referralReward)
                    });

                    // Give new user bonus
                    await db.collection('users').doc(uid).update({
                        balance: firebase.firestore.FieldValue.increment(APP_SETTINGS.referralBonus),
                        totalEarned: firebase.firestore.FieldValue.increment(APP_SETTINGS.referralBonus)
                    });

                    // Save referral record
                    await db.collection('referrals').add({
                        referrerId: referrerId,
                        referredId: uid,
                        referredName: `${user.first_name} ${user.last_name || ''}`.trim(),
                        reward: APP_SETTINGS.referralReward,
                        createdAt: Date.now()
                    });
                }
            }

            userData = newUser;
        } else {
            // ============ EXISTING USER ============
            userData = userDoc.data();

            // Check if user is banned
            if (userData.isBanned) {
                showToast('Your account has been banned.');
                showScreen('auth');
                return;
            }
        }

        // Update last active
        await db.collection('users').doc(uid).update({
            lastActive: Date.now()
        });

        // Set current user
        currentUser = { uid: uid, ...userData };

        // Show main app
        showScreen('main');
        initApp();
        showToast(`Welcome, ${userData.firstName}!`);

    } catch (error) {
        console.error('Auth error:', error);
        hideLoading();
        showScreen('auth');
        showToast('Login failed. Please try again.');
    }
}

// ======================== INIT APP ========================
function initApp() {
    updateGreeting();
    updateUI();
    startTapResetTimer();
    loadTasks();
    loadAds();
    loadReferrals();
    generateCheckinDays();
    setupRealtimeListeners();
}

// ======================== REALTIME LISTENERS ========================
function setupRealtimeListeners() {
    // Listen to user document changes in real-time
    const userRef = db.collection('users').doc(currentUser.uid);
    userRef.onSnapshot(doc => {
        if (doc.exists) {
            userData = doc.data();
            currentUser = { uid: currentUser.uid, ...userData };
            updateUI();
        }
    });
}

// ======================== UPDATE UI ========================
function updateUI() {
    if (!userData) return;

    const balance = userData.balance || 0;
    const firstName = userData.firstName || 'User';
    const initial = firstName.charAt(0).toUpperCase();

    // Balance
    document.getElementById('balance-display').textContent = formatNumber(balance);
    document.getElementById('stat-balance').textContent = formatNumber(balance);

    // User info
    document.getElementById('user-name').textContent = firstName;
    document.getElementById('user-id').textContent = `ID: ${currentUser.uid}`;
    document.getElementById('avatar-letter').textContent = initial;

    // Stats
    document.getElementById('stat-tasks-done').textContent = (userData.completedTasks || []).length;
    document.getElementById('stat-referrals').textContent = userData.totalReferrals || 0;
    document.getElementById('stat-streak').textContent = userData.dailyStreak || 0;

    // Taps
    tapsLeft = userData.tapsLeft || 0;
    document.getElementById('taps-left').textContent = tapsLeft;

    // Check if taps need reset
    const now = Date.now();
    if (userData.tapsResetAt && now > userData.tapsResetAt) {
        tapsLeft = APP_SETTINGS.maxTapsPerRound;
        db.collection('users').doc(currentUser.uid).update({
            tapsLeft: tapsLeft,
            tapsResetAt: now + (APP_SETTINGS.tapResetMinutes * 60 * 1000)
        });
    }

    // Streak
    document.getElementById('streak-badge').textContent = `🔥 ${userData.dailyStreak || 0} days`;

    // Profile
    document.getElementById('profile-name').textContent = firstName;
    document.getElementById('profile-id').textContent = `ID: ${currentUser.uid}`;
    document.getElementById('profile-avatar-letter').textContent = initial;
    document.getElementById('ps-balance').textContent = formatNumber(balance);
    document.getElementById('ps-tasks').textContent = (userData.completedTasks || []).length;
    document.getElementById('ps-refs').textContent = userData.totalReferrals || 0;

    // Daily checkin
    const today = new Date().toDateString();
    const lastCheckin = userData.lastCheckin ? new Date(userData.lastCheckin).toDateString() : null;
    const btnCheckin = document.getElementById('btn-checkin');
    if (lastCheckin === today) {
        btnCheckin.disabled = true;
        btnCheckin.textContent = 'Checked In Today ✓';
    } else {
        btnCheckin.disabled = false;
        const streak = userData.dailyStreak || 0;
        const reward = APP_SETTINGS.dailyCheckinBase + Math.min(streak, 7) * 5;
        btnCheckin.innerHTML = `Check In & Earn <span id="checkin-reward">${reward}</span> 💎`;
    }

    // Ads
    checkAdsReset();
    document.getElementById('ads-today').textContent = userData.adsWatchedToday || 0;
    document.getElementById('ads-limit').textContent = APP_SETTINGS.adDailyLimit;
    document.getElementById('ads-reward').textContent = APP_SETTINGS.adReward;
}

// ======================== GREETING ========================
function updateGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good morning! ☀️';
    if (hour >= 12 && hour < 17) greeting = 'Good afternoon! 🌤️';
    else if (hour >= 17 && hour < 21) greeting = 'Good evening! 🌅';
    else if (hour >= 21 || hour < 5) greeting = 'Good night! 🌙';
    document.getElementById('greeting-text').textContent = greeting;
}

// ======================== PAGE SWITCHING ========================
function switchPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    document.querySelector('.pages-container').scrollTop = 0;

    if (page === 'tasks') loadTasks();
    if (page === 'ads') loadAds();
    if (page === 'referral') loadReferrals();
}

// ======================== TAP TO EARN ========================
function handleTap(event) {
    if (tapsLeft <= 0) {
        showToast('No taps left! Wait for reset.');
        return;
    }

    const tapArea = document.getElementById('tap-area');
    const rect = tapArea.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    createFloatingText(`+${APP_SETTINGS.coinPerTap}`, x, y, tapArea);
    createParticles(event.clientX, event.clientY);

    tapsLeft--;
    document.getElementById('taps-left').textContent = tapsLeft;

    // Optimistic update
    userData.balance = (userData.balance || 0) + APP_SETTINGS.coinPerTap;
    userData.totalEarned = (userData.totalEarned || 0) + APP_SETTINGS.coinPerTap;
    updateUI();

    // Debounced save
    clearTimeout(window._tapSaveTimeout);
    window._tapSaveTimeout = setTimeout(() => {
        db.collection('users').doc(currentUser.uid).update({
            balance: userData.balance,
            totalEarned: userData.totalEarned,
            tapsLeft: tapsLeft,
            lastActive: Date.now()
        });
    }, 500);
}

function createFloatingText(text, x, y, container) {
    const el = document.createElement('div');
    el.className = 'tap-float';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 800);
}

function createParticles(cx, cy) {
    const emojis = ['💎', '✨', '⭐'];
    for (let i = 0; i < 5; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        p.style.left = `${cx + (Math.random() - 0.5) * 80}px`;
        p.style.top = `${cy + (Math.random() - 0.5) * 80}px`;
        document.getElementById('particles').appendChild(p);
        setTimeout(() => p.remove(), 1000);
    }
}

function startTapResetTimer() {
    if (tapResetTimer) clearInterval(tapResetTimer);
    tapResetTimer = setInterval(() => {
        if (!userData || !userData.tapsResetAt) return;
        const remaining = userData.tapsResetAt - Date.now();
        if (remaining <= 0) {
            tapsLeft = APP_SETTINGS.maxTapsPerRound;
            document.getElementById('taps-left').textContent = tapsLeft;
            document.getElementById('tap-reset-timer').textContent = 'Ready!';
            db.collection('users').doc(currentUser.uid).update({
                tapsLeft: tapsLeft,
                tapsResetAt: Date.now() + (APP_SETTINGS.tapResetMinutes * 60 * 1000)
            });
        } else {
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            document.getElementById('tap-reset-timer').textContent =
                `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }, 1000);
}

// ======================== DAILY CHECK-IN ========================
function generateCheckinDays() {
    const container = document.getElementById('checkin-days');
    container.innerHTML = '';
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - mondayOffset);
    weekStart.setHours(0, 0, 0, 0);

    const lastCheckin = userData.lastCheckin ? new Date(userData.lastCheckin) : null;
    const lastCheckinDate = lastCheckin ? new Date(lastCheckin.toDateString()) : null;

    for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + i);

        const dayEl = document.createElement('div');
        dayEl.className = 'checkin-day';

        const isToday = day.toDateString() === today.toDateString();
        const isClaimed = lastCheckinDate && day <= lastCheckinDate && day >= weekStart;

        if (isClaimed) dayEl.classList.add('claimed');
        if (isToday) dayEl.classList.add('today');

        dayEl.innerHTML = `
            <span class="day-num">${day.getDate()}</span>
            <span class="day-label">${days[i]}</span>
        `;
        container.appendChild(dayEl);
    }
}

async function claimDailyCheckin() {
    const today = new Date().toDateString();
    const lastCheckin = userData.lastCheckin ? new Date(userData.lastCheckin).toDateString() : null;

    if (lastCheckin === today) {
        showToast('Already checked in today!');
        return;
    }

    const streak = userData.dailyStreak || 0;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isConsecutive = lastCheckin === yesterday.toDateString();

    const newStreak = isConsecutive ? streak + 1 : 1;
    const reward = APP_SETTINGS.dailyCheckinBase + Math.min(newStreak, 7) * 5;

    try {
        await db.collection('users').doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(reward),
            totalEarned: firebase.firestore.FieldValue.increment(reward),
            dailyStreak: newStreak,
            lastCheckin: new Date().toISOString(),
            lastActive: Date.now()
        });

        userData.balance = (userData.balance || 0) + reward;
        userData.dailyStreak = newStreak;
        userData.lastCheckin = new Date().toISOString();

        showToast(`+${reward} 💎 Check-in complete!`);
        generateCheckinDays();
        updateUI();

    } catch (error) {
        showToast('Error. Try again.');
        console.error(error);
    }
}

// ======================== TASKS ========================
const defaultTasks = [
    { id: 'task1', name: 'Join our Channel', desc: 'Join our official Telegram channel', icon: '📢', category: 'social', reward: 50, type: 'channel', link: 'https://t.me/yourchannel' },
    { id: 'task2', name: 'Follow on Twitter', desc: 'Follow us on X/Twitter', icon: '🐦', category: 'social', reward: 30, type: 'social', link: 'https://twitter.com/yourhandle' },
    { id: 'task3', name: 'Join Group Chat', desc: 'Join our community group', icon: '💬', category: 'social', reward: 40, type: 'channel', link: 'https://t.me/yourgroup' },
    { id: 'task4', name: 'Visit Website', desc: 'Visit our official website', icon: '🌐', category: 'visit', reward: 20, type: 'visit', link: 'https://yoursite.com' },
    { id: 'task5', name: 'Subscribe YouTube', desc: 'Subscribe to our YouTube channel', icon: '📺', category: 'social', reward: 35, type: 'social', link: 'https://youtube.com/@yourchannel' },
    { id: 'task6', name: 'Rate Us 5 Stars', desc: 'Give us 5 star rating', icon: '⭐', category: 'special', reward: 60, type: 'special', link: '#' },
    { id: 'task7', name: 'Share with Friend', desc: 'Share this app with a friend', icon: '🔗', category: 'special', reward: 25, type: 'share', link: '#' },
    { id: 'task8', name: 'Follow Instagram', desc: 'Follow us on Instagram', icon: '📸', category: 'social', reward: 30, type: 'social', link: 'https://instagram.com/yourhandle' },
];

async function loadTasks() {
    const completedTasks = userData.completedTasks || [];
    renderTasks('all', completedTasks);
}

function renderTasks(filter = 'all', completedTasks = []) {
    const container = document.getElementById('tasks-list');
    const tasks = filter === 'all' ? defaultTasks :
        defaultTasks.filter(t => t.category === filter);

    container.innerHTML = tasks.map(task => {
        const isCompleted = completedTasks.includes(task.id);
        return `
            <div class="task-item">
                <div class="task-icon ${task.category}">${task.icon}</div>
                <div class="task-info">
                    <div class="task-name">${task.name}</div>
                    <div class="task-desc">${task.desc}</div>
                </div>
                <span class="task-reward">${task.reward} 💎</span>
                <button class="btn-task ${isCompleted ? 'completed' : ''}"
                    ${isCompleted ? 'disabled' : ''}
                    onclick="${isCompleted ? '' : `completeTask('${task.id}')`}">
                    ${isCompleted ? '✓ Done' : 'Start'}
                </button>
            </div>
        `;
    }).join('');
}

async function completeTask(taskId) {
    const task = defaultTasks.find(t => t.id === taskId);
    if (!task) return;

    const completedTasks = userData.completedTasks || [];
    if (completedTasks.includes(taskId)) {
        showToast('Already completed!');
        return;
    }

    // Open link
    if (task.link && task.link !== '#') {
        window.open(task.link, '_blank');
    }

    showModal('Verify Task', `
        <div style="text-align:center; padding: 10px 0;">
            <div style="font-size:48px; margin-bottom:16px;">${task.icon}</div>
            <h4 style="margin-bottom:8px;">${task.name}</h4>
            <p style="color:var(--text-secondary); font-size:13px; margin-bottom:20px;">${task.desc}</p>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">
                Complete the task above and click verify
            </p>
            <button onclick="verifyTask('${taskId}')" style="
                width:100%; padding:14px; border:none; border-radius:12px;
                background:var(--accent-gradient); color:white; font-size:15px;
                font-weight:700; cursor:pointer;
            ">Verify & Claim ${task.reward} 💎</button>
        </div>
    `);
}

async function verifyTask(taskId) {
    const task = defaultTasks.find(t => t.id === taskId);
    if (!task) return;

    const completedTasks = userData.completedTasks || [];
    if (completedTasks.includes(taskId)) {
        closeModal();
        showToast('Already completed!');
        return;
    }

    try {
        completedTasks.push(taskId);

        await db.collection('users').doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(task.reward),
            totalEarned: firebase.firestore.FieldValue.increment(task.reward),
            completedTasks: completedTasks,
            lastActive: Date.now()
        });

        userData.balance = (userData.balance || 0) + task.reward;
        userData.completedTasks = completedTasks;

        closeModal();
        showToast(`+${task.reward} 💎 Task completed!`);
        updateUI();
        loadTasks();

    } catch (error) {
        showToast('Error. Try again.');
        console.error(error);
    }
}

// ======================== ADS ========================
function checkAdsReset() {
    const today = new Date().toDateString();
    if (userData.adsLastDate !== today) {
        db.collection('users').doc(currentUser.uid).update({
            adsWatchedToday: 0,
            adsLastDate: today
        });
        userData.adsWatchedToday = 0;
        userData.adsLastDate = today;
    }
}

const adTypes = [
    { id: 'ad1', title: 'Premium Offer', duration: 15, emoji: '🎁' },
    { id: 'ad2', title: 'Special Deal', duration: 10, emoji: '💰' },
    { id: 'ad3', title: 'New Feature', duration: 20, emoji: '🚀' },
    { id: 'ad4', title: 'Bonus Event', duration: 12, emoji: '🎉' },
    { id: 'ad5', title: 'Limited Time', duration: 15, emoji: '⏰' },
];

function loadAds() {
    const container = document.getElementById('ads-list');
    const watchedToday = userData.adsWatchedToday || 0;
    const limit = APP_SETTINGS.adDailyLimit;

    container.innerHTML = adTypes.map(ad => {
        const isLimitReached = watchedToday >= limit;
        return `
            <div class="ad-item">
                <div class="ad-thumb">${ad.emoji}</div>
                <div class="ad-info">
                    <div class="ad-title">${ad.title}</div>
                    <div class="ad-duration">${ad.duration}s • +${APP_SETTINGS.adReward} 💎</div>
                </div>
                <button class="btn-watch" ${isLimitReached ? 'disabled' : ''}
                    onclick="watchAd('${ad.id}')">
                    ${isLimitReached ? 'Limit' : 'Watch'}
                </button>
            </div>
        `;
    }).join('');
}

async function watchAd(adId) {
    const ad = adTypes.find(a => a.id === adId);
    if (!ad) return;

    const watchedToday = userData.adsWatchedToday || 0;
    if (watchedToday >= APP_SETTINGS.adDailyLimit) {
        showToast('Daily ad limit reached!');
        return;
    }

    showAdOverlay(ad);
}

function showAdOverlay(ad) {
    const overlay = document.createElement('div');
    overlay.className = 'ad-overlay';
    overlay.id = 'ad-overlay';
    overlay.innerHTML = `
        <div class="ad-content">
            <div class="ad-timer" id="ad-countdown">${ad.duration}</div>
            <div class="ad-progress-bar">
                <div class="ad-progress-fill" id="ad-progress" style="width: 100%"></div>
            </div>
            <div class="ad-text">Watching: ${ad.title}</div>
            <div class="ad-reward-display">Reward: ${APP_SETTINGS.adReward} 💎</div>
            <button class="ad-skip" id="ad-skip-btn" disabled>Wait ${ad.duration}s...</button>
        </div>
    `;
    document.body.appendChild(overlay);

    let timeLeft = ad.duration;
    const progress = document.getElementById('ad-progress');
    const countdown = document.getElementById('ad-countdown');
    const skipBtn = document.getElementById('ad-skip-btn');

    const timer = setInterval(() => {
        timeLeft--;
        countdown.textContent = timeLeft;
        progress.style.width = `${(timeLeft / ad.duration) * 100}%`;

        if (timeLeft <= 0) {
            clearInterval(timer);
            skipBtn.disabled = false;
            skipBtn.textContent = 'Claim Reward';
            skipBtn.onclick = () => claimAdReward(ad);
        } else {
            skipBtn.textContent = `Wait ${timeLeft}s...`;
        }
    }, 1000);
}

async function claimAdReward(ad) {
    try {
        const today = new Date().toDateString();

        await db.collection('users').doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(APP_SETTINGS.adReward),
            totalEarned: firebase.firestore.FieldValue.increment(APP_SETTINGS.adReward),
            adsWatchedToday: firebase.firestore.FieldValue.increment(1),
            adsLastDate: today,
            lastActive: Date.now()
        });

        userData.balance = (userData.balance || 0) + APP_SETTINGS.adReward;
        userData.adsWatchedToday = (userData.adsWatchedToday || 0) + 1;

        closeAd();
        showToast(`+${APP_SETTINGS.adReward} 💎 Ad watched!`);
        updateUI();
        loadAds();

    } catch (error) {
        showToast('Error. Try again.');
        console.error(error);
    }
}

function closeAd() {
    const overlay = document.getElementById('ad-overlay');
    if (overlay) overlay.remove();
}

// ======================== REFERRALS ========================
async function loadReferrals() {
    // t.me/botname?start=refXXXXX format
    const referralLink = `https://t.me/${BOT_NAME}?start=ref${currentUser.uid}`;
    document.getElementById('referral-link').value = referralLink;

    document.getElementById('total-referred').textContent = userData.totalReferrals || 0;
    document.getElementById('ref-earnings').textContent = formatNumber(userData.referralEarnings || 0);

    try {
        const snapshot = await db.collection('referrals')
            .where('referrerId', '==', currentUser.uid)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        const container = document.getElementById('referral-list');
        if (snapshot.empty) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">No referrals yet. Share your link!</p>';
            return;
        }

        container.innerHTML = snapshot.docs.map(doc => {
            const ref = doc.data();
            const name = ref.referredName || 'User';
            const initial = name.charAt(0).toUpperCase();
            const date = ref.createdAt ? new Date(ref.createdAt).toLocaleDateString() : '';
            return `
                <div class="referral-item">
                    <div class="ref-user-avatar">${initial}</div>
                    <div class="ref-user-info">
                        <div class="ref-user-name">${name}</div>
                        <div class="ref-joined">Joined ${date}</div>
                    </div>
                    <div class="ref-earned">+${ref.reward || 0} 💎</div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error(error);
    }
}

function copyReferral() {
    const input = document.getElementById('referral-link');
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value).then(() => {
        showToast('Link copied! 📋');
    }).catch(() => {
        document.execCommand('copy');
        showToast('Link copied! 📋');
    });
}

// ======================== LEADERBOARD ========================
async function showLeaderboard() {
    try {
        const snapshot = await db.collection('users')
            .orderBy('totalEarned', 'desc')
            .limit(20)
            .get();

        let html = '<ol class="leaderboard-list">';
        snapshot.docs.forEach((doc, i) => {
            const user = doc.data();
            const rank = i + 1;
            const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
            html += `
                <li class="lb-item">
                    <span class="lb-rank ${rankClass}">${medal || rank}</span>
                    <div class="lb-avatar">${(user.firstName || 'U').charAt(0)}</div>
                    <span class="lb-name">${user.firstName || 'User'}</span>
                    <span class="lb-score">${formatNumber(user.totalEarned || 0)} 💎</span>
                </li>
            `;
        });
        html += '</ol>';

        showModal('🏆 Leaderboard', html);
    } catch (error) {
        showToast('Could not load leaderboard');
    }
}

// ======================== SUPPORT ========================
function showSupport() {
    showModal('💬 Support', `
        <div style="text-align:center; padding: 10px 0;">
            <p style="color:var(--text-secondary); font-size:14px; margin-bottom:20px; line-height:1.6;">
                Need help? Contact us through Telegram.
            </p>
            <a href="https://t.me/yoursupport" target="_blank" style="
                display:inline-block; padding:14px 30px; border:none; border-radius:12px;
                background:#2AABEE; color:white; font-size:15px; font-weight:700;
                text-decoration:none; cursor:pointer;
            ">Open Support Chat</a>
        </div>
    `);
}

// ======================== ABOUT ========================
function showAbout() {
    showModal('ℹ️ About', `
        <div style="text-align:center; padding: 10px 0;">
            <div style="font-size:48px; margin-bottom:16px;">💎</div>
            <h4 style="margin-bottom:8px;">Mini App v1.0</h4>
            <p style="color:var(--text-secondary); font-size:13px; line-height:1.6; margin-bottom:12px;">
                Earn rewards by completing tasks, watching ads, and referring friends.
            </p>
            <p style="color:var(--text-muted); font-size:12px;">
                Built with Firebase & Telegram WebApp
            </p>
        </div>
    `);
}

// ======================== MODALS ========================
function showModal(title, bodyHTML) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

// ======================== TOAST ========================
function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-text').textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ======================== LOGOUT ========================
function logout() {
    currentUser = null;
    userData = null;
    showScreen('auth');
}

// ======================== UTILITIES ========================
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
}
