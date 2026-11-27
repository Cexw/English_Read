(function () {
  'use strict';

  var STORAGE_PROGRESS = 'pep-words-progress-v1';
  var STORAGE_BOOK = 'pep-words-book';
  var KIND_LABEL = { 0: '重点词', 1: '一般词汇', 2: '短语', 3: '专有名词' };
  var ACCENT_LABEL = { uk: '英式', us: '美式' };

  var els = {
    bookTabs: document.getElementById('bookTabs'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    searchSummary: document.getElementById('searchSummary'),
    railBook: document.getElementById('railBook'),
    railMeta: document.getElementById('railMeta'),
    unitNav: document.getElementById('unitNav'),
    pageKicker: document.getElementById('pageKicker'),
    pageTitle: document.getElementById('pageTitle'),
    pageDesc: document.getElementById('pageDesc'),
    progressCount: document.getElementById('progressCount'),
    progressTotal: document.getElementById('progressTotal'),
    progressBar: document.getElementById('progressBar'),
    unreadOnly: document.getElementById('unreadOnly'),
    resetProgress: document.getElementById('resetProgress'),
    wordList: document.getElementById('wordList'),
    toast: document.getElementById('toast'),
    dialog: document.getElementById('wordDialog'),
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
    dialogPosition: document.getElementById('dialogPosition')
  };

  var data = window.PEP_WORDS;
  var readSets = new Map();
  var progressStore = {};
  var rowById = new Map();
  var state = {
    bookId: null,
    query: '',
    unreadOnly: false,
    visibleWords: [],
    activeUnitKey: null
  };

  var searchTimer = 0;
  var toastTimer = 0;
  var scrollFrame = 0;
  var resetTimer = 0;
  var resetArmed = false;

  var inlineAudio = null;
  var inlineButton = null;
  var inlineToken = 0;

  var dialogAudio = null;
  var dialogAccent = null;
  var dialogToken = 0;
  var dialogIndex = -1;
  var dialogCurrent = null;
  var lastTrigger = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[’‘]/g, "'");
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function currentBook() {
    return data && data.books
      ? data.books.find(function (book) { return book.id === state.bookId; }) || null
      : null;
  }

  function getReadSet(bookId) {
    if (!readSets.has(bookId)) {
      var saved = progressStore[bookId];
      readSets.set(bookId, new Set(Array.isArray(saved) ? saved : []));
    }
    return readSets.get(bookId);
  }

  function saveProgress() {
    var output = {};
    readSets.forEach(function (set, bookId) {
      if (set.size) output[bookId] = Array.from(set);
    });
    try {
      localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(output));
    } catch (error) {
      /* Progress is still kept in memory when storage is unavailable. */
    }
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
      /* Ignore storage failures. */
    }
  }

  function loadProgress() {
    var raw = safeStorageGet(STORAGE_PROGRESS);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        progressStore = parsed;
      }
    } catch (error) {
      progressStore = {};
    }
  }

  function prepareBooks() {
    data.books.forEach(function (book) {
      var index = 0;
      var total = 0;
      book.units.forEach(function (unit) {
        unit.words.forEach(function (word) {
          word._bookIndex = index;
          index += 1;
          total += 1;
        });
      });
      book.total = total;
    });
  }

  function countRead(book) {
    var set = getReadSet(book.id);
    var count = 0;
    book.units.forEach(function (unit) {
      unit.words.forEach(function (word) {
        if (set.has(word.id)) count += 1;
      });
    });
    return count;
  }

  function unitKey(book, unit, unitPosition) {
    var number = unit.no == null ? unitPosition + 1 : unit.no;
    return 'unit-' + book.id + '-' + number;
  }

  function sensesText(word) {
    return word.senses.map(function (sense) {
      return [sense.pos, sense.zh].filter(Boolean).join(' ');
    }).join('；');
  }

  function highlight(text, query) {
    var raw = String(text == null ? '' : text);
    var needle = String(query || '').trim();
    if (!needle) return escapeHtml(raw);
    var index = raw.toLowerCase().indexOf(needle.toLowerCase());
    if (index < 0) return escapeHtml(raw);
    return escapeHtml(raw.slice(0, index)) +
      '<mark>' + escapeHtml(raw.slice(index, index + needle.length)) + '</mark>' +
      escapeHtml(raw.slice(index + needle.length));
  }

  function tagFor(word) {
    if (word.kind === 0) return '<span class="tag key">重点</span>';
    if (word.kind === 2) return '<span class="tag">短语</span>';
    return '';
  }

  function wordRow(item, visibleIndex, query, readSet) {
    var word = item.word;
    var read = readSet.has(word.id);
    var ipa = word.ipa
      ? '<span class="ipa">' + escapeHtml(word.ipa) + '</span>'
      : '<span class="ipa is-empty" title="该词条暂无音标">—</span>';
    var meaning = sensesText(word);

    return '<div class="word-row' + (read ? ' read' : '') + '" data-word-id="' + escapeHtml(word.id) + '">' +
      '<button class="word-open" type="button" data-index="' + visibleIndex + '" aria-haspopup="dialog" ' +
        'aria-label="查看 ' + escapeHtml(word.w) + ' 的音标、释义和发音">' +
        '<span class="idx">' + pad2(word._bookIndex + 1) + '</span>' +
        '<span class="entry">' +
          '<span class="entry-top"><span class="word">' + highlight(word.w, query) + '</span>' + tagFor(word) + '</span>' +
          ipa +
        '</span>' +
        '<span class="meaning">' + highlight(meaning, query) + '</span>' +
      '</button>' +
      '<button class="row-play" type="button" data-play-index="' + visibleIndex + '" ' +
        'aria-label="播放 ' + escapeHtml(word.w) + ' 的英式发音">' +
        '<svg class="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5l10 6.5-10 6.5z"></path></svg>' +
        '<span class="audio-bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '</button>' +
    '</div>';
  }

  function buildVisible(book) {
    var query = normalize(state.query.trim());
    var readSet = getReadSet(book.id);
    var sections = [];
    var flat = [];

    book.units.forEach(function (unit, unitPosition) {
      var words = [];
      unit.words.forEach(function (word) {
        if (state.unreadOnly && readSet.has(word.id)) return;
        if (query) {
          var haystack = normalize(word.w + ' ' + word.senses.map(function (sense) { return sense.zh; }).join(' '));
          if (haystack.indexOf(query) < 0) return;
        }
        words.push({ word: word, unit: unit, unitPosition: unitPosition });
      });
      if (words.length) {
        var key = unitKey(book, unit, unitPosition);
        sections.push({ unit: unit, words: words, key: key });
        words.forEach(function (item) {
          item.unitKey = key;
          flat.push(item);
        });
      }
    });

    state.visibleWords = flat;
    return sections;
  }

  function renderBookTabs() {
    els.bookTabs.replaceChildren();
    data.books.forEach(function (book) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'book-tab';
      button.id = 'booktab-' + book.id;
      button.dataset.book = book.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'wordList');
      button.setAttribute('aria-selected', 'false');
      button.setAttribute('aria-label', book.label + '，' + book.total + ' 个词条');
      button.tabIndex = -1;
      button.textContent = book.short;
      button.title = book.label;
      els.bookTabs.appendChild(button);
    });
    updateBookTabs();
  }

  function updateBookTabs() {
    var tabs = els.bookTabs.querySelectorAll('.book-tab');
    tabs.forEach(function (tab) {
      var selected = tab.dataset.book === state.bookId;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    if (state.bookId) els.wordList.setAttribute('aria-labelledby', 'booktab-' + state.bookId);
  }

  function renderUnitNav(sections) {
    if (!sections.length) {
      els.unitNav.innerHTML = '';
      return;
    }
    els.unitNav.innerHTML = sections.map(function (section) {
      return '<a class="unit-link" href="#' + escapeHtml(section.key) + '" data-target="' + escapeHtml(section.key) + '" ' +
        'aria-label="跳转到 ' + escapeHtml(section.unit.name) + '，' + section.words.length + ' 个词条">' +
        '<span>' + escapeHtml(section.unit.name) + '</span>' +
        '<span class="count">' + section.words.length + '</span>' +
      '</a>';
    }).join('');
  }

  function emptyStateHtml(book) {
    var query = state.query.trim();
    var searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg>';
    var bookIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h9a2 2 0 012 2v14H8a2 2 0 01-2-2V4z"></path><path d="M6 17a2 2 0 012-2h9"></path></svg>';

    if (query) {
      var actions = '<button type="button" data-action="clear-search">清除搜索</button>' +
        (state.unreadOnly ? '<button type="button" data-action="clear-filter">查看全部词条</button>' : '');
      return '<div class="empty-state">' +
        '<div class="empty-icon">' + searchIcon + '</div>' +
        '<h2>没有找到“' + escapeHtml(query) + '”</h2>' +
        '<p>试试更短的拼写，或者输入中文释义。</p>' +
        '<div class="empty-actions">' + actions + '</div>' +
      '</div>';
    }

    if (state.unreadOnly) {
      return '<div class="empty-state">' +
        '<div class="empty-icon">' + bookIcon + '</div>' +
        '<h2>本册都点读过了</h2>' +
        '<p>共 ' + book.total + ' 个词条。可以重置进度，或关闭“只看未读”查看全部。</p>' +
        '<div class="empty-actions"><button type="button" data-action="clear-filter">查看全部词条</button></div>' +
      '</div>';
    }

    return '<div class="empty-state">' +
      '<div class="empty-icon">' + bookIcon + '</div>' +
      '<h2>这一册还没有词条</h2>' +
      '<p>词表文件可能是空的，请检查 words.js。</p>' +
    '</div>';
  }

  function renderWordList(book, sections) {
    rowById.clear();

    if (!sections.length) {
      els.wordList.innerHTML = emptyStateHtml(book);
      return;
    }

    var query = state.query.trim();
    var readSet = getReadSet(book.id);
    var visibleIndex = 0;

    els.wordList.innerHTML = sections.map(function (section) {
      var readCount = section.unit.words.reduce(function (count, word) {
        return count + (readSet.has(word.id) ? 1 : 0);
      }, 0);
      var rows = section.words.map(function (item) {
        var row = wordRow(item, visibleIndex, query, readSet);
        visibleIndex += 1;
        return row;
      }).join('');

      return '<section class="unit-section" id="' + escapeHtml(section.key) + '" data-unit-key="' + escapeHtml(section.key) + '">' +
        '<div class="unit-head">' +
          '<div class="unit-title">' +
            '<span class="unit-index">' + pad2(section.unit.no == null ? section.unitPosition + 1 : section.unit.no) + '</span>' +
            '<h3>' + escapeHtml(section.unit.name) + '</h3>' +
          '</div>' +
          '<span class="unit-count"><span class="read-num">' + readCount + '</span> / ' + section.unit.words.length + ' 已读</span>' +
        '</div>' +
        '<div class="words">' + rows + '</div>' +
      '</section>';
    }).join('');

    els.wordList.querySelectorAll('.word-row').forEach(function (row) {
      rowById.set(row.dataset.wordId, row);
    });
  }

  function updateProgress(book) {
    var count = countRead(book);
    var total = book.total || 1;
    els.progressCount.textContent = String(count);
    els.progressTotal.textContent = '/ ' + book.total;
    els.progressBar.style.width = Math.min(100, (count / total) * 100) + '%';
    els.resetProgress.hidden = count === 0;
    if (count === 0) cancelReset();
  }

  function updatePageChrome(book) {
    var query = state.query.trim();
    els.railBook.textContent = book.label;
    els.railMeta.textContent = book.units.length + ' 个单元 · ' + book.total + ' 个词条';
    els.pageKicker.textContent = book.label + ' · ' + book.units.length + ' 个单元';

    if (query) {
      els.pageTitle.textContent = '搜索结果';
      els.pageDesc.textContent = '匹配“' + query + '”的词条，按教材单元顺序排列。点击单词查看音标、释义与发音。';
    } else if (state.unreadOnly) {
      var remaining = book.total - countRead(book);
      els.pageTitle.textContent = '未读词条';
      els.pageDesc.textContent = '本册还有 ' + remaining + ' 个词条没有点读，按教材单元顺序排列。';
    } else {
      els.pageTitle.textContent = '全部词表';
      els.pageDesc.textContent = '共 ' + book.total + ' 个词条，按教材单元顺序排列。点击单词查看音标、释义与发音。';
    }
  }

  function updateSearchSummary(sections) {
    var query = state.query.trim();
    if (!query || !state.visibleWords.length) {
      els.searchSummary.hidden = true;
      els.searchSummary.replaceChildren();
      return;
    }
    els.searchSummary.innerHTML = '<span>找到 <strong>' + state.visibleWords.length + '</strong> 个词条，分布在 ' +
      sections.length + ' 个单元。</span>' +
      '<button class="summary-clear" type="button">清除搜索</button>';
    els.searchSummary.hidden = false;
  }

  function setActiveUnit(key, scrollLink) {
    if (!key) {
      state.activeUnitKey = null;
      els.unitNav.querySelectorAll('.unit-link').forEach(function (link) {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      });
      return;
    }

    var changed = state.activeUnitKey !== key;
    state.activeUnitKey = key;
    var activeLink = null;
    els.unitNav.querySelectorAll('.unit-link').forEach(function (link) {
      var active = link.dataset.target === key;
      link.classList.toggle('active', active);
      if (active) {
        link.setAttribute('aria-current', 'true');
        activeLink = link;
      } else {
        link.removeAttribute('aria-current');
      }
    });

    if (changed && scrollLink && activeLink && window.matchMedia('(max-width: 920px)').matches) {
      revealUnitLink(activeLink);
    }
  }

  function revealUnitLink(link) {
    var nav = els.unitNav;
    if (!nav || !link) return;

    var navRect = nav.getBoundingClientRect();
    var linkRect = link.getBoundingClientRect();
    var padding = 8;

    if (linkRect.left < navRect.left + padding) {
      nav.scrollLeft += linkRect.left - navRect.left - padding;
    } else if (linkRect.right > navRect.right - padding) {
      nav.scrollLeft += linkRect.right - navRect.right + padding;
    }
  }

  function render() {
    var book = currentBook();
    if (!book) return;

    var sections = buildVisible(book);
    updatePageChrome(book);
    renderUnitNav(sections);
    renderWordList(book, sections);
    updateProgress(book);
    updateSearchSummary(sections);

    var activeStillVisible = sections.some(function (section) { return section.key === state.activeUnitKey; });
    if (!activeStillVisible) state.activeUnitKey = sections.length ? sections[0].key : null;
    setActiveUnit(state.activeUnitKey, false);
    queueScrollSpy();
  }

  function selectBook(bookId, options) {
    var opts = options || {};
    var book = data.books.find(function (item) { return item.id === bookId; });
    if (!book) return;
    if (state.bookId === bookId && !opts.force) return;

    stopInlineAudio();
    state.bookId = bookId;
    state.query = '';
    state.unreadOnly = false;
    state.visibleWords = [];
    state.activeUnitKey = null;
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    els.unreadOnly.checked = false;
    els.searchSummary.hidden = true;
    cancelReset();
    safeStorageSet(STORAGE_BOOK, bookId);
    updateBookTabs();
    render();
    if (opts.scroll !== false) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    if (els.dialog.open) els.dialog.close();
  }

  function queueScrollSpy() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(function () {
      scrollFrame = 0;
      updateActiveFromScroll();
    });
  }

  function updateActiveFromScroll() {
    if (els.dialog.open) return;
    var sections = els.wordList.querySelectorAll('.unit-section');
    if (!sections.length) return;

    var header = document.querySelector('.site-header');
    var sticky = header && window.getComputedStyle(header).position === 'sticky';
    var line = sticky ? header.getBoundingClientRect().height + 20 : 24;
    var key = sections[0].dataset.unitKey;

    for (var i = 0; i < sections.length; i += 1) {
      if (sections[i].getBoundingClientRect().top <= line) {
        key = sections[i].dataset.unitKey;
      } else {
        break;
      }
    }
    if (key !== state.activeUnitKey) setActiveUnit(key, true);
  }

  function clearSearch(options) {
    var opts = options || {};
    window.clearTimeout(searchTimer);
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    state.query = '';
    render();
    if (opts.focus !== false) els.searchInput.focus();
  }

  function clearUnreadFilter() {
    els.unreadOnly.checked = false;
    state.unreadOnly = false;
    render();
  }

  function cancelReset() {
    window.clearTimeout(resetTimer);
    resetArmed = false;
    els.resetProgress.classList.remove('is-armed');
    els.resetProgress.textContent = '重置进度';
  }

  function armReset() {
    resetArmed = true;
    els.resetProgress.classList.add('is-armed');
    els.resetProgress.textContent = '再点一次确认';
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(cancelReset, 4000);
  }

  function resetBookProgress() {
    var book = currentBook();
    if (!book) return;
    getReadSet(book.id).clear();
    saveProgress();
    cancelReset();
    render();
    showToast('已重置本册点读进度');
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      els.toast.hidden = true;
    }, 3200);
  }

  function updateUnitReadCount(unit, key) {
    var section = document.getElementById(key);
    if (!section) return;
    var readNum = section.querySelector('.read-num');
    if (!readNum) return;
    var readSet = getReadSet(state.bookId);
    var count = unit.words.reduce(function (total, word) {
      return total + (readSet.has(word.id) ? 1 : 0);
    }, 0);
    readNum.textContent = String(count);
  }

  function markRead(item) {
    var set = getReadSet(state.bookId);
    if (set.has(item.word.id)) return;
    set.add(item.word.id);
    saveProgress();

    var row = rowById.get(item.word.id);
    if (row) row.classList.add('read');
    var book = currentBook();
    if (book) updateProgress(book);
    updateUnitReadCount(item.unit, item.unitKey);
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

  function stopInlineAudio() {
    inlineToken += 1;
    if (inlineAudio) {
      try { inlineAudio.pause(); } catch (error) { /* ignore */ }
      inlineAudio.removeAttribute('src');
      try { inlineAudio.load(); } catch (error) { /* ignore */ }
      inlineAudio = null;
    }
    if (inlineButton) {
      inlineButton.classList.remove('is-playing');
      inlineButton = null;
    }
  }

  function playInline(item, button) {
    if (!item) return;
    if (button.classList.contains('is-playing')) {
      stopInlineAudio();
      return;
    }

    stopInlineAudio();
    var token = inlineToken;
    var failed = false;
    var audio = new Audio();
    audio.preload = 'auto';
    inlineAudio = audio;
    inlineButton = button;
    button.classList.add('is-playing');

    function fail() {
      if (failed || token !== inlineToken) return;
      failed = true;
      stopInlineAudio();
      showToast('发音加载失败，点开单词可改用系统朗读。');
    }

    audio.addEventListener('error', fail, { once: true });
    audio.addEventListener('ended', function () {
      if (token !== inlineToken) return;
      stopInlineAudio();
    }, { once: true });

    audio.src = audioUrl(item.word.w, 'uk');
    var attempt = audio.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(fail);
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

  function fillDialog(item) {
    var word = item.word;
    var book = currentBook();
    stopDialogAudio();
    resetAudioStatus();
    dialogCurrent = item;

    els.dialogContext.textContent = book.label + ' · ' + item.unit.name + ' · 第 ' + (word._bookIndex + 1) + ' 词';
    els.dialogKind.textContent = KIND_LABEL[word.kind] || '';
    els.dialogWord.textContent = word.w;
    var hasIpa = Boolean(word.ipa && word.ipa.trim());
    els.dialogIpa.textContent = hasIpa ? '英式音标 ' + word.ipa : '音标暂缺';
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

    els.dialogPosition.textContent = (dialogIndex + 1) + ' / ' + state.visibleWords.length;
    els.prevWord.disabled = dialogIndex <= 0;
    els.nextWord.disabled = dialogIndex >= state.visibleWords.length - 1;
  }

  function openWordAt(index, trigger) {
    var item = state.visibleWords[index];
    if (!item) return;

    if (trigger) lastTrigger = trigger;
    stopInlineAudio();
    dialogIndex = index;
    markRead(item);
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
    if (next < 0 || next >= state.visibleWords.length) return;
    dialogIndex = next;
    markRead(state.visibleWords[next]);
    fillDialog(state.visibleWords[next]);
    els.dialogBody.scrollTop = 0;
  }

  function init() {
    loadProgress();

    if (!data || !Array.isArray(data.books) || !data.books.length) {
      els.wordList.innerHTML = '<div class="empty-state">' +
        '<div class="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v5M12 16.5v.5"></path></svg></div>' +
        '<h2>词表没有加载出来</h2>' +
        '<p>请确认 words.js 与页面在同一目录，然后刷新页面。</p>' +
        '<div class="empty-actions"><button type="button" data-action="reload">重新加载</button></div>' +
      '</div>';
      return;
    }

    prepareBooks();
    els.wordList.setAttribute('role', 'tabpanel');
    els.wordList.setAttribute('tabindex', '-1');
    renderBookTabs();

    var savedBook = safeStorageGet(STORAGE_BOOK);
    var initial = data.books.find(function (book) { return book.id === savedBook; }) || data.books[0];
    state.bookId = initial.id;
    updateBookTabs();
    render();
  }

  els.bookTabs.addEventListener('click', function (event) {
    var tab = event.target.closest('.book-tab');
    if (tab) selectBook(tab.dataset.book);
  });

  els.bookTabs.addEventListener('keydown', function (event) {
    var tabs = Array.from(els.bookTabs.querySelectorAll('.book-tab'));
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
    selectBook(tabs[next].dataset.book);
  });

  els.unitNav.addEventListener('click', function (event) {
    var link = event.target.closest('.unit-link');
    if (!link) return;
    event.preventDefault();
    var target = document.getElementById(link.dataset.target);
    if (!target) return;
    var header = document.querySelector('.site-header');
    var sticky = header && window.getComputedStyle(header).position === 'sticky';
    var offset = sticky ? header.getBoundingClientRect().height + 18 : 16;
    var top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: top, behavior: 'auto' });
    setActiveUnit(link.dataset.target, false);
  });

  els.searchInput.addEventListener('input', function () {
    els.searchClear.hidden = !els.searchInput.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      state.query = els.searchInput.value;
      render();
    }, 70);
  });

  els.searchInput.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (els.searchInput.value) {
        event.preventDefault();
        clearSearch();
      } else {
        els.searchInput.blur();
      }
    }
  });

  els.searchClear.addEventListener('click', function () {
    clearSearch();
  });

  els.searchSummary.addEventListener('click', function (event) {
    if (event.target.closest('.summary-clear')) clearSearch();
  });

  els.unreadOnly.addEventListener('change', function () {
    state.unreadOnly = els.unreadOnly.checked;
    render();
  });

  els.resetProgress.addEventListener('click', function () {
    if (resetArmed) {
      resetBookProgress();
    } else {
      armReset();
    }
  });

  els.wordList.addEventListener('click', function (event) {
    var action = event.target.closest('[data-action]');
    if (action) {
      var name = action.dataset.action;
      if (name === 'clear-search') clearSearch();
      if (name === 'clear-filter') clearUnreadFilter();
      if (name === 'reload') window.location.reload();
      return;
    }

    var open = event.target.closest('.word-open');
    if (open) {
      openWordAt(Number(open.dataset.index), open);
      return;
    }

    var play = event.target.closest('.row-play');
    if (play) {
      var item = state.visibleWords[Number(play.dataset.playIndex)];
      playInline(item, play);
    }
  });

  els.dialogClose.addEventListener('click', function () {
    els.dialog.close();
  });

  els.prevWord.addEventListener('click', function () { stepDialog(-1); });
  els.nextWord.addEventListener('click', function () { stepDialog(1); });

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

    if (state.unreadOnly) render();

    if (lastTrigger && lastTrigger.isConnected) {
      lastTrigger.focus();
    } else {
      var firstRow = els.wordList.querySelector('.word-open');
      if (firstRow) firstRow.focus();
      else els.searchInput.focus();
    }
    lastTrigger = null;
  });

  document.addEventListener('keydown', function (event) {
    if (els.dialog.open) return;
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return;
    var target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' || target.isContentEditable)) return;
    event.preventDefault();
    els.searchInput.focus();
  });

  window.addEventListener('scroll', queueScrollSpy, { passive: true });
  window.addEventListener('resize', queueScrollSpy);

  init();
})();
