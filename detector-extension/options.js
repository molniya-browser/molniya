const box = document.getElementById('enabled');
browser.storage.local.get('enabled').then(({ enabled = true }) => { box.checked = enabled; });
box.addEventListener('change', () => browser.storage.local.set({ enabled: box.checked }));
