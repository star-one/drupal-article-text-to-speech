/**
 * @file
 * Text-to-speech reader with word-by-word highlighting for <article>
 * elements. Ported from a hand-rolled PHP/JS version that had to build an
 * escaped JavaScript string on the server for every post; here the text is
 * read straight out of the DOM, so there is nothing to escape.
 *
 * The highlighted word is wrapped in a <mark> spliced directly into the
 * original markup (via Text.splitText()), so links, bold/italic, images
 * and other formatting stay intact while the content is being read -
 * nothing is ever flattened to plain text on screen. Plain text is only
 * used internally to build the utterance passed to SpeechSynthesis.
 */

(function (Drupal, once) {
  'use strict';

  Drupal.behaviors.articleTts = {
    attach: function (context, settings) {
      if (!('speechSynthesis' in window)) {
        // Browser has no speech synthesis support; nothing to do.
        return;
      }

      var config = (settings && settings.articleTts) || {};
      var articleSelector = config.articleSelector || 'article';
      var contentSelector = config.contentSelector || '.field--name-body, .node__content, .content';
      var placement = config.placement === 'after' ? 'after' : 'before';
      var labels = config.labels || {};
      labels.play = labels.play || 'Listen';
      labels.pause = labels.pause || 'Pause';
      labels.stop = labels.stop || 'Stop';
      var voice = config.voice || {};

      once('article-tts', articleSelector, context).forEach(function (articleEl) {
        var contentEl = contentSelector ? articleEl.querySelector(contentSelector) : null;
        if (!contentEl) {
          contentEl = articleEl;
        }
        Drupal.articleTts.buildPlayer(contentEl, placement, labels, voice);
      });
    }
  };

  Drupal.articleTts = Drupal.articleTts || {};

  /**
   * Walks the text nodes of root, in document order, and builds:
   *  - text: the whitespace-collapsed plain-text rendering of root, exactly
   *    as `.textContent.replace(/\s+/g, ' ').trim()` would produce.
   *  - map: an array the same length as `text`, where map[i] gives the
   *    {node, offset} in the *live* DOM that produced character i - i.e.
   *    node.nodeValue.charAt(offset) === text.charAt(i).
   *
   * Re-run this after any DOM change (e.g. after resetting innerHTML) to
   * get fresh, valid node references; the resulting `text` will be
   * identical each time since the underlying content doesn't change.
   *
   * @param {HTMLElement} root
   *   The element to scan.
   *
   * @return {{text: string, map: Array}}
   */
  function buildTextMap(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest('script, style, noscript, [hidden], [aria-hidden="true"]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var chars = [];
    var map = [];
    var lastWasSpace = true; // Starting true collapses away leading whitespace.
    var node;

    while ((node = walker.nextNode())) {
      var raw = node.nodeValue;
      for (var i = 0; i < raw.length; i++) {
        var ch = raw.charAt(i);
        var isSpace = /\s/.test(ch);
        if (isSpace) {
          if (lastWasSpace) {
            continue;
          }
          chars.push(' ');
          map.push({ node: node, offset: i });
          lastWasSpace = true;
        }
        else {
          chars.push(ch);
          map.push({ node: node, offset: i });
          lastWasSpace = false;
        }
      }
    }

    // Trim a trailing collapsed space, mirroring String.prototype.trim().
    while (chars.length && chars[chars.length - 1] === ' ') {
      chars.pop();
      map.pop();
    }

    return { text: chars.join(''), map: map };
  }

  /**
   * Splits a live text node so that the [rawStart, rawEnd) slice of its
   * value becomes its own text node, then wraps that slice in a <mark>.
   * Everything else in the DOM - sibling nodes, parent elements, other
   * formatting - is left untouched.
   *
   * @param {Text} node
   *   A live text node in the current DOM.
   * @param {number} rawStart
   *   Start offset within node.nodeValue (inclusive).
   * @param {number} rawEnd
   *   End offset within node.nodeValue (exclusive).
   */
  function wrapSegment(node, rawStart, rawEnd) {
    var wordNode = rawStart > 0 ? node.splitText(rawStart) : node;
    if (rawEnd - rawStart < wordNode.nodeValue.length) {
      wordNode.splitText(rawEnd - rawStart);
    }
    var mark = document.createElement('mark');
    mark.className = 'article-tts-current-word';
    wordNode.parentNode.insertBefore(mark, wordNode);
    mark.appendChild(wordNode);
  }

  /**
   * Finds the closest match, among this browser's own installed voices, to
   * an administrator's configured preference. Voices are per-browser/OS,
   * so the exact voice picked in the settings form may not exist here;
   * this falls back from an exact name match to a language match, and
   * finally to the browser's own default (undefined - i.e. do nothing,
   * and let SpeechSynthesisUtterance use its normal default).
   *
   * @param {string} preferredName
   *   The voice.name saved from the settings form, or ''.
   * @param {string} preferredLang
   *   The voice.lang saved alongside it, or ''.
   *
   * @return {SpeechSynthesisVoice|null}
   */
  function findPreferredVoice(preferredName, preferredLang) {
    if (!preferredName && !preferredLang) {
      return null;
    }

    var voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) {
      return null;
    }

    if (preferredName) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].name === preferredName) {
          return voices[i];
        }
      }
    }

    if (preferredLang) {
      for (var j = 0; j < voices.length; j++) {
        if (voices[j].lang === preferredLang) {
          return voices[j];
        }
      }
      var primary = preferredLang.split('-')[0];
      for (var k = 0; k < voices.length; k++) {
        if (voices[k].lang && voices[k].lang.split('-')[0] === primary) {
          return voices[k];
        }
      }
    }

    return null;
  }

  /**
   * Builds the play/pause/stop controls for one readable element and wires
   * up the SpeechSynthesis events, including in-place word highlighting
   * that preserves the element's original HTML formatting.
   *
   * @param {HTMLElement} contentEl
   *   The element whose text should be read aloud. Its markup is restored
   *   from a saved copy before every highlight update and whenever speech
   *   is stopped, paused, or finishes.
   * @param {string} placement
   *   'before' or 'after' - where to insert the controls relative to
   *   contentEl.
   * @param {Object} labels
   *   Button label strings: play, pause, stop.
   * @param {Object} voice
   *   The administrator's preferred voice: {name, lang}, either of which
   *   may be empty to mean "browser default".
   */
  Drupal.articleTts.buildPlayer = function (contentEl, placement, labels, voice) {
    var originalHtml = contentEl.innerHTML;
    var plainText = buildTextMap(contentEl).text;

    if (!plainText) {
      return;
    }

    var player = document.createElement('div');
    player.className = 'article-tts-player';

    var playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'article-tts-button article-tts-play';
    playBtn.textContent = labels.play;

    var pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'article-tts-button article-tts-pause';
    pauseBtn.textContent = labels.pause;
    pauseBtn.disabled = true;

    var stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'article-tts-button article-tts-stop';
    stopBtn.textContent = labels.stop;
    stopBtn.disabled = true;

    player.appendChild(playBtn);
    player.appendChild(pauseBtn);
    player.appendChild(stopBtn);

    if (placement === 'after') {
      contentEl.parentNode.insertBefore(player, contentEl.nextSibling);
    }
    else {
      contentEl.parentNode.insertBefore(player, contentEl);
    }

    var utterance = null;
    var voiceLookupPending = false;

    function resetContent() {
      contentEl.innerHTML = originalHtml;
    }

    function speakWithVoice() {
      utterance = new SpeechSynthesisUtterance(plainText);
      var lang = document.documentElement.getAttribute('lang');
      if (lang) {
        utterance.lang = lang;
      }

      var matchedVoice = findPreferredVoice(voice.name, voice.lang);
      if (matchedVoice) {
        utterance.voice = matchedVoice;
        // A voice's own language should win over the page's <html lang>.
        utterance.lang = matchedVoice.lang;
      }

      utterance.addEventListener('start', handleStart);
      utterance.addEventListener('pause', handlePause);
      utterance.addEventListener('resume', handleResume);
      utterance.addEventListener('end', handleEnd);
      utterance.addEventListener('boundary', handleBoundary);
      window.speechSynthesis.speak(utterance);
    }

    function play() {
      if (window.speechSynthesis.paused && window.speechSynthesis.speaking) {
        window.speechSynthesis.resume();
        return;
      }
      if (window.speechSynthesis.speaking) {
        return;
      }

      var hasVoicePreference = voice.name || voice.lang;
      var voicesReady = window.speechSynthesis.getVoices().length > 0;

      if (hasVoicePreference && !voicesReady && !voiceLookupPending) {
        // Some browsers (notably Chrome) load the voice list asynchronously
        // and it may not be ready on the very first click; wait for it once
        // rather than silently falling back to the browser default.
        voiceLookupPending = true;
        window.speechSynthesis.addEventListener('voiceschanged', function onReady() {
          window.speechSynthesis.removeEventListener('voiceschanged', onReady);
          voiceLookupPending = false;
          speakWithVoice();
        }, { once: true });
        // Some browsers need a call to getVoices() to kick off loading.
        window.speechSynthesis.getVoices();
        return;
      }

      speakWithVoice();
    }

    /**
     * Highlights the word at [wordStart, wordEnd) in plainText, directly
     * within contentEl's original markup. The element is first restored to
     * its pristine HTML (clearing any previous highlight and guaranteeing
     * valid, freshly-scanned node references), then re-scanned so the word
     * can be located in the live DOM and wrapped in a <mark> via
     * Text.splitText() - a surgical edit that never touches the
     * surrounding tags.
     */
    function highlightRange(wordStart, wordEnd) {
      resetContent();
      var map = buildTextMap(contentEl).map;

      wordEnd = Math.min(wordEnd, map.length);
      if (wordStart < 0 || wordStart >= wordEnd) {
        return;
      }

      var i = wordStart;
      while (i < wordEnd) {
        var info = map[i];
        if (!info) {
          break;
        }
        var node = info.node;
        var rawStart = info.offset;
        var j = i;
        while (j < wordEnd && map[j] && map[j].node === node) {
          j++;
        }
        var rawEnd = map[j - 1].offset + 1;
        wrapSegment(node, rawStart, rawEnd);
        i = j;
      }
    }

    function pause() {
      window.speechSynthesis.pause();
    }

    function stop() {
      window.speechSynthesis.cancel();
      // Some browsers (notably Safari) don't fire 'end' on cancel().
      handleEnd();
    }

    function handleStart() {
      playBtn.disabled = true;
      pauseBtn.disabled = false;
      stopBtn.disabled = false;
    }

    function handlePause() {
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      stopBtn.disabled = false;
      resetContent();
    }

    function handleResume() {
      playBtn.disabled = true;
      pauseBtn.disabled = false;
      stopBtn.disabled = false;
    }

    function handleEnd() {
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      stopBtn.disabled = true;
      resetContent();
    }

    function handleBoundary(event) {
      if (event.name === 'sentence') {
        // Only word boundaries are used for highlighting.
        return;
      }

      var wordStart = event.charIndex;
      var wordLength = event.charLength;
      if (wordLength === undefined) {
        // Safari doesn't provide charLength; fall back to a regex.
        var match = plainText.substring(wordStart).match(/^[a-z\d']*/i);
        wordLength = match ? match[0].length : 0;
      }

      if (wordLength <= 0) {
        return;
      }

      highlightRange(wordStart, wordStart + wordLength);
    }

    playBtn.addEventListener('click', play);
    pauseBtn.addEventListener('click', pause);
    stopBtn.addEventListener('click', stop);

    // Stop any in-progress speech if the user navigates away.
    window.addEventListener('beforeunload', function () {
      window.speechSynthesis.cancel();
    });
  };

})(Drupal, once);
