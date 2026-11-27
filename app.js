(function () {
  'use strict';

  var STORAGE_PROGRESS = 'pep-words-progress-v1';
  var STORAGE_MEMORIZED = 'pep-words-memorized-v1';
  var STORAGE_BOOK = 'pep-words-book';
  var FILTER_LABEL = { all: '全部词条', unmemorized: '未背诵', memorized: '已背诵' };
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
    memorizedCount: document.getElementById('memorizedCount'),
    memorizedTotal: document.getElementById('memorizedTotal'),
    memorizedBar: document.getElementById('memorizedBar'),
    filters: document.querySelectorAll('.filter-chip'),
    unreadOnly: document.getElementById('unreadOnly'),
    resetProgress: document.getElementById('resetProgress'),
    dialogMemorize: document.getElementById('dialogMemorize'),
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
  var memorizedSets = new Map();
  var memorizedStore = {};
  var rowById = new Map();
  var state = {
    bookId: null,
    query: '',
    unreadOnly: false,
    filter: 'all',
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

  function getMemorizedSet(bookId) {
    if (!memorizedSets.has(bookId)) {
      var saved = memorizedStore[bookId];
      memorizedSets.set(bookId, new Set(Array.isArray(saved) ? saved : []));
    }
    return memorizedSets.get(bookId);
  }

  function serializeSets(store) {
    var output = {};
    store.forEach(function (set, bookId) {
      if (set.size) output[bookId] = Array.from(set);
    });
    return JSON.stringify(output);
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_PROGRESS, serializeSets(readSets));
    } catch (error) {
      /* Progress is still kept in memory when storage is unavailable. */
    }
  }

  function saveMemorized() {
    try {
      localStorage.setItem(STORAGE_MEMORIZED, serializeSets(memorizedSets));
    } catch (error) {
      /* Memorized marks are still kept in memory when storage is unavailable. */
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

  function loadProgress() {
    progressStore = readStore(STORAGE_PROGRESS);
    memorizedStore = readStore(STORAGE_MEMORIZED);
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

  function countIn(set, book) {
    var count = 0;
    book.units.forEach(function (unit) {
      unit.words.forEach(function (word) {
        if (set.has(word.id)) count += 1;
      });
    });
    return count;
  }

  function countRead(book) {
    return countIn(getReadSet(book.id), book);
  }

  function countMemorized(book) {
    return countIn(getMemorizedSet(book.id), book);
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

  function memorizeButton(item, memorized, visibleIndex, wordLabel) {
    return '<button class="row-memorize" type="button" data-memorize-index="' + visibleIndex + '" ' +
      'aria-pressed="' + (memorized ? 'true' : 'false') + '" ' +
      'aria-label="' + escapeHtml(wordLabel + (memorized ? '，已背诵，点击取消标记' : '，未背诵，点击标记为已背诵')) + '" ' +
      'title="' + (memorized ? '已背诵' : '标记已背诵') + '">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h10v13l-5-3.2-5 3.2z"></path></svg>' +
    '</button>';
  }

  function wordRow(item, visibleIndex, query, readSet, memorizedSet) {
    var word = item.word;
    var read = readSet.has(word.id);
    var memorized = memorizedSet.has(word.id);
    var ipa = word.ipa
      ? '<span class="ipa">' + escapeHtml(word.ipa) + '</span>'
      : '<span class="ipa is-empty" title="该词条暂无音标">—</span>';
    var meaning = sensesText(word);

    return '<div class="word-row' + (read ? ' read' : '') + (memorized ? ' memorized' : '') +
      '" data-word-id="' + escapeHtml(word.id) + '">' +
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
      memorizeButton(item, memorized, visibleIndex, word.w) +
    '</div>';
  }

  function buildVisible(book) {
    var query = normalize(state.query.trim());
    var readSet = getReadSet(book.id);
    var memorizedSet = getMemorizedSet(book.id);
    var sections = [];
    var flat = [];

    book.units.forEach(function (unit, unitPosition) {
      var words = [];
      unit.words.forEach(function (word) {
        if (state.unreadOnly && readSet.has(word.id)) return;
        if (state.filter === 'memorized' && !memorizedSet.has(word.id)) return;
        if (state.filter === 'unmemorized' && memorizedSet.has(word.id)) return;
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
    var bookmarkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.2L7 20z"></path></svg>';

    var hasFilter = state.unreadOnly || state.filter !== 'all';
    var clearButtons = (state.unreadOnly && state.filter !== 'all'
      ? '<button type="button" data-action="clear-filter">清除筛选</button>'
      : '<button type="button" data-action="clear-filter">查看全部词条</button>');

    var searchEmpty = query
      ? '<div class="controls"><div class="empty-state">' +
          '<div class="empty-icon">' + searchIcon + '</div>' +
          '<h2>没有找到“' + escapeHtml(query) + '”</h2>' +
          '<p>试试更短的拼写，或者输入中文释义。</p>' +
          '<div class="empty-actions">' +
            '<button type="button" data-action="clear-search">清除搜索</button>' +
            (hasFilter ? clearButtons : '') +
          '</div>' +
        '</div></div>'
      : '';

    if (state.filter === 'memorized' && !query && !state.unreadOnly) {
      return '<div class="controls"><div class="empty-state">' +
        '<div class="empty-icon">' + bookmarkIcon + '</div>' +
        '<h2>本册还没有已背诵的词</h2>' +
        '<p>点单词右侧的书签，或在详情页点“标记已背诵”，标记过的词会集中在这里。</p>' +
        '<div class="empty-actions"><button type="button" data-action="clear-filter">查看全部词条</button></div>' +
      '</div></div>';
    }

    if (hasFilter) {
      var reasons = [];
      if (state.filter === 'memorized') reasons.push('已背诵');
      if (state.filter === 'unmemorized') reasons.push('未背诵');
      if (state.unreadOnly) reasons.push('未点读');
      return '<div class="controls">' + searchEmpty +
        '<div class="empty-state">' +
          '<div class="empty-icon">' + bookIcon + '</div>' +
          '<h2>没有符合条件' + (reasons.length ? '（' + reasons.join('、') + '）' : '') + '的词条</h2>' +
          '<p>共 ' + book.total + ' 个词条。可以换一个筛选条件，或查看全部词条。</p>' +
          '<div class="empty-actions">' + clearButtons + '</div>' +
        '</div>' +
      '</div>';
    }

    if (searchEmpty) return searchEmpty;

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
    var memorizedSet = getMemorizedSet(book.id);
    var visibleIndex = 0;

    els.wordList.innerHTML = sections.map(function (section) {
      var readCount = section.unit.words.reduce(function (count, word) {
        return count + (readSet.has(word.id) ? 1 : 0);
      }, 0);
      var memorizedCount = section.unit.words.reduce(function (count, word) {
        return count + (memorizedSet.has(word.id) ? 1 : 0);
      }, 0);
      var rows = section.words.map(function (item) {
        var row = wordRow(item, visibleIndex, query, readSet, memorizedSet);
        visibleIndex += 1;
        return row;
      }).join('');

      var counts = '<span class="read-num">' + readCount + '</span> / ' + section.unit.words.length + ' 已读' +
        (memorizedCount
          ? '<span class="count-sep">·</span><span class="memo-num">' + memorizedCount + '</span> 已背'
          : '');

      return '<section class="unit-section" id="' + escapeHtml(section.key) + '" data-unit-key="' + escapeHtml(section.key) + '">' +
        '<div class="unit-head">' +
          '<div class="unit-title">' +
            '<span class="unit-index">' + pad2(section.unit.no == null ? section.unitPosition + 1 : section.unit.no) + '</span>' +
            '<h3>' + escapeHtml(section.unit.name) + '</h3>' +
          '</div>' +
          '<span class="unit-count">' + counts + '</span>' +
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

    var memorized = countMemorized(book);
    els.memorizedCount.textContent = String(memorized);
    els.memorizedTotal.textContent = '/ ' + book.total;
    els.memorizedBar.style.width = Math.min(100, (memorized / total) * 100) + '%';
    updateMemorizedBlockVisibility();

    els.resetProgress.hidden = memorized === 0;
    if (memorized === 0) cancelReset();
  }

  function updateMemorizedBlockVisibility() {
    var block = document.querySelector('.progress-block--sub');
    if (block) {
      block.style.display = state.filter === 'memorized' && !state.query.trim() ? 'none' : '';
    }
  }

  function updatePageChrome(book) {
    var query = state.query.trim();
    els.railBook.textContent = book.label;
    els.railMeta.textContent = book.units.length + ' 个单元 · ' + book.total + ' 个词条';
    els.pageKicker.textContent = book.label + ' · ' + book.units.length + ' 个单元';

    if (query) {
      els.pageTitle.textContent = '搜索结果';
      els.pageDesc.textContent = '匹配“' + query + '”的词条，按教材单元顺序排列。点击单词查看音标、释义与发音。';
      return;
    }

    if (state.filter === 'memorized') {
      els.pageTitle.textContent = state.unreadOnly ? '已背诵 · 未读' : '已背诵词条';
    } else if (state.filter === 'unmemorized') {
      els.pageTitle.textContent = state.unreadOnly ? '未背诵 · 未读' : '未背诵词条';
    } else {
      els.pageTitle.textContent = state.unreadOnly ? '未读词条' : '全部词表';
    }

    els.pageDesc.textContent = '共 ' + book.total + ' 个词条，按教材单元顺序排列。点击单词查看音标、释义与发音。';
  }

  function updateFilterChips() {
    els.filters.forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.dataset.filter === state.filter ? 'true' : 'false');
    });
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

  /* The empty states that combine 搜索 + 筛选 live inside one .controls wrapper,
     so the delegated click handler has to look one level past #wordList. */
  function closestAction(target) {
    var action = target.closest('[data-action]');
    if (action) return action;
    var wrapped = target.closest('.controls');
    return wrapped ? wrapped.querySelector('[data-action]') : null;
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
    updateFilterChips();
    renderUnitNav(sections);
    renderWordList(book, sections);
    updateProgress(book);
    updateSearchSummary(sections);
    updateMemorizedBlockVisibility();

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
    state.filter = 'all';
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

  function clearFilterAll() {
    els.unreadOnly.checked = false;
    state.unreadOnly = false;
    state.filter = 'all';
    render();
  }

  function cancelReset() {
    window.clearTimeout(resetTimer);
    resetArmed = false;
    els.resetProgress.classList.remove('is-armed');
    els.resetProgress.textContent = '重置背诵';
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
    getMemorizedSet(book.id).clear();
    saveMemorized();
    cancelReset();
    render();
    showToast('已清空本册背诵标记');
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

  function updateUnitMemorizedCount(unit, key) {
    var section = document.getElementById(key);
    if (!section) return;
    var counter = section.querySelector('.unit-count');
    if (!counter) return;
    var memorizedSet = getMemorizedSet(state.bookId);
    var readSet = getReadSet(state.bookId);
    var readCount = unit.words.reduce(function (total, word) {
      return total + (readSet.has(word.id) ? 1 : 0);
    }, 0);
    var memorizedCount = unit.words.reduce(function (total, word) {
      return total + (memorizedSet.has(word.id) ? 1 : 0);
    }, 0);
    counter.innerHTML = '<span class="read-num">' + readCount + '</span> / ' + unit.words.length + ' 已读' +
      (memorizedCount
        ? '<span class="count-sep">·</span><span class="memo-num">' + memorizedCount + '</span> 已背'
        : '');
  }

  function updateMemorizeButton(item, memorized) {
    var row = rowById.get(item.word.id);
    if (row) {
      row.classList.toggle('memorized', memorized);
      var button = row.querySelector('.row-memorize');
      if (button) {
        button.setAttribute('aria-pressed', memorized ? 'true' : 'false');
        button.title = memorized ? '已背诵' : '标记已背诵';
        button.setAttribute('aria-label', item.word.w + (memorized ? '，已背诵，点击取消标记' : '，未背诵，点击标记为已背诵'));
      }
    }
    syncDialogMemorize(item, memorized);
  }

  function syncDialogMemorize(item, memorized) {
    if (!item || !els.dialog.open) return;
    if (dialogIndex < 0 || state.visibleWords[dialogIndex] !== item) return;
    els.dialogMemorize.setAttribute('aria-pressed', memorized ? 'true' : 'false');
    els.dialogMemorize.querySelector('.memorize-label').textContent = memorized ? '已背诵' : '标记已背诵';
  }

  function setMemorized(item, value, announce) {
    var set = getMemorizedSet(state.bookId);
    var had = set.has(item.word.id);
    if (value) set.add(item.word.id); else set.delete(item.word.id);
    if (had === value) return;
    saveMemorized();

    var book = currentBook();
    if (book) updateProgress(book);
    updateUnitMemorizedCount(item.unit, item.unitKey);

    if (state.filter !== 'all') {
      render();
    } else {
      updateMemorizeButton(item, value);
    }

    if (announce !== false) {
      showToast(value ? '已标记为背诵：' + item.word.w : '已取消背诵标记：' + item.word.w);
    }
  }

  function toggleMemorize(item, announce) {
    if (!item) return;
    setMemorized(item, !getMemorizedSet(state.bookId).has(item.word.id), announce);
  }

  function applyFilter(filter) {
    if (filter === state.filter) return;
    state.filter = filter;
    render();
    var tools = document.querySelector('.page-tools');
    if (tools && tools.getBoundingClientRect().top < 0) {
      tools.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
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

    var memorized = getMemorizedSet(state.bookId).has(word.id);
    els.dialogMemorize.setAttribute('aria-pressed', memorized ? 'true' : 'false');
    els.dialogMemorize.querySelector('.memorize-label').textContent = memorized ? '已背诵' : '标记已背诵';
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

  /* render() rebuilds the filter chips, so remember which control was clicked
     and hand the focus back to its replacement after the list is redrawn. */
  function refocusControl(selector) {
    var node = document.querySelector(selector);
    if (node) node.focus();
  }

  els.unreadOnly.addEventListener('change', function () {
    state.unreadOnly = els.unreadOnly.checked;
    var wasFocused = document.activeElement === els.unreadOnly;
    render();
    var input = document.getElementById('unreadOnly');
    if (input !== els.unreadOnly) {
      input.checked = state.unreadOnly;
      els.unreadOnly = input;
    }
    if (wasFocused) refocusControl('#unreadOnly');
  });

  els.resetProgress.addEventListener('click', function () {
    if (resetArmed) {
      resetBookProgress();
    } else {
      armReset();
    }
  });

  els.wordList.addEventListener('click', function (event) {
    var action = closestAction(event.target);
    if (action) {
      var name = action.dataset.action;
      if (name === 'clear-search') {
        clearSearch();
        els.searchInput.focus();
      }
      if (name === 'clear-filter') {
        clearFilterAll();
        refocusControl('.filter-chip[data-filter="all"]');
      }
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
      var playItem = state.visibleWords[Number(play.dataset.playIndex)];
      playInline(playItem, play);
      return;
    }

    var memorize = event.target.closest('.row-memorize');
    if (memorize) {
      toggleMemorize(state.visibleWords[Number(memorize.dataset.memorizeIndex)]);
    }
  });

  els.filters.forEach(function (chip) {
    chip.addEventListener('click', function () {
      applyFilter(chip.dataset.filter);
      refocusControl('.filter-chip[data-filter="' + state.filter + '"]');
    });
  });

  els.dialogMemorize.addEventListener('click', function () {
    if (!dialogCurrent) return;
    toggleMemorize(dialogCurrent);
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

    if (state.unreadOnly || state.filter !== 'all') render();

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
