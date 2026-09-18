# Article Text to Speech

Adds "Listen / Pause / Stop" controls to `<article>` elements on a page.
When played, the browser's built-in speech synthesis (Web Speech API) reads
the text aloud and highlights each word as it is spoken, restoring the
normal formatted content whenever playback is stopped or paused.

This is a Drupal port of a hand-rolled PHP/JS text-to-speech reader. The
original built a JavaScript string on the server for every post and had to
manually escape quotes, entities and line breaks for it - fragile by
nature. This module instead reads the text directly out of the DOM
(`element.textContent`) in the browser, so there's nothing to escape and it
works on any page, not just server-rendered posts.

Requires no external services: everything runs client-side via
`window.speechSynthesis`, so voice quality/availability depends on the
visitor's browser and OS.

This module was created by Claude Code from original lovingly handcrafted code
that I'd created for my own lovingly handcrafted personal blog site. It can be
seen implemented on my own LocalGovDrupal site at https://www.bigtown.star-one.org.uk/

## Compatibility

Drupal 9, 10 and 11.

## Installation

1. Copy this `article_tts` directory into your site's `modules/custom/`
   directory (or install via Composer if you package it in a repository).
2. Enable the module:
   ```
   drush en article_tts
   ```
   or via **Extend** in the admin UI.

## Configuration

Visit **Configuration » Content authoring » Article Text to Speech**
(`/admin/config/content/article-tts`) to set:

- **Article selector** - the CSS selector used to find each readable item
  on the page. Defaults to `article`.
- **Content selector** - a CSS selector, evaluated *inside* each article,
  for the element holding the text that should be read aloud (for example
  your body field wrapper, e.g. `.field--name-body`). If nothing inside the
  article matches, the whole article element is used. You can list several
  selectors separated by commas.
- **Player placement** - whether the Listen/Pause/Stop buttons appear
  before or after the content element.
- **Restrict to content types** - if left empty, the reader attaches on
  every page (including non-node pages such as a plain custom page). If
  you select one or more content types, it only attaches on node pages of
  those types.
- **Button labels** - customise the text/emoji shown on each button.
- **Default speaking voice** - a dropdown populated, live, from whatever
  voices are installed in *your own* browser while you're on this settings
  page (there's no server-side list of voices - they belong to each
  visitor's browser/OS). Site visitors will hear the closest match their
  own browser has available: an exact name match if they have that voice
  installed, otherwise a voice in the same language, otherwise their
  browser's own default. Leave it as "Browser default" to always use each
  visitor's own default voice.

The module attaches its library on every page (it's a small JS/CSS
payload) and does nothing if no matching `<article>` elements are present,
so it's safe to leave enabled site-wide - e.g. it will work on a page such
as `/holding-page` as long as that page's markup includes an `<article>`
element.

## Per-page overrides

Anyone with the "Administer Article Text to Speech settings" permission
sees a **Text to speech** tab in the "Advanced" sidebar of every node's
edit form, letting them override the site-wide setting for that one page:

- **Use the site default** - the normal behaviour: follows the master
  on/off switch and content-type restriction from the settings page.
- **Always show the reader on this page** - shows it here even if the
  reader is switched off site-wide, or this content type isn't selected in
  "Restrict to content types".
- **Never show the reader on this page** - hides it here even if it would
  otherwise apply.

This is stored as a simple key/value lookup against the node ID rather
than a real entity field, so installing or updating the module never
requires running `drush entity:updates`. Trade-offs worth knowing:

- It applies to the node as a whole, not per translation.
- It isn't versioned with revisions or content moderation states - there's
  one current override per node, same as (for example) a "sticky" flag.
- The stored value is cleared automatically when its node is deleted, and
  the whole store is cleared if the module is uninstalled.

## Notes / limitations

- Requires a browser with `SpeechSynthesis` support (all modern desktop
  and mobile browsers; the controls simply don't appear if unsupported).
- The original HTML formatting (links, bold/italic, images, lists, etc.)
  is preserved throughout playback. Each spoken word is highlighted by
  splicing a `<mark>` directly into the live DOM around just that word
  (via `Text.splitText()`), rather than flattening the content to plain
  text. Before highlighting each new word, the element is restored to a
  saved copy of its pristine markup and re-scanned, which both clears the
  previous word's highlight and guarantees the DOM references used to
  place the new one are valid - so the visible content always matches the
  original formatting except for the single word currently being read. The
  same restore happens on pause, stop, or when speech finishes.
- On the rare occasion a single "word" (as reported by the browser's
  speech engine) straddles two different inline elements with no space
  between them (e.g. `wo<em>rld</em>`), each side is wrapped in its own
  `<mark>` rather than a single one spanning both - so highlighting always
  stays inside the existing tag structure instead of restructuring it.
- Voice selection, rate and pitch use the browser/OS defaults. If you want
  a settings UI for those too, `SpeechSynthesisUtterance` exposes `.voice`,
  `.rate`, `.pitch` and `.volume` - happy to extend the module with that if
  useful.
