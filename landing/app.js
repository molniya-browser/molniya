export function detectPlatform(userAgent) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'unknown';
  if (/Windows/.test(userAgent)) return 'win';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac';
  if (/Linux|X11/.test(userAgent)) return 'linux';
  return 'unknown';
}

if (typeof document !== 'undefined') {
  const platform = detectPlatform(navigator.userAgent);
  const names = { win: 'Windows', mac: 'macOS', linux: 'Linux' };
  const button = document.getElementById(`btn-${platform}`);
  const container = document.getElementById('dl');
  const hint = document.getElementById('dl-hint');

  if (button && container && hint) {
    button.classList.add('primary');
    container.prepend(button);
    hint.textContent = `Похоже, у вас ${names[platform]} - нужная кнопка подсвечена`;
  } else if (hint) {
    hint.textContent = 'Выберите свою систему - все сборки доступны на GitHub';
  }

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const videos = document.querySelectorAll('.media-slot video');
  const syncVideoPlayback = () => {
    for (const video of videos) {
      if (motionPreference.matches) {
        video.pause();
      } else {
        video.play().catch(() => {});
      }
    }
  };

  syncVideoPlayback();
  motionPreference.addEventListener('change', syncVideoPlayback);
}
