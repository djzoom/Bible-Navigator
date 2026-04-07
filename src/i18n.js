// Bible Sunburst — i18n labels
// Keys match data/bible.json book names (English, modern numerals)

export const I18N = {
  ui: {
    en: {
      title: 'The Bible — A Sunburst',
      subtitle: '66 books · 1,189 chapters · 31,102 verses',
      lang: '中',
      theme: '☾',
      reset: 'Reset',
      hint: 'Hover a chapter for info · click a chapter to read · click a book to zoom',
      verses: 'verses',
      chapter: 'Chapter',
      ot: 'Old Testament',
      nt: 'New Testament',
      bible: 'Bible',
    },
    zh: {
      title: '圣经 · 旭日图',
      subtitle: '66 卷 · 1,189 章 · 31,102 节',
      lang: 'EN',
      theme: '☾',
      reset: '重置',
      hint: '悬停查看信息 · 点击章阅读经文 · 点击书放大',
      verses: '节',
      chapter: '第',
      ot: '旧约',
      nt: '新约',
      bible: '圣经',
    },
  },

  // Book name translations. Key = English name in bible.json.
  books: {
    // ── Old Testament ──
    'Genesis':            { en: 'Genesis',         zh: '创世记' },
    'Exodus':             { en: 'Exodus',          zh: '出埃及记' },
    'Leviticus':          { en: 'Leviticus',       zh: '利未记' },
    'Numbers':            { en: 'Numbers',         zh: '民数记' },
    'Deuteronomy':        { en: 'Deuteronomy',     zh: '申命记' },
    'Joshua':             { en: 'Joshua',          zh: '约书亚记' },
    'Judges':             { en: 'Judges',          zh: '士师记' },
    'Ruth':               { en: 'Ruth',            zh: '路得记' },
    '1 Samuel':           { en: '1 Samuel',        zh: '撒母耳记上' },
    '2 Samuel':           { en: '2 Samuel',        zh: '撒母耳记下' },
    '1 Kings':            { en: '1 Kings',         zh: '列王纪上' },
    '2 Kings':            { en: '2 Kings',         zh: '列王纪下' },
    '1 Chronicles':       { en: '1 Chronicles',    zh: '历代志上' },
    '2 Chronicles':       { en: '2 Chronicles',    zh: '历代志下' },
    'Ezra':               { en: 'Ezra',            zh: '以斯拉记' },
    'Nehemiah':           { en: 'Nehemiah',        zh: '尼希米记' },
    'Esther':             { en: 'Esther',          zh: '以斯帖记' },
    'Job':                { en: 'Job',             zh: '约伯记' },
    'Psalms':             { en: 'Psalms',          zh: '诗篇' },
    'Proverbs':           { en: 'Proverbs',        zh: '箴言' },
    'Ecclesiastes':       { en: 'Ecclesiastes',    zh: '传道书' },
    'Song of Solomon':    { en: 'Song of Solomon', zh: '雅歌' },
    'Isaiah':             { en: 'Isaiah',          zh: '以赛亚书' },
    'Jeremiah':           { en: 'Jeremiah',        zh: '耶利米书' },
    'Lamentations':       { en: 'Lamentations',    zh: '耶利米哀歌' },
    'Ezekiel':            { en: 'Ezekiel',         zh: '以西结书' },
    'Daniel':             { en: 'Daniel',          zh: '但以理书' },
    'Hosea':              { en: 'Hosea',           zh: '何西阿书' },
    'Joel':               { en: 'Joel',            zh: '约珥书' },
    'Amos':               { en: 'Amos',            zh: '阿摩司书' },
    'Obadiah':            { en: 'Obadiah',         zh: '俄巴底亚书' },
    'Jonah':              { en: 'Jonah',           zh: '约拿书' },
    'Micah':              { en: 'Micah',           zh: '弥迦书' },
    'Nahum':              { en: 'Nahum',           zh: '那鸿书' },
    'Habakkuk':           { en: 'Habakkuk',        zh: '哈巴谷书' },
    'Zephaniah':          { en: 'Zephaniah',       zh: '西番雅书' },
    'Haggai':             { en: 'Haggai',          zh: '哈该书' },
    'Zechariah':          { en: 'Zechariah',       zh: '撒迦利亚书' },
    'Malachi':            { en: 'Malachi',         zh: '玛拉基书' },

    // ── New Testament ──
    'Matthew':            { en: 'Matthew',         zh: '马太福音' },
    'Mark':               { en: 'Mark',            zh: '马可福音' },
    'Luke':               { en: 'Luke',            zh: '路加福音' },
    'John':               { en: 'John',            zh: '约翰福音' },
    'Acts':               { en: 'Acts',            zh: '使徒行传' },
    'Romans':             { en: 'Romans',          zh: '罗马书' },
    '1 Corinthians':      { en: '1 Corinthians',   zh: '哥林多前书' },
    '2 Corinthians':      { en: '2 Corinthians',   zh: '哥林多后书' },
    'Galatians':          { en: 'Galatians',       zh: '加拉太书' },
    'Ephesians':          { en: 'Ephesians',       zh: '以弗所书' },
    'Philippians':        { en: 'Philippians',     zh: '腓立比书' },
    'Colossians':         { en: 'Colossians',      zh: '歌罗西书' },
    '1 Thessalonians':    { en: '1 Thessalonians', zh: '帖撒罗尼迦前书' },
    '2 Thessalonians':    { en: '2 Thessalonians', zh: '帖撒罗尼迦后书' },
    '1 Timothy':          { en: '1 Timothy',       zh: '提摩太前书' },
    '2 Timothy':          { en: '2 Timothy',       zh: '提摩太后书' },
    'Titus':              { en: 'Titus',           zh: '提多书' },
    'Philemon':           { en: 'Philemon',        zh: '腓利门书' },
    'Hebrews':            { en: 'Hebrews',         zh: '希伯来书' },
    'James':              { en: 'James',           zh: '雅各书' },
    '1 Peter':            { en: '1 Peter',         zh: '彼得前书' },
    '2 Peter':            { en: '2 Peter',         zh: '彼得后书' },
    '1 John':             { en: '1 John',          zh: '约翰一书' },
    '2 John':             { en: '2 John',          zh: '约翰二书' },
    '3 John':             { en: '3 John',          zh: '约翰三书' },
    'Jude':               { en: 'Jude',            zh: '犹大书' },
    'Revelation':         { en: 'Revelation',      zh: '启示录' },
  },

  // Book group / section labels (between Testament and Book)
  groups: {
    Law:        { en: 'Pentateuch',      zh: '摩西五经' },
    History:    { en: 'Historical',      zh: '历史书' },
    Wisdom:     { en: 'Wisdom',          zh: '智慧书' },
    MajorProph: { en: 'Major Prophets',  zh: '大先知书' },
    MinorProph: { en: 'Minor Prophets',  zh: '小先知书' },
    Gospel:     { en: 'Gospels',         zh: '福音书' },
    Acts:       { en: 'Acts',            zh: '使徒行传' },
    Pauline:    { en: 'Pauline Epistles',zh: '保罗书信' },
    General:    { en: 'General Epistles',zh: '普通书信' },
    Apoc:       { en: 'Apocalypse',      zh: '启示录' },
  },
};

// Short labels for tight arcs (auto-derived: first 4 letters of EN, full ZH)
export function bookLabel(name, lang, short = false) {
  const entry = I18N.books[name];
  if (!entry) return name;
  if (lang === 'zh') return entry.zh;
  if (short) return entry.en.length > 6 ? entry.en.slice(0, 4) + '.' : entry.en;
  return entry.en;
}

export function groupLabel(key, lang) {
  const entry = I18N.groups[key];
  if (!entry) return key;
  return lang === 'zh' ? entry.zh : entry.en;
}
