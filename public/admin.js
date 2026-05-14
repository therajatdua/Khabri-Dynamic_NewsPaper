let activeCharts = [];

document.addEventListener('DOMContentLoaded', () => {
    /* 1. Theme Configuration integration (same as main app) */
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('khabri_theme');

    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeToggle.textContent = 'Light';
    } else if (savedTheme === 'light') {
        document.documentElement.removeAttribute('data-theme');
        themeToggle.textContent = 'Dark';
    } else if (prefersDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeToggle.textContent = 'Light';
    }

    themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('khabri_theme', 'light');
            themeToggle.textContent = 'Dark';
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('khabri_theme', 'dark');
            themeToggle.textContent = 'Light';
        }
        // Force chart redraw to adapt colors
        if(document.getElementById('dashboardView').style.display === 'block') {
           const creds = sessionStorage.getItem('khabri_secure_admin');
           if(creds) fetchServerData(creds);
        }
    });

    /* 2. Admin Logic */
    const authView = document.getElementById('authView');
    const dashboardView = document.getElementById('dashboardView');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const logoutBtn = document.getElementById('logoutBtn');
    const demoBanner = document.getElementById('demoBanner');

    const cachedToken = sessionStorage.getItem('khabri_secure_admin');
    if (cachedToken) {
        fetchServerData(cachedToken);
    }

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('adminId').value.trim();
        const pw = document.getElementById('adminPassword').value.trim();
        const token = btoa(`${id}:${pw}`);
        
        const btn = loginForm.querySelector('button');
        btn.textContent = 'Authenticating...';
        btn.disabled = true;
        
        fetchServerData(token);
    });

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('khabri_secure_admin');
        dashboardView.style.display = 'none';
        logoutBtn.style.display = 'none';
        authView.style.display = 'flex';
        loginForm.reset();
        loginForm.querySelector('button').textContent = 'Authenticate';
        loginForm.querySelector('button').disabled = false;
        activeCharts.forEach(c => c.destroy());
        activeCharts = [];
    });

    function fetchServerData(token) {
        fetch('/api/admin', {
            headers: { 'Authorization': `Mock ${token}` }
        })
        .then(async (res) => {
            if (res.status === 401) throw new Error('Unauthorized');
            if (!res.ok) throw new Error('API_FAIL');
            return res.json();
        })
        .then(data => {
            sessionStorage.setItem('khabri_secure_admin', token);
            loginError.style.display = 'none';
            authView.style.display = 'none';
            dashboardView.style.display = 'block';
            logoutBtn.style.display = 'inline-block';
            
            if(data.isMock) demoBanner.style.display = 'block';
            else demoBanner.style.display = 'none';

            paintDashboard(data);
        })
        .catch(err => {
            console.error(err);
            sessionStorage.removeItem('khabri_secure_admin');
            const btn = loginForm.querySelector('button');
            if(btn) {
               btn.textContent = 'Authenticate';
               btn.disabled = false;
            }
            if (err.message === 'Unauthorized') {
                loginError.style.display = 'block';
                loginError.textContent = 'Invalid credentials. Access Denied.';
            } else {
                loginError.style.display = 'block';
                loginError.textContent = 'Could not connect to the remote analytics server.';
            }
        });
    }

    function paintDashboard(data) {
        activeCharts.forEach(c => c.destroy());
        activeCharts = [];

        // Apply theme-based chart styling
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#f3f4f6' : '#111827';
        const gridColor = isDark ? '#2a2f3a' : '#e5e7eb';
        Chart.defaults.color = textColor;

        // Animate count up logic for metric cards
        animateValue(document.getElementById('statArticles'), 0, data.totalArticles || 0, 1000);
        animateValue(document.getElementById('statUsers'), 0, data.uniqueUsers || 0, 1000);
        animateValue(document.getElementById('statInteractions'), 0, data.totalLikes || 0, 1000);

        // Bar Chart
        const barCtx = document.getElementById('barChart').getContext('2d');
        const bChart = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: data.dates.labels,
                datasets: [{
                    label: 'Articles Extracted',
                    data: data.dates.values,
                    backgroundColor: '#3b82f6',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { grid: { color: gridColor }, beginAtZero: true }
                }
            }
        });
        activeCharts.push(bChart);

        // Doughnut Chart
        const pieCtx = document.getElementById('pieChart').getContext('2d');
        const pChart = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: data.sources.labels,
                datasets: [{
                    data: data.sources.values,
                    backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'],
                    borderWidth: 2,
                    borderColor: isDark ? '#14171c' : '#ffffff' 
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: { legend: { position: 'right' } }
            }
        });
        activeCharts.push(pChart);
    }

    // Number animation helper for premium feel
    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString();
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }
});