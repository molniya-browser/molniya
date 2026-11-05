// Подсветка вероятной ОС пользователя в кнопках скачивания
(function () {
  var ua = navigator.userAgent;
  var os = /Windows/.test(ua) ? 'win' : /Mac/.test(ua) && !/iPhone|iPad/.test(ua) ? 'mac' : 'Linux'.test ? 'linux' : 'linux';
  var btn = document.getElementById('btn-' + os);
  var box = document.getElementById('dl');
  if (btn && box) {
    btn.classList.add('primary');
    box.removeChild(btn);
    box.insertBefore(btn, box.firstChild);
  }
  var names = { win: 'Windows', mac: 'macOS', linux: 'Linux' };
  var hint = document.getElementById('dl-hint');
  if (hint) hint.textContent = 'Похоже, у вас ' + names[os] + ' — нужная кнопка подсвечена';
})();
