    let activeCharts = [];
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

    document.addEventListener('DOMContentLoaded', () => {
      /* Theme Configuration */
      const themeToggle = document.getElementById('themeToggle');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const savedTheme = localStorage.getItem('khabri_theme');

      if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (themeToggle) themeToggle.textContent = 'Light';
      } else if (savedTheme === 'light') {
        document.documentElement.removeAttribute('data-theme');
        if (themeToggle) themeToggle.textContent = 'Dark';
      } else if (prefersDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (themeToggle) themeToggle.textContent = 'Light';
      }

      /* Analytics Logic */
      const codeAccessView = document.getElementById('codeAccessView');
      const dashboardView = document.getElementById('dashboardView');
      const codeForm = document.getElementById('codeForm');
      const codeError = document.getElementById('codeError');
      const exitBtn = document.getElementById('exitBtn');
      const accessCodeInput = document.getElementById('accessCode');

      const TOKEN_KEY = 'khabri_analytics_token';
      const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
      const saveToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

      const saved = readToken();
      if (saved) fetchAnalytics(saved);

      codeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const token = accessCodeInput.value.trim();
        if (token) fetchAnalytics(token);
      });

      exitBtn.addEventListener('click', () => {
        saveToken('');
        location.reload();
      });

      function fetchAnalytics(token) {
        codeError.style.display = 'none';
        fetch('/api/analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({})
        })
        .then(async (res) => {
          if (res.status === 401) throw new Error('unauthorized');
          if (res.status === 503) throw new Error('unconfigured');
          if (!res.ok) throw new Error('API error');
          return res.json();
        })
        .then(data => {
          saveToken(token);
          codeAccessView.style.display = 'none';
          dashboardView.style.display = 'block';
          paintDashboard(data);
        })
        .catch(err => {
          saveToken('');
          codeError.textContent = err.message === 'unauthorized'
            ? 'Invalid token.'
            : err.message === 'unconfigured'
              ? 'Analytics is not configured on the server (set ANALYTICS_TOKEN).'
              : 'Failed to load analytics. Please try again.';
          codeError.style.display = 'block';
        });
      }

      function paintDashboard(data) {
        /* Update Key Metrics */
        document.getElementById('totalUsers').textContent = (data.totalUsers || 0).toLocaleString();
        document.getElementById('totalVisits').textContent = (data.totalVisits || 0).toLocaleString();
        document.getElementById('articlesViewed').textContent = (data.articlesViewed || 0).toLocaleString();
        document.getElementById('aiUsage').textContent = (data.aiUsage || 0).toLocaleString();

        /* Destroy old charts */
        activeCharts.forEach(c => c.destroy());
        activeCharts = [];

        const chartOptions = {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-secondary)' } } },
          scales: {
            y: { beginAtZero: true, grid: { color: 'var(--border)' }, ticks: { color: 'var(--text-secondary)' } },
            x: { grid: { display: false }, ticks: { color: 'var(--text-secondary)' } }
          }
        };

        /* Device Chart */
        if (data.devices && data.devices.labels.length > 0) {
          const ctx = document.getElementById('deviceChart').getContext('2d');
          const chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: data.devices.labels,
              datasets: [{
                data: data.devices.values,
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
              }]
            },
            options: { ...chartOptions, plugins: { ...chartOptions.plugins, legend: { position: 'bottom' } } }
          });
          activeCharts.push(chart);
        }

        /* Locations Chart */
        if (data.locations && data.locations.labels.length > 0) {
          const ctx = document.getElementById('locationsChart').getContext('2d');
          const chart = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: data.locations.labels.slice(0, 5),
              datasets: [{
                label: 'Users',
                data: data.locations.values.slice(0, 5),
                backgroundColor: '#3b82f6',
                borderRadius: 4
              }]
            },
            options: chartOptions
          });
          activeCharts.push(chart);
        }

        /* Gender Chart */
        if (data.gender && data.gender.labels.length > 0) {
          const ctx = document.getElementById('genderChart').getContext('2d');
          const chart = new Chart(ctx, {
            type: 'pie',
            data: {
              labels: data.gender.labels,
              datasets: [{
                data: data.gender.values,
                backgroundColor: ['#ec4899', '#3b82f6', '#6b7280']
              }]
            },
            options: { ...chartOptions, plugins: { ...chartOptions.plugins, legend: { position: 'bottom' } } }
          });
          activeCharts.push(chart);
        }

        /* Age Chart */
        if (data.ageGroups && data.ageGroups.labels.length > 0) {
          const ctx = document.getElementById('ageChart').getContext('2d');
          const chart = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: data.ageGroups.labels,
              datasets: [{
                label: 'Users',
                data: data.ageGroups.values,
                backgroundColor: '#10b981',
                borderRadius: 4
              }]
            },
            options: chartOptions
          });
          activeCharts.push(chart);
        }

        /* AI Features Chart */
        if (data.aiFeatures && data.aiFeatures.labels.length > 0) {
          const ctx = document.getElementById('aiChart').getContext('2d');
          const chart = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: data.aiFeatures.labels,
              datasets: [{
                label: 'Usage Count',
                data: data.aiFeatures.values,
                backgroundColor: '#f59e0b',
                borderRadius: 4
              }]
            },
            options: chartOptions
          });
          activeCharts.push(chart);
        }

        /* Visits Trend */
        if (data.visitsOverTime && data.visitsOverTime.labels.length > 0) {
          const ctx = document.getElementById('visitsChart').getContext('2d');
          const chart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: data.visitsOverTime.labels,
              datasets: [{
                label: 'Daily Visits',
                data: data.visitsOverTime.values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#fff'
              }]
            },
            options: chartOptions
          });
          activeCharts.push(chart);
        }

        /* Browser Stats */
        if (data.browsers) {
          let html = '';
          Object.entries(data.browsers).forEach(([browser, count]) => {
            html += `<div class="stat-item"><span class="stat-label">${esc(browser)}</span><span class="stat-value">${esc(count)}</span></div>`;
          });
          document.getElementById('browserStats').innerHTML = html || '<div style="color: var(--text-secondary);">No data</div>';
        }

        /* Engagement Stats */
        if (data.engagement) {
          let html = '';
          Object.entries(data.engagement).forEach(([key, value]) => {
            const label = key.replace(/([A-Z])/g, ' $1').trim();
            html += `<div class="stat-item"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(value)}</span></div>`;
          });
          document.getElementById('engagementStats').innerHTML = html || '<div style="color: var(--text-secondary);">No data</div>';
        }

        /* Content Stats */
        if (data.content) {
          let html = '';
          Object.entries(data.content).forEach(([key, value]) => {
            const label = key.replace(/([A-Z])/g, ' $1').trim();
            html += `<div class="stat-item"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(value)}</span></div>`;
          });
          document.getElementById('contentStats').innerHTML = html || '<div style="color: var(--text-secondary);">No data</div>';
        }

        /* Location Table */
        if (data.locationDetails && data.locationDetails.length > 0) {
          let html = '';
          data.locationDetails.slice(0, 10).forEach(loc => {
            html += `<tr>
              <td>${esc(loc.location)}</td>
              <td>${esc(loc.users)}</td>
              <td>${esc(loc.visits)}</td>
              <td>${esc(loc.avgDuration)}s</td>
            </tr>`;
          });
          document.getElementById('locationTableBody').innerHTML = html;
        }

        /* Articles Table */
        if (data.topArticles && data.topArticles.length > 0) {
          let html = '';
          data.topArticles.slice(0, 10).forEach(article => {
            html += `<tr>
              <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${esc(article.title)}</td>
              <td>${esc(article.views)}</td>
              <td>${esc(article.likes)}</td>
              <td>${esc(article.shares)}</td>
            </tr>`;
          });
          document.getElementById('articlesTableBody').innerHTML = html;
        }
      }
    });
