import { saveCurrentCard, getSessionSnapshot } from '../shared/cards.js'
import { getLanguageLabel, resolveLanguageValue } from '../shared/languages.js'

const thumb = document.getElementById('thumb')
const loadingPanel = document.getElementById('loading')
const translatedTextEl = document.getElementById('translatedText')
const addCardBtn = document.getElementById('addCard')
const addAndSaveBtn = document.getElementById('addAndSave')
const closeBtn = document.getElementById('closePopup')
const statusEl = document.getElementById('status')

const TARGET_LANGUAGE_KEY = 'targetLanguage'
const PLACEHOLDER_IMAGE = chrome.runtime.getURL('icons/icon128.png')

let englishText = ''
let translationText = ''
let targetLanguage = 'en'
let translationJob = 0

if (thumb) {
  thumb.src = PLACEHOLDER_IMAGE
}

function setStatus (message) {
  statusEl.textContent = message || ''
}

function updateActionsState () {
  const hasEnglish = Boolean(englishText.trim())
  addCardBtn.disabled = !hasEnglish
  addAndSaveBtn.disabled = !hasEnglish
}

function updateThumb (imageSrc, thumbDataUrl) {
  if (!thumb) return
  const src =
    thumbDataUrl || (imageSrc && !imageSrc.startsWith('blob:') ? imageSrc : '')
  thumb.src = src || PLACEHOLDER_IMAGE
}

function clearTranslatedText () {
  translatedTextEl.hidden = true
  translatedTextEl.textContent = ''
  translatedTextEl.removeAttribute('lang')
}

function showTranslationResult (text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) {
    clearTranslatedText()
    return
  }
  translatedTextEl.hidden = false
  translatedTextEl.textContent = trimmed
  translatedTextEl.setAttribute('lang', targetLanguage)
}

async function persistTranslationSnapshot () {
  try {
    await chrome.storage.session.set({
      translationText,
      translationLang: translationText ? targetLanguage : ''
    })
  } catch (error) {
    console.warn('Failed to store translation snapshot', error)
  }
}

async function ensureTranslation () {
  if (!englishText) {
    translationText = ''
    clearTranslatedText()
    await persistTranslationSnapshot()
    updateActionsState()
    return
  }

  if (
    translationText &&
    !translatedTextEl.hidden &&
    translatedTextEl.getAttribute('lang') === targetLanguage
  ) {
    updateActionsState()
    return
  }

  if (targetLanguage === 'en') {
    translationText = englishText
    showTranslationResult(translationText)
    setStatus('')
    await persistTranslationSnapshot()
    updateActionsState()
    return
  }

  const jobId = ++translationJob
  translationText = ''
  clearTranslatedText()
  setStatus(`Translating to ${getLanguageLabel(targetLanguage)}...`)

  try {
    const translator = await Translator.create({
      sourceLanguage: 'en',
      targetLanguage
    })
    const result = await translator.translate(englishText)
    if (jobId !== translationJob) return
    translationText = typeof result === 'string' ? result.trim() : ''
    setStatus('')
  } catch (error) {
    if (jobId !== translationJob) return
    console.error('Translation failed', error)
    translationText = ''
    const message =
      error && error.message ? error.message : 'Translation unavailable.'
    setStatus(message)
    clearTranslatedText()
    await persistTranslationSnapshot()
    updateActionsState()
    return
  }

  showTranslationResult(translationText)
  await persistTranslationSnapshot()
  updateActionsState()
}

async function refreshSnapshot () {
  const snap = await getSessionSnapshot()
  updateThumb(snap.imageSrc, snap.thumbDataUrl)

  englishText = snap.altTextEn || ''
  if (englishText) {
    loadingPanel.setAttribute('hidden', true)
  } else {
    loadingPanel.removeAttribute('hidden')
  }

  const normalizedTranslationLang = snap.translationLang
    ? resolveLanguageValue(snap.translationLang)
    : ''

  if (normalizedTranslationLang === targetLanguage && snap.translationText) {
    translationText = snap.translationText
    showTranslationResult(translationText)
  } else {
    translationText = ''
    clearTranslatedText()
  }

  updateActionsState()

  if (
    englishText &&
    (!translationText || normalizedTranslationLang !== targetLanguage)
  ) {
    await ensureTranslation()
  }
}

async function initTargetLanguage () {
  const stored = await chrome.storage.local.get([TARGET_LANGUAGE_KEY])
  targetLanguage = resolveLanguageValue(stored[TARGET_LANGUAGE_KEY])
}

function resetForNewGeneration () {
  translationJob += 1
  englishText = ''
  translationText = ''
  loadingPanel.removeAttribute('hidden')
  clearTranslatedText()
  updateActionsState()
  setStatus('Generating description...')
  updateThumb('', '')
}

async function handleAddCard ({ openHistory } = {}) {
  if (!englishText) return false
  addCardBtn.disabled = true
  addAndSaveBtn.disabled = true
  setStatus('Saving card...')
  const success = await saveCurrentCard({
    englishText,
    translationLang: translationText ? targetLanguage : '',
    translationText
  }).catch(error => {
    console.error('Failed to save card', error)
    return false
  })
  updateActionsState()
  setStatus(success ? 'Card saved.' : 'Nothing to save.')
  if (success && openHistory) {
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_HISTORY_PAGE' })
    } catch (error) {
      console.warn('Failed to open history page', error)
    }
  }
  return success
}

function setupListeners () {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session') {
      if (changes.thumbDataUrl || changes.imageSrc) {
        const newThumb = changes.thumbDataUrl?.newValue || ''
        const newImage = changes.imageSrc?.newValue || ''
        updateThumb(newImage, newThumb)
      }

      if (changes.altTextEn || changes.altText) {
        const newValue =
          changes.altTextEn?.newValue || changes.altText?.newValue || ''
        englishText = newValue
        if (englishText) {
          loadingPanel.setAttribute('hidden', true)
          translationText = ''
          clearTranslatedText()
          updateActionsState()
          void ensureTranslation()
        } else {
          loadingPanel.removeAttribute('hidden')
          translationText = ''
          clearTranslatedText()
          updateActionsState()
          setStatus('Generating description...')
        }
      }

      if (changes.translationText || changes.translationLang) {
        const langRaw = changes.translationLang?.newValue || ''
        const textRaw = changes.translationText?.newValue || ''
        const normalizedLang = langRaw ? resolveLanguageValue(langRaw) : ''
        if (normalizedLang === targetLanguage && textRaw) {
          translationText = textRaw
          showTranslationResult(translationText)
        } else if (!textRaw) {
          translationText = ''
          clearTranslatedText()
        }
      }
    } else if (area === 'local' && changes[TARGET_LANGUAGE_KEY]) {
      targetLanguage = resolveLanguageValue(
        changes[TARGET_LANGUAGE_KEY].newValue
      )
      translationText = ''
      clearTranslatedText()
      void ensureTranslation()
    }
  })

  chrome.runtime.onMessage.addListener(request => {
    if (request?.type === 'ALT_TEXT_GENERATION_STARTED') {
      resetForNewGeneration()
    } else if (request?.type === 'ENGLISH_ALT_TEXT_READY') {
      const message = request.englishText || ''
      if (message) {
        englishText = message
        loadingPanel.setAttribute('hidden', true)
        translationText = ''
        clearTranslatedText()
        updateActionsState()
        void ensureTranslation()
      }
    }
  })

  addCardBtn.addEventListener('click', () => {
    void handleAddCard()
  })

  addAndSaveBtn.addEventListener('click', async () => {
    const saved = await handleAddCard({ openHistory: true })
    if (saved) window.close()
  })

  closeBtn.addEventListener('click', () => {
    window.close()
  })

  if (thumb) {
    thumb.onerror = () => {
      thumb.src = PLACEHOLDER_IMAGE
    }
    if (!thumb.getAttribute('src')) {
      thumb.src = PLACEHOLDER_IMAGE
    }
  }
}

async function init () {
  await initTargetLanguage()
  setupListeners()
  await refreshSnapshot()
  if (!englishText) {
    setStatus('Waiting for the description...')
  }
}

init().catch(error => {
  console.error(error)
  setStatus('Failed to initialise popup.')
})
