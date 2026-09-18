/**
 * @file
 * Populates the "Default speaking voice" select on the module's settings
 * form using the voices installed in whichever browser is used to view
 * that form. There is no server-side source for this list - voices are a
 * property of the visitor's own browser/OS, not something Drupal can know
 * about ahead of time.
 */

(function (Drupal, once) {
  'use strict';

  Drupal.behaviors.articleTtsAdminVoices = {
    attach: function (context) {
      if (!('speechSynthesis' in window)) {
        return;
      }

      once('article-tts-voice-select', '#article-tts-voice-select', context).forEach(function (select) {
        function populate() {
          var voices = window.speechSynthesis.getVoices();
          if (!voices || !voices.length) {
            return;
          }

          var previousValue = select.value;
          var existing = {};
          Array.prototype.forEach.call(select.options, function (option) {
            existing[option.value] = true;
          });

          voices.forEach(function (voice) {
            var value = voice.name + '||' + voice.lang;
            if (existing[value]) {
              return;
            }
            var option = document.createElement('option');
            option.value = value;
            option.textContent = voice.name + ' (' + voice.lang + ')' + (voice.default ? ' \u2014 ' + Drupal.t('OS default') : '');
            select.appendChild(option);
          });

          // Re-apply whatever was selected (the saved value, or whatever
          // the admin had already chosen) now that the full list is here.
          if (previousValue) {
            select.value = previousValue;
          }
        }

        populate();
        // Chrome (and others) load voices asynchronously; this fires once
        // they're ready. Safe to call repeatedly - populate() only adds
        // options it hasn't already added.
        window.speechSynthesis.addEventListener('voiceschanged', populate);
      });
    }
  };

})(Drupal, once);
