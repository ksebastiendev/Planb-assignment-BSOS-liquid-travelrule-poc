window.addEventListener('load', () => {
  setTimeout(() => {
    const info = document.querySelector('.information-container');
    if (!info) return;
    const btn = document.createElement('a');
    btn.href = '/';
    btn.textContent = '← Dashboard';
    btn.style.cssText = `
      display: inline-block;
      margin-bottom: 20px;
      padding: 8px 16px;
      border: 1px solid #8B9BB4;
      border-radius: 6px;
      color: #8B9BB4;
      font-size: 13px;
      font-family: Inter, sans-serif;
      text-decoration: none;
      transition: all 0.2s;
    `;
    btn.addEventListener('mouseover', () => {
      btn.style.color = '#ffffff';
      btn.style.borderColor = '#ffffff';
    });
    btn.addEventListener('mouseout', () => {
      btn.style.color = '#8B9BB4';
      btn.style.borderColor = '#8B9BB4';
    });
    info.insertBefore(btn, info.firstChild);
  }, 500);
});
