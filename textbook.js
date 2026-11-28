(function () {
  'use strict';

  var STORAGE_READ = 'pep-words-progress-v1';
  var STORAGE_MEMORIZED = 'pep-words-memorized-v1';
  var STORAGE_BOOK = 'pep-words-book';
  var KIND_LABEL = { 0: '重点词', 1: '一般词汇', 2: '短语', 3: '专有名词' };
  var ACCENT_LABEL = { uk: '英式', us: '美式' };

  var els = {
    books: document.getElementById('tbBooks'),
    title: document.getElementById('tbTitle'),
    meta: document.getElementById('tbMeta'),
    toc: document.getElementById('tbToc'),
    sheets: document.getElementById('tbSheets'),
    toast: document.getElementById('toast'),
    searchInput: document.getElementById('tbSearchInput'),
    searchClear: document.getElementById('tbSearchClear'),
    filters: document.querySelectorAll('.filter-chip'),
    unreadOnly: document.getElementById('tbUnreadOnly'),
    reset: document.getElementById('tbReset'),
    result: document.getElementById('tbResult'),
    readCount: document.getElementById('tbReadCount'),
    readTotal: document.getElementById('tbReadTotal'),
    memoCount: document.getElementById('tbMemoCount'),
    memoTotal: document.getElementById('tbMemoTotal'),
    dialog: document.getElementById('wordDialog'),
    dialogShell: document.getElementById('dialogShell'),
    dialogContext: document.getElementById('dialogContext'),
    dialogClose: document.getElementById('dialogClose'),
    dialogBody: document.querySelector('.dialog-body'),
    dialogKind: document.getElementById('dialogKind'),
    dialogWord: document.getElementById('dialogWord'),
    dialogIpa: document.getElementById('dialogIpa'),
    audioStatus: document.getElementById('audioStatus'),
    dialogSenses: document.getElementById('dialogSenses'),
    exampleSection: document.getElementById('exampleSection'),
    exampleLabel: document.getElementById('exampleLabel'),
    exampleSource: document.getElementById('exampleSource'),
    exampleEn: document.getElementById('exampleEn'),
    exampleZh: document.getElementById('exampleZh'),
    tipSection: document.getElementById('tipSection'),
    dialogTip: document.getElementById('dialogTip'),
    prevWord: document.getElementById('prevWord'),
    nextWord: document.getElementById('nextWord'),
    dialogPosition: document.getElementById('dialogPosition'),
    dialogMemorize: document.getElementById('dialogMemorize')
  };

  var ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg>';
  var ICON_BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M6 4h12v16l-6-3.8L6 20z"></path></svg>';

  var data = window.PEP_WORDS;
  var state = { bookId: null, query: '', filter: 'all', unreadOnly: false, sections: [], items: [] };
  var readSets = new Map();
  var readSource = {};
  var memorizedSets = new Map();
  var memorizedSource = {};
  var toastTimer = 0;
  var searchTimer = 0;
  var resetTimer = 0;

  var dialogIndex = -1;
  var dialogCurrent = null;
  var lastTrigger = null;
  var dialogAudio = null;
  var dialogAccent = null;
  var dialogToken = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function currentBook() {
    if (!data || !Array.isArray(data.books)) return null;
    return data.books.find(function (book) { return book.id === state.bookId; }) || null;
  }

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* 本地存储不可用时，本次会话仍然可读可点。 */
    }
  }

  function readStore(key) {
    var raw = safeStorageGet(key);
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function serializeSets(store) {
    var output = {};
    store.forEach(function (set, bookId) {
      if (set.size) output[bookId] = Array.from(set);
    });
    return JSON.stringify(output);
  }

  function getReadSet(bookId) {
    if (!readSets.has(bookId)) {
      var saved = readSource[bookId];
      readSets.set(bookId, new Set(Array.isArray(saved) ? saved : []));
    }
    return readSets.get(bookId);
  }

  function getMemorizedSet(bookId) {
    if (!memorizedSets.has(bookId)) {
      var saved = memorizedSource[bookId];
      memorizedSets.set(bookId, new Set(Array.isArray(saved) ? saved : []));
    }
    return memorizedSets.get(bookId);
  }

  function saveRead() {
    safeStorageSet(STORAGE_READ, serializeSets(readSets));
  }

  function saveMemorized() {
    safeStorageSet(STORAGE_MEMORIZED, serializeSets(memorizedSets));
  }

  function prepareBooks() {
    data.books.forEach(function (book) {
      var index = 0;
      book.units.forEach(function (unit) {
        unit._items = unit.words.map(function (word) {
          word._bookIndex = index;
          index += 1;
          return { word: word, unit: unit };
        });
      });
      book.total = index;
    });
  }

  function unitKey(book, unit) {
    return 'sheet-' + book.id + '-' + unit.no;
  }

  function isKeyWord(word) {
    return word.kind === 0 || word.kind === 2;
  }

  function meaningGroups(word) {
    var groups = [];
    var byPos = {};
    word.senses.forEach(function (sense) {
      var pos = sense.pos || '';
      if (!byPos[pos]) {
        byPos[pos] = { pos: pos, zh: [] };
        groups.push(byPos[pos]);
      }
      if (sense.zh) byPos[pos].zh.push(sense.zh);
    });
    return groups.filter(function (group) { return group.zh.length; });
  }

  function plainMeaning(word) {
    return meaningGroups(word).map(function (group) {
      return (group.pos ? group.pos + ' ' : '') + group.zh.join('；');
    }).join('；');
  }

  function meaningHtml(word, query) {
    return meaningGroups(word).map(function (group) {
      var prefix = group.pos
        ? '<span class="gloss-pos">' + escapeHtml(group.pos) + '</span> '
        : '';
      return prefix + highlightEscaped(group.zh.join('；'), query);
    }).join('；');
  }

  function highlightEscaped(text, query) {
    var raw = String(text == null ? '' : text);
    var needle = normalize(query);
    if (!needle) return escapeHtml(raw);
    var at = normalize(raw).indexOf(needle);
    if (at < 0) return escapeHtml(raw);
    return escapeHtml(raw.slice(0, at)) +
      '<mark>' + escapeHtml(raw.slice(at, at + needle.length)) + '</mark>' +
      escapeHtml(raw.slice(at + needle.length));
  }

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countInBook(set, book) {
    var count = 0;
    book.units.forEach(function (unit) {
      unit.words.forEach(function (word) {
        if (set.has(word.id)) count += 1;
      });
    });
    return count;
  }

  function countRead(book) {
    return countInBook(getReadSet(book.id), book);
  }

  function countMemorized(book) {
    return countInBook(getMemorizedSet(book.id), book);
  }

  function wordMatches(word, query) {
    if (!query) return true;
    if (normalize(word.w).indexOf(query) !== -1) return true;
    return word.senses.some(function (sense) {
      return normalize(sense.zh).indexOf(query) !== -1;
    });
  }

  function buildVisible(book) {
    var query = normalize(state.query);
    var read = getReadSet(book.id);
    var memorized = getMemorizedSet(book.id);
    var sections = [];
    var items = [];

    book.units.forEach(function (unit, position) {
      var matched = unit._items.filter(function (item) {
        var word = item.word;
        if (state.filter === 'memorized' && !memorized.has(word.id)) return false;
        if (state.filter === 'unmemorized' && memorized.has(word.id)) return false;
        if (state.unreadOnly && read.has(word.id)) return false;
        return wordMatches(word, query);
      });
      if (!matched.length) return;
      sections.push({ unit: unit, items: matched, position: position });
      items = items.concat(matched);
    });

    state.sections = sections;
    state.items = items;
  }

  function filterLabel() {
    var parts = [];
    if (state.filter === 'memorized') parts.push('已背诵');
    if (state.filter === 'unmemorized') parts.push('未背诵');
    if (state.unreadOnly) parts.push('未读');
    return parts.join(' · ');
  }

  function updateFilterChips() {
    els.filters.forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.dataset.filter === state.filter ? 'true' : 'false');
    });
  }

  function updateStats(book) {
    var read = countRead(book);
    var memorized = countMemorized(book);
    var total = book.total;
    var label = filterLabel();
    var query = state.query.trim();

    els.readCount.textContent = read;
    els.readTotal.textContent = total;
    els.memoCount.textContent = memorized;
    els.memoTotal.textContent = total;
    els.reset.hidden = memorized === 0;
    if (!memorized) cancelReset();

    els.searchClear.hidden = !query;
    updateFilterChips();

    if (query) {
      els.result.textContent = state.items.length
        ? '找到 ' + state.items.length + ' 个词条' +
          (state.sections.length ? '，分布在 ' + state.sections.length + ' 个单元。' : '。')
        : '没有找到“' + query + '”。';
    } else if (label) {
      els.result.textContent = label + ' ' + state.items.length + ' 个词条' +
        (state.sections.length ? '，分布在 ' + state.sections.length + ' 个单元。' : '。');
    } else {
      els.result.textContent = '共 ' + total + ' 个词条，按教材单元顺序排列。';
    }
  }

  function cancelReset() {
    window.clearTimeout(resetTimer);
    resetTimer = 0;
    els.reset.classList.remove('is-armed');
    els.reset.textContent = '重置背诵';
  }

  function resetMemorized() {
    var book = currentBook();
    if (!book) return;
    getMemorizedSet(book.id).clear();
    saveMemorized();
    cancelReset();
    render({ tabs: false });
    showToast('已清空本册背诵标记');
    var allChip = document.querySelector('.filter-chip[data-filter="all"]');
    if (allChip) allChip.focus();
  }

  function armReset() {
    if (!countMemorized(currentBook())) return;
    if (resetTimer) {
      resetMemorized();
      return;
    }
    els.reset.classList.add('is-armed');
    els.reset.textContent = '再点一次确认';
    resetTimer = window.setTimeout(cancelReset, 4000);
  }

  function emptyStateHtml(book) {
    var query = state.query.trim();
    var memorized = countMemorized(book);
    var hasFilter = state.filter !== 'all' || state.unreadOnly;
    var title = '';
    var desc = '';
    var actions = '';

    if (query) {
      title = '没有找到“' + query + '”';
      desc = '试试更短的拼写，或输入中文释义。';
      actions = '<button type="button" data-action="clear-search">清除搜索</button>';
      if (hasFilter) {
        actions += '<button type="button" data-action="clear-all">查看全部词条</button>';
      }
    } else if (state.filter === 'memorized' && !state.unreadOnly) {
      title = '本册还没有已背诵的词';
      desc = '点词条右侧的书签，或在详情页标记，背过的词会集中在这里。';
      actions = '<button type="button" data-action="clear-all">查看全部词条</button>';
    } else if (state.filter === 'unmemorized' && !state.unreadOnly) {
      title = '没有未背诵的词条';
      desc = '本册词条都已标记为背诵。';
      actions = '<button type="button" data-action="clear-all">查看全部词条</button>';
    } else if (state.unreadOnly && state.filter === 'all') {
      title = '本册的词都点读过了';
      desc = '取消「只看未读」可以查看全部词条。';
      actions = '<button type="button" data-action="clear-all">查看全部词条</button>';
    } else if (hasFilter) {
      title = '没有符合条件的词条';
      desc = '当前筛选：' + filterLabel() + '。';
      actions = '<button type="button" data-action="clear-all">清除筛选</button>';
    }

    return '<div class="tb-empty">' +
      '<span class="empty-icon">' + (state.filter === 'memorized' ? ICON_BOOKMARK : ICON_SEARCH) + '</span>' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p>' + escapeHtml(desc) + '</p>' +
      (actions ? '<div class="empty-actions">' + actions + '</div>' : '') +
      '</div>';
  }

  function renderTabs(book) {
    var fragment = document.createDocumentFragment();
    data.books.forEach(function (item) {
      var active = item.id === book.id;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tb-book';
      button.id = 'tb-book-' + item.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('aria-controls', 'tbSheets');
      button.tabIndex = active ? 0 : -1;
      button.dataset.book = item.id;
      button.textContent = item.short || item.label;
      fragment.appendChild(button);
    });
    els.books.replaceChildren(fragment);
  }

  function renderToc(book, sections) {
    if (!sections.length) {
      els.toc.replaceChildren();
      els.toc.hidden = true;
      return;
    }

    els.toc.hidden = false;
    var fragment = document.createDocumentFragment();
    sections.forEach(function (section) {
      var unit = section.unit;
      var link = document.createElement('a');
      link.href = '#' + unitKey(book, unit);
      link.dataset.target = unitKey(book, unit);
      var number = document.createElement('span');
      number.className = 'n';
      number.textContent = pad2(unit.no);
      link.appendChild(number);
      link.appendChild(document.createTextNode(unit.name));
      fragment.appendChild(link);
    });
    els.toc.replaceChildren(fragment);
  }

  function renderSheets(book, sections) {
    var memorized = getMemorizedSet(book.id);
    var html = '';

    if (!sections.length) {
      els.sheets.innerHTML = emptyStateHtml(book);
      return;
    }

    var flatIndex = 0;
    sections.forEach(function (section) {
      var unit = section.unit;
      var key = unitKey(book, unit);
      var shown = section.items.length;
      var total = unit.words.length;
      html += '<article class="tb-sheet" id="' + key + '" aria-labelledby="' + key + '-title">';
      html += '<header class="tb-sheet-head">';
      html += '<span class="tb-unit-no">' + pad2(unit.no) + '</span>';
      html += '<div class="tb-unit-title">';
      html += '<p>Words and Expressions</p>';
      html += '<h2 id="' + key + '-title">' + escapeHtml(unit.name) + '</h2>';
      html += '</div>';
      html += '<span class="tb-sheet-count">' +
        (shown === total ? total + ' 个词条' : shown + ' / ' + total + ' 个词条') + '</span>';
      html += '</header>';
      html += '<div class="tb-gloss">';

      section.items.forEach(function (item) {
        var word = item.word;
        var meaning = plainMeaning(word);
        var ipa = word.ipa ? word.ipa.trim() : '';
        var label = word.w + (ipa ? '，' + ipa : '') + (meaning ? '，' + meaning : '') +
          (memorized.has(word.id) ? '，已背诵' : '');
        var classes = 'gloss-entry' + (memorized.has(word.id) ? ' is-memorized' : '');

        html += '<button class="' + classes + '" type="button" data-index="' + flatIndex +
          '" data-word-id="' + escapeHtml(word.id) + '" aria-label="' + escapeHtml(label) + '">';
        html += '<span class="gloss-word' + (isKeyWord(word) ? ' is-key' : '') + '">' +
          highlightEscaped(word.w, state.query) + '</span>';
        html += '<span class="gloss-ipa' + (ipa ? '' : ' is-empty') + '" aria-hidden="true">' +
          escapeHtml(ipa || '音标') + '</span>';
        html += '<span class="gloss-def">' + meaningHtml(word, state.query) + '</span>';
        html += '<span class="gloss-flag" aria-hidden="true">' +
          '<svg viewBox="0 0 20 20"><path d="M5 3.5h10v13l-5-3.2-5 3.2z"></path></svg></span>';
        html += '</button>';
        flatIndex += 1;
      });

      html += '</div>';
      html += '<footer class="tb-sheet-foot">';
      html += '<span>人教版初中英语 · ' + escapeHtml(book.label) + '</span>';
      html += '<span>词表页 ' + pad2(section.position + 1) + ' / ' + pad2(book.units.length) + '</span>';
      html += '</footer>';
      html += '</article>';
    });

    els.sheets.innerHTML = html;
  }

  function render(options) {
    var opts = options || {};
    var book = currentBook();
    if (!book) return;

    buildVisible(book);
    if (opts.tabs !== false) renderTabs(book);
    renderToc(book, state.sections);
    renderSheets(book, state.sections);

    els.sheets.setAttribute('role', 'tabpanel');
    els.sheets.setAttribute('aria-labelledby', 'tb-book-' + book.id);
    els.title.textContent = book.label;
    els.meta.textContent = book.units.length + ' 个单元 · ' + book.total + ' 个词条';
    updateStats(book);
  }

  function selectBook(bookId, focusTab) {
    var exists = data.books.some(function (book) { return book.id === bookId; });
    if (!exists) return;
    state.bookId = bookId;
    state.query = '';
    state.filter = 'all';
    state.unreadOnly = false;
    state.sections = [];
    state.items = [];
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    els.unreadOnly.checked = false;
    cancelReset();
    safeStorageSet(STORAGE_BOOK, bookId);
    render();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (focusTab) {
      var tab = els.books.querySelector('.tb-book[data-book="' + bookId + '"]');
      if (tab) tab.focus();
    }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.toast.hidden = true;
    }, 2200);
  }

  function markRead(item) {
    if (!item) return;
    var set = getReadSet(state.bookId);
    if (set.has(item.word.id)) return;
    set.add(item.word.id);
    saveRead();
  }

  function cleanAudioText(value) {
    return String(value || '')
      .replace(/[’‘]/g, "'")
      .replace(/[“”"]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/…/g, ' ')
      .replace(/\s+\/\s+.*$/, '')
      .replace(/[!?.,;:]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function audioUrl(word, accent) {
    var query = cleanAudioText(word);
    if (!query) return '';
    return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(query) +
      '&type=' + (accent === 'us' ? '2' : '1');
  }

  function stopDialogAudio() {
    dialogToken += 1;
    if (dialogAudio) {
      try { dialogAudio.pause(); } catch (error) { /* ignore */ }
      dialogAudio.removeAttribute('src');
      try { dialogAudio.load(); } catch (error) { /* ignore */ }
      dialogAudio = null;
    }
    dialogAccent = null;
    els.dialog.querySelectorAll('.audio-button').forEach(function (button) {
      button.removeAttribute('data-state');
    });
  }

  function resetAudioStatus() {
    els.audioStatus.classList.remove('error');
    els.audioStatus.replaceChildren();
  }

  function speakText(text, accent) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
    var spoken = cleanAudioText(text);
    if (!spoken) return false;

    try {
      window.speechSynthesis.cancel();
      var utterance = new SpeechSynthesisUtterance(spoken);
      utterance.lang = accent === 'us' ? 'en-US' : 'en-GB';
      utterance.rate = 0.88;
      var voices = window.speechSynthesis.getVoices();
      var matching = voices.find(function (voice) {
        return voice.lang && voice.lang.toLowerCase().indexOf(utterance.lang.toLowerCase()) === 0;
      });
      if (matching) utterance.voice = matching;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (error) {
      return false;
    }
  }

  function showAudioError(button, item, accent) {
    dialogAudio = null;
    dialogAccent = null;
    button.dataset.state = 'error';
    els.audioStatus.classList.add('error');
    els.audioStatus.textContent = '发音加载失败，请检查网络。';
    if ('speechSynthesis' in window) {
      var fallback = document.createElement('button');
      fallback.type = 'button';
      fallback.textContent = '用系统朗读';
      fallback.addEventListener('click', function () {
        if (speakText(item.word.w, accent)) {
          els.audioStatus.classList.remove('error');
          els.audioStatus.textContent = '已改用系统朗读。';
        }
      });
      els.audioStatus.appendChild(fallback);
    } else {
      els.audioStatus.textContent += '当前浏览器也不支持系统朗读。';
    }
  }

  function playDialogAudio(accent) {
    if (!dialogCurrent) return;
    var button = els.dialog.querySelector('.audio-button[data-accent="' + accent + '"]');
    if (!button) return;

    if (dialogAudio && dialogAccent === accent && !dialogAudio.paused) {
      stopDialogAudio();
      resetAudioStatus();
      return;
    }

    stopDialogAudio();
    var token = dialogToken;
    var failed = false;
    var item = dialogCurrent;
    dialogAccent = accent;
    button.dataset.state = 'loading';
    els.audioStatus.classList.remove('error');
    els.audioStatus.textContent = '正在加载' + ACCENT_LABEL[accent] + '发音…';

    var audio = new Audio();
    audio.preload = 'auto';
    dialogAudio = audio;

    function beginPlaying() {
      if (token !== dialogToken) return;
      button.dataset.state = 'playing';
      els.audioStatus.textContent = '正在播放' + ACCENT_LABEL[accent] + '发音。';
    }

    function fail() {
      if (failed || token !== dialogToken) return;
      failed = true;
      showAudioError(button, item, accent);
    }

    audio.addEventListener('playing', beginPlaying, { once: true });
    audio.addEventListener('ended', function () {
      if (token !== dialogToken) return;
      button.removeAttribute('data-state');
      dialogAudio = null;
      dialogAccent = null;
      resetAudioStatus();
    }, { once: true });
    audio.addEventListener('error', fail, { once: true });

    audio.src = audioUrl(item.word.w, accent);
    var attempt = audio.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(function () {
        if (token === dialogToken && button.dataset.state === 'loading') beginPlaying();
      }).catch(fail);
    }
  }

  function renderSenses(word) {
    var fragment = document.createDocumentFragment();
    word.senses.forEach(function (sense) {
      var row = document.createElement('div');
      row.className = 'sense' + (sense.pos ? '' : ' no-pos');
      if (sense.pos) {
        var pos = document.createElement('span');
        pos.className = 'pos';
        pos.textContent = sense.pos;
        row.appendChild(pos);
      }
      var text = document.createElement('p');
      text.textContent = sense.zh;
      row.appendChild(text);
      fragment.appendChild(row);
    });
    els.dialogSenses.replaceChildren(fragment);
  }

  function syncMemorizeButton(word, memorized) {
    els.dialogMemorize.setAttribute('aria-pressed', memorized ? 'true' : 'false');
    els.dialogMemorize.querySelector('.memorize-label').textContent = memorized ? '已背诵' : '标记已背诵';
  }

  function fillDialog(item) {
    if (!item) return;
    var word = item.word;
    var book = currentBook();
    stopDialogAudio();
    resetAudioStatus();
    dialogCurrent = item;

    els.dialogContext.textContent = book.label + ' · ' + item.unit.name + ' · 第 ' + (word._bookIndex + 1) + ' 词';
    els.dialogKind.textContent = KIND_LABEL[word.kind] || '';
    els.dialogWord.textContent = word.w;
    var hasIpa = Boolean(word.ipa && word.ipa.trim());
    els.dialogIpa.textContent = hasIpa ? '英式音标 ' + word.ipa.trim() : '音标暂缺';
    els.dialogIpa.classList.toggle('is-empty', !hasIpa);
    renderSenses(word);

    if (word.ex && word.ex.en) {
      els.exampleSection.hidden = false;
      var fromBook = word.ex.src === '课本';
      els.exampleLabel.textContent = fromBook ? '课本例句' : '例句';
      els.exampleSource.textContent = fromBook ? '教材原句' : (word.ex.src || '词表配套例句');
      els.exampleEn.textContent = word.ex.en;
      els.exampleZh.textContent = word.ex.zh || '';
      els.exampleZh.hidden = !word.ex.zh;
    } else {
      els.exampleSection.hidden = true;
    }

    if (word.tip) {
      els.tipSection.hidden = false;
      els.dialogTip.textContent = word.tip;
    } else {
      els.tipSection.hidden = true;
      els.dialogTip.textContent = '';
    }

    els.dialogPosition.textContent = (dialogIndex + 1) + ' / ' + state.items.length;
    els.prevWord.disabled = dialogIndex <= 0;
    els.nextWord.disabled = dialogIndex >= state.items.length - 1;
    syncMemorizeButton(word, getMemorizedSet(state.bookId).has(word.id));
  }

  function openWordAt(index, trigger) {
    var item = state.items[index];
    if (!item) return;

    if (trigger) lastTrigger = trigger;
    dialogIndex = index;
    markRead(item);
    updateStats(currentBook());
    fillDialog(item);

    if (!els.dialog.open) {
      if (typeof els.dialog.showModal === 'function') {
        els.dialog.showModal();
      } else {
        els.dialog.setAttribute('open', '');
      }
      document.body.classList.add('dialog-open');
      requestAnimationFrame(function () { els.dialogClose.focus(); });
    } else {
      els.dialogBody.scrollTop = 0;
    }
  }

  function stepDialog(delta) {
    if (!els.dialog.open) return;
    var next = dialogIndex + delta;
    if (next < 0 || next >= state.items.length) return;
    dialogIndex = next;
    markRead(state.items[next]);
    updateStats(currentBook());
    fillDialog(state.items[next]);
    els.dialogBody.scrollTop = 0;
  }

  function updateMemorizedEntries(wordId, memorized) {
    var item = state.items.find(function (entry) { return entry.word.id === wordId; });
    var label = '';
    if (item) {
      var word = item.word;
      var ipa = word.ipa ? word.ipa.trim() : '';
      var meaning = plainMeaning(word);
      label = word.w + (ipa ? '，' + ipa : '') + (meaning ? '，' + meaning : '') +
        (memorized ? '，已背诵' : '');
    }
    els.sheets.querySelectorAll('.gloss-entry').forEach(function (entry) {
      if (entry.dataset.wordId !== wordId) return;
      entry.classList.toggle('is-memorized', memorized);
      if (label) entry.setAttribute('aria-label', label);
    });
  }

  function toggleMemorize() {
    if (!dialogCurrent) return;
    var word = dialogCurrent.word;
    var set = getMemorizedSet(state.bookId);
    var nowMemorized = !set.has(word.id);
    if (nowMemorized) set.add(word.id);
    else set.delete(word.id);
    saveMemorized();
    syncMemorizeButton(word, nowMemorized);
    updateMemorizedEntries(word.id, nowMemorized);
    updateStats(currentBook());
    showToast((nowMemorized ? '已标记为背诵：' : '已取消背诵标记：') + word.w);
  }

  function applyFilter(filter) {
    if (filter !== 'all' && filter !== 'unmemorized' && filter !== 'memorized') return;
    if (state.filter === filter) return;
    state.filter = filter;
    render({ tabs: false });
  }

  function clearSearch(focusInput) {
    window.clearTimeout(searchTimer);
    state.query = '';
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    render({ tabs: false });
    if (focusInput) els.searchInput.focus();
  }

  function clearFilters(focusChip) {
    state.filter = 'all';
    state.unreadOnly = false;
    els.unreadOnly.checked = false;
    render({ tabs: false });
    if (focusChip) {
      var allChip = document.querySelector('.filter-chip[data-filter="all"]');
      if (allChip) allChip.focus();
    }
  }

  function handleSheetAction(action) {
    if (action === 'clear-search') {
      clearSearch(true);
      return;
    }
    if (action === 'clear-filter') {
      clearFilters(true);
      return;
    }
    if (action === 'clear-all') {
      window.clearTimeout(searchTimer);
      state.query = '';
      state.filter = 'all';
      state.unreadOnly = false;
      els.searchInput.value = '';
      els.searchClear.hidden = true;
      els.unreadOnly.checked = false;
      render({ tabs: false });
      var first = els.sheets.querySelector('.gloss-entry');
      if (first) first.focus();
      else els.searchInput.focus();
    }
  }

  function onSearchInput() {
    state.query = els.searchInput.value;
    els.searchClear.hidden = !state.query.trim();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      render({ tabs: false });
    }, 70);
  }

  function bindEvents() {
    els.books.addEventListener('click', function (event) {
      var tab = event.target.closest('.tb-book');
      if (!tab) return;
      selectBook(tab.dataset.book, true);
    });

    els.books.addEventListener('keydown', function (event) {
      var tabs = Array.from(els.books.querySelectorAll('.tb-book'));
      var index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      var next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      tabs[next].focus();
      selectBook(tabs[next].dataset.book, true);
    });

    els.searchInput.addEventListener('input', onSearchInput);

    els.searchInput.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (els.searchInput.value) {
        event.preventDefault();
        clearSearch(true);
      } else {
        els.searchInput.blur();
      }
    });

    els.searchClear.addEventListener('click', function () {
      clearSearch(true);
    });

    els.filters.forEach(function (chip) {
      chip.addEventListener('click', function () {
        applyFilter(chip.dataset.filter);
      });
    });

    els.unreadOnly.addEventListener('change', function () {
      state.unreadOnly = els.unreadOnly.checked;
      render({ tabs: false });
    });

    els.reset.addEventListener('click', armReset);

    document.addEventListener('keydown', function (event) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (els.dialog.open) return;
      var target = event.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (target && target.isContentEditable) return;
      event.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
    });

    els.toc.addEventListener('click', function (event) {
      var link = event.target.closest('a[data-target]');
      if (!link) return;
      event.preventDefault();
      var target = document.getElementById(link.dataset.target);
      if (!target) return;
      var barHeight = els.books.closest('.tb-bar').getBoundingClientRect().height;
      var top = target.getBoundingClientRect().top + window.scrollY - barHeight - 16;
      window.scrollTo({ top: top, behavior: 'auto' });
      history.replaceState(null, '', '#' + link.dataset.target);
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });

    els.sheets.addEventListener('click', function (event) {
      var action = event.target.closest('[data-action]');
      if (action) {
        handleSheetAction(action.dataset.action);
        return;
      }
      var entry = event.target.closest('.gloss-entry');
      if (!entry) return;
      openWordAt(Number(entry.dataset.index), entry);
    });

    els.dialogClose.addEventListener('click', function () {
      els.dialog.close();
    });

    els.prevWord.addEventListener('click', function () { stepDialog(-1); });
    els.nextWord.addEventListener('click', function () { stepDialog(1); });

    els.dialogMemorize.addEventListener('click', toggleMemorize);

    els.dialog.querySelectorAll('.audio-button').forEach(function (button) {
      button.addEventListener('click', function () {
        playDialogAudio(button.dataset.accent);
      });
    });

    els.dialog.addEventListener('keydown', function (event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepDialog(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepDialog(1);
      }
    });

    els.dialog.addEventListener('click', function (event) {
      var rect = els.dialog.getBoundingClientRect();
      var outside = event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) els.dialog.close();
    });

    els.dialog.addEventListener('close', function () {
      document.body.classList.remove('dialog-open');
      stopDialogAudio();
      resetAudioStatus();
      dialogCurrent = null;
      dialogIndex = -1;

      if (state.unreadOnly || state.filter !== 'all') render({ tabs: false });

      if (lastTrigger && lastTrigger.isConnected) {
        lastTrigger.focus();
      } else {
        var firstEntry = els.sheets.querySelector('.gloss-entry');
        if (firstEntry) firstEntry.focus();
        else els.sheets.focus();
      }
      lastTrigger = null;
    });
  }

  function init() {
    readSource = readStore(STORAGE_READ);
    memorizedSource = readStore(STORAGE_MEMORIZED);

    if (!data || !Array.isArray(data.books) || !data.books.length) {
      els.sheets.innerHTML = '<div class="tb-empty"><h2>词表没有加载出来</h2>' +
        '<p>请确认 words.js 与本页在同一目录，然后刷新页面。</p></div>';
      return;
    }

    prepareBooks();
    bindEvents();

    var saved = safeStorageGet(STORAGE_BOOK);
    var initial = data.books.find(function (book) { return book.id === saved; }) || data.books[0];
    state.bookId = initial.id;
    render();

    var hash = window.location.hash.replace('#', '');
    if (hash) {
      var target = document.getElementById(hash);
      if (target) target.scrollIntoView();
    }
  }

  init();
})();
