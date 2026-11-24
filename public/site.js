// Единая логика кнопки входа/личного кабинета в шапке сайта.
// Подключается на всех страницах, где нет собственного updateHeaderButton.
(function () {
  const USER_STORAGE_KEY = 'user';

  function getUserData() {
    const userData = localStorage.getItem(USER_STORAGE_KEY);
    if (userData) {
      try {
        return JSON.parse(userData);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function updateHeaderButton() {
    const authLink = document.getElementById('authLink');
    const authBtn = document.getElementById('authBtn');
    if (!authLink || !authBtn) return;

    const user = getUserData();

    if (user) {
      authLink.href = 'cabinet.html';
      authBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      `;
      authBtn.style.borderColor = 'var(--primary)';
    } else {
      authLink.href = 'login.html';
      authBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
      `;
      authBtn.style.borderColor = 'rgba(255,255,255,0.4)';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateHeaderButton);
  } else {
    updateHeaderButton();
  }
})();
