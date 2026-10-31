/* The word filter shared by chat and friend nicknames.
     Filter.check(text, max)    { text } when it's fine (tidied up), or { error } saying why not
     Filter.display(text, max)  someone else's text with swears masked, or null to hide it entirely */
const Filter = (() => {
  // The word lists are base64 so the source doesn't read like a list of swears.
  // STRONG words are caught anywhere, even spread across spaces or dots ("f.u.c.k");
  // WORDS only as a whole word, so "class" or "grape" are fine.
  const STRONG = atob('ZnVjayxmdWssZmNrLHNoaXQsYml0Y2gsY3VudCxuaWdhLGZhZ290LHdob3JlLHNsdXQsYXNob2xlLGR1bWJhcyxqYWNrYXMsYmFzdGFyZCxyZXRhcmQscGVuaXMscG9ybix3YW5rZXIsdHdhdCxkb3VjaGUsa2lseW91cnNlbGY=').split(',');
  const WORDS = atob('YXNzLGFyc2UsZGljayxkaWNrcyxjb2NrLGNvY2tzLHB1c3N5LHNleCxzZXh5LHJhcGUscmFwZWQscmFwaW5nLGZhZyxmYWdzLG5pZ2dlcixuaWdnZXJzLGRhbW4sZGFtbWl0LGhvZSxob2VzLHRpdHMsdGl0dGllcyxib29iLGJvb2JzLGt5cyxzcGljLGtpa2UsY2hpbmssZ29vayxjb29uLHRyYW5ueSxuYXppLGhpdGxlcixzdGZ1LHd0ZixtaWxmLGRpbGRvLGN1bSxob3JueSxudWRlLG51ZGVzLGNyYXAscGlzcyxwaXNzZWQ=').split(',');
  const LEET = { 0: 'o', 1: 'i', '!': 'i', '|': 'i', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't', '+': 't', 8: 'b', 9: 'g' };

  const letters = s => [...s.toLowerCase()].map(c => LEET[c] || c).join('').replace(/[^a-z]/g, '');
  const squash = s => s.replace(/(.)\1+/g, '$1');
  const STRONG_SQ = STRONG.map(squash);
  const WORDS_SQ = WORDS.map(w => [squash(w), w.length]);

  const badWord = token => {
    const l = letters(token), sq = squash(l);
    return STRONG_SQ.some(w => sq.includes(w)) || WORDS_SQ.some(([w, n]) => sq === w && l.length >= n);
  };

  // Catches a word spelled out in short pieces ("f u c k", "fu ck") without joining whole words,
  // which would trip on innocent pairs like "this hit".
  function spreadOut(text) {
    let run = '';
    for (const t of text.split(' ').concat('')) {
      const l = letters(t);
      if (t && l.length <= 2) { run += l; continue; }
      if (run.length > 2 && STRONG_SQ.some(w => squash(run).includes(w))) return true;
      run = '';
    }
    return false;
  }

  // Links, emails and phone numbers stay out of chat entirely: nobody should be sharing those here.
  const PRIVATE = [
    /(https?:\/\/|www\.)/i,
    /\b[a-z0-9-]+\s?\.\s?(com|net|org|gg|io|co|me|ly|xyz|tv|us|app|dev|link|site)\b/i,
    /\S+@\S+\.\S+/,
    /(\d[\s.()-]*){7,}/,
  ];

  // Returns { text } for a clean message (with long letter runs trimmed), or { error }.
  function check(raw, max = 140) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, max).replace(/(.)\1{4,}/g, '$1$1$1$1');
    if (!text) return { error: '' };
    if (PRIVATE.some(re => re.test(text))) return { error: 'Links and personal info (emails, phone numbers) can\'t be shared here.' };
    if (text.split(' ').some(badWord) || spreadOut(text)) return { error: 'That wasn\'t allowed. Keep it friendly!' };
    return { text };
  }

  // What to show for a message someone else sent: masked words, or hidden altogether.
  function display(raw, max = 140) {
    const text = String(raw || '').slice(0, max).replace(/(.)\1{4,}/g, '$1$1$1$1');
    if (PRIVATE.some(re => re.test(text)) || spreadOut(text)) return null;
    return text.split(' ').map(t => (badWord(t) ? '•'.repeat(Math.min(6, t.length)) : t)).join(' ');
  }

  return { check, display };
})();
