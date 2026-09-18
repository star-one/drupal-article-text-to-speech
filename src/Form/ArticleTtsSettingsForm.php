<?php

namespace Drupal\article_tts\Form;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Configure the Article Text to Speech module.
 */
class ArticleTtsSettingsForm extends ConfigFormBase {

  /**
   * The module handler.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * {@inheritdoc}
   */
  public function __construct(ConfigFactoryInterface $config_factory, ModuleHandlerInterface $module_handler) {
    parent::__construct($config_factory);
    $this->moduleHandler = $module_handler;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('config.factory'),
      $container->get('module_handler')
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return ['article_tts.settings'];
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'article_tts_settings_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('article_tts.settings');

    $form['enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable the text-to-speech reader'),
      '#default_value' => $config->get('enabled'),
    ];

    $form['selectors'] = [
      '#type' => 'details',
      '#title' => $this->t('Where to attach the reader'),
      '#open' => TRUE,
    ];

    $form['selectors']['article_selector'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Article selector'),
      '#description' => $this->t('CSS selector used to find each readable item on the page. Defaults to %default.', ['%default' => 'article']),
      '#default_value' => $config->get('article_selector'),
      '#required' => TRUE,
    ];

    $form['selectors']['content_selector'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Content selector'),
      '#description' => $this->t('CSS selector, evaluated relative to each article, for the element containing the text that should be read aloud (for example the body field wrapper). If nothing inside the article matches, the whole article element is used. You may list several selectors separated by commas; the first match wins.'),
      '#default_value' => $config->get('content_selector'),
    ];

    $form['selectors']['placement'] = [
      '#type' => 'select',
      '#title' => $this->t('Player placement'),
      '#options' => [
        'before' => $this->t('Before the content'),
        'after' => $this->t('After the content'),
      ],
      '#default_value' => $config->get('placement'),
    ];

    $form['selectors']['content_types'] = $this->buildContentTypesElement($config);

    $form['labels'] = [
      '#type' => 'details',
      '#title' => $this->t('Button labels'),
      '#open' => FALSE,
    ];

    $form['labels']['label_play'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Play button label'),
      '#default_value' => $config->get('label_play'),
    ];

    $form['labels']['label_pause'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Pause button label'),
      '#default_value' => $config->get('label_pause'),
    ];

    $form['labels']['label_stop'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Stop button label'),
      '#default_value' => $config->get('label_stop'),
    ];

    $form['speech'] = [
      '#type' => 'details',
      '#title' => $this->t('Speech settings'),
      '#open' => TRUE,
    ];

    $form['speech']['voice'] = $this->buildVoiceElement($config);

    $form['#attached']['library'][] = 'article_tts/article_tts.admin';

    return parent::buildForm($form, $form_state);
  }

  /**
   * Builds the "restrict to content types" element.
   *
   * @param \Drupal\Core\Config\ImmutableConfig $config
   *   The module's config.
   *
   * @return array
   *   A form element render array.
   */
  protected function buildContentTypesElement($config) {
    if (!$this->moduleHandler->moduleExists('node')) {
      return [
        '#type' => 'item',
        '#title' => $this->t('Restrict to content types'),
        '#markup' => $this->t('The Node module is not installed, so content type restriction is not available; the reader will attach on every page.'),
      ];
    }

    $options = [];
    $node_types = \Drupal::entityTypeManager()->getStorage('node_type')->loadMultiple();
    foreach ($node_types as $node_type) {
      $options[$node_type->id()] = $node_type->label();
    }

    return [
      '#type' => 'checkboxes',
      '#title' => $this->t('Restrict to content types'),
      '#options' => $options,
      '#default_value' => (array) $config->get('content_types'),
      '#description' => $this->t('If none are selected, the reader is attached on every page (matching the selectors above), including pages that are not nodes at all - e.g. a plain custom page. If one or more are selected, the reader is limited to viewing pages of nodes with those content types.'),
    ];
  }

  /**
   * Builds the "default speaking voice" element.
   *
   * The list of voices comes from whatever browser is used to load this
   * settings form - the server has no way to know what voices a site
   * visitor's own browser will have installed. A small JS library
   * (article_tts.admin) repopulates this list at runtime from
   * speechSynthesis.getVoices(); the option below is only there so a
   * previously saved choice still displays correctly before that JS runs
   * (or if JS is unavailable).
   *
   * @param \Drupal\Core\Config\ImmutableConfig $config
   *   The module's config.
   *
   * @return array
   *   A form element render array.
   */
  protected function buildVoiceElement($config) {
    $options = ['' => $this->t('- Browser default -')];

    $saved_name = $config->get('voice_name');
    $saved_lang = $config->get('voice_lang');
    $saved_value = '';
    if ($saved_name) {
      $saved_value = $saved_name . '||' . $saved_lang;
      $options[$saved_value] = $saved_lang ? $this->t('@name (@lang)', ['@name' => $saved_name, '@lang' => $saved_lang]) : $saved_name;
    }

    return [
      '#type' => 'select',
      '#title' => $this->t('Default speaking voice'),
      '#options' => $options,
      '#default_value' => $saved_value,
      '#attributes' => ['id' => 'article-tts-voice-select'],
      '#description' => $this->t('This list is populated by your own browser and only shows voices installed on this computer. On the live site, each visitor\'s browser will use the closest match it has available to the voice you pick here (matched by name, falling back to language) - it cannot force every visitor onto exactly this voice if they don\'t have it installed. Leave as "Browser default" to let each visitor hear their own device\'s default voice.'),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $content_types = [];
    if ($this->moduleHandler->moduleExists('node')) {
      $content_types = array_values(array_filter((array) $form_state->getValue('content_types')));
    }

    $voice_value = $form_state->getValue('voice');
    $voice_name = '';
    $voice_lang = '';
    if ($voice_value) {
      [$voice_name, $voice_lang] = array_pad(explode('||', $voice_value, 2), 2, '');
    }

    $this->config('article_tts.settings')
      ->set('enabled', (bool) $form_state->getValue('enabled'))
      ->set('article_selector', trim($form_state->getValue('article_selector')))
      ->set('content_selector', trim($form_state->getValue('content_selector')))
      ->set('placement', $form_state->getValue('placement'))
      ->set('content_types', $content_types)
      ->set('label_play', $form_state->getValue('label_play'))
      ->set('label_pause', $form_state->getValue('label_pause'))
      ->set('label_stop', $form_state->getValue('label_stop'))
      ->set('voice_name', $voice_name)
      ->set('voice_lang', $voice_lang)
      ->save();

    parent::submitForm($form, $form_state);
  }

}
