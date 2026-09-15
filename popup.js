const toggle = document.getElementById('enabledToggle');

chrome.storage.local.get({ enabled: true }, (settings) => {
  toggle.checked = settings.enabled;
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
});
