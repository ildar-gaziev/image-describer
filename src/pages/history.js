import { getCards, setCards } from '../shared/cards.js'
import {
  LANGUAGES,
  getLanguageLabel,
  resolveLanguageValue
} from '../shared/languages.js'

const gallery = document.getElementById('gallery')
const clearAllBtn = document.getElementById('clearAll')
const refreshBtn = document.getElementById('refresh')
const targetLangSelect = document.getElementById('targetLang')

const TARGET_LANGUAGE_KEY = 'targetLanguage'

let cardsCache = []
const cardIndexMap = new Map()
const uiLanguage = resolveLanguageValue(
  typeof chrome.i18n?.getUILanguage === 'function'
    ? chrome.i18n.getUILanguage()
    : 'en'
)

function buildLanguageOptions (selectedValue) {
  return LANGUAGES.map(({ value, label }) => {
    const selected = value === selectedValue ? ' selected' : ''
    return `<option value="${value}"${selected}>${label}</option>`
  }).join('')
}

function normalizeCard (card) {
  const clone = { ...card }
  let changed = false

  if (!clone.descriptionEn && clone.altText) {
    clone.descriptionEn = clone.altText
    changed = true
  }

  if (!clone.translations) {
    clone.translations = {}
    if (clone.lang && clone.altText) {
      clone.translations[clone.lang] = clone.altText
      changed = true
    }
  }

  if (!clone.targetLanguage) {
    const preferred = resolveLanguageValue(targetLangSelect.value || uiLanguage)
    clone.targetLanguage = preferred
    changed = true
  }

  clone.thumb = clone.thumb || ''
  clone.imageSrc = clone.imageSrc || ''
  clone.pageUrl = clone.pageUrl || ''

  return { card: clone, changed }
}

function populateTargetLanguageSelect (selected) {
  targetLangSelect.innerHTML = buildLanguageOptions(selected)
}

function createCardElement (card) {
  const element = document.createElement('div')
  element.className = 'card'
  element.dataset.id = card.id

  if (card.thumb) {
    const img = document.createElement('img')
    img.alt = 'Card thumbnail'
    img.src = card.thumb
    element.appendChild(img)
  }

  const controls = document.createElement('div')
  controls.className = 'card-controls'

  const select = document.createElement('select')
  select.dataset.role = 'translation-lang'
  select.dataset.id = card.id
  select.title = 'Translation language'
  select.setAttribute('aria-label', 'Translation language')

  const selectedLang = card.targetLanguage || uiLanguage
  select.innerHTML = buildLanguageOptions(selectedLang)

  controls.appendChild(select)

  const practiceBtn = document.createElement('button')
  practiceBtn.type = 'button'
  practiceBtn.className = 'practice-btn'
  practiceBtn.dataset.act = 'practice'
  practiceBtn.dataset.id = card.id
  practiceBtn.title = 'Practice'
  practiceBtn.textContent = '🎧'
  controls.appendChild(practiceBtn)
  const deleteBtn = document.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.dataset.act = 'delete'
  deleteBtn.dataset.id = card.id
  deleteBtn.innerHTML = '&#128465;'
  deleteBtn.setAttribute('aria-label', 'Delete card')
  controls.appendChild(deleteBtn)

  element.appendChild(controls)

  const translationParagraph = document.createElement('p')
  translationParagraph.className = 'translation-text'
  translationParagraph.dataset.role = 'translation-output'
  translationParagraph.dataset.id = card.id

  const initialTranslation = card.translations[selectedLang] || ''
  if (initialTranslation) {
    translationParagraph.hidden = false
    translationParagraph.textContent = initialTranslation
    translationParagraph.setAttribute('lang', selectedLang)
  } else {
    translationParagraph.hidden = true
  }

  element.appendChild(translationParagraph)

  return element
}

async function renderGallery () {
  const cards = await getCards()
  gallery.innerHTML = ''
  cardIndexMap.clear()

  if (!cards.length) {
    const p = document.createElement('p')
    p.textContent = 'No saved cards yet.'
    gallery.appendChild(p)
    cardsCache = []
    return
  }

  let needsSync = false
  cardsCache = cards.map((card, index) => {
    const { card: normalized, changed } = normalizeCard(card)
    cardIndexMap.set(normalized.id, index)
    if (changed) needsSync = true
    return normalized
  })

  if (needsSync) {
    await setCards(cardsCache)
  }

  for (const card of cardsCache) {
    const el = createCardElement(card)
    gallery.appendChild(el)
  }
}

async function translateCard (cardId, specifiedLang) {
  const index = cardIndexMap.get(cardId)
  if (typeof index !== 'number') return

  const card = cardsCache[index]
  const select = gallery.querySelector(
    `select[data-role="translation-lang"][data-id="${cardId}"]`
  )
  const output = gallery.querySelector(
    `p[data-role="translation-output"][data-id="${cardId}"]`
  )

  if (!card || !select || !output) return

  const lang = resolveLanguageValue(specifiedLang || select.value)
  select.value = lang
  card.targetLanguage = lang

  if (lang === 'en') {
    const text = (card.descriptionEn || '').trim()
    card.translations[lang] = text
    output.hidden = false
    if (text) {
      output.textContent = text
      output.setAttribute('lang', 'en')
    } else {
      output.textContent = 'No English description available.'
      output.removeAttribute('lang')
    }
    await setCards(cardsCache)
    return
  }

  const existing = card.translations[lang]
  if (existing) {
    output.hidden = false
    output.textContent = existing
    output.setAttribute('lang', lang)
    await setCards(cardsCache)
    return
  }

  if (!card.descriptionEn) {
    output.hidden = false
    output.textContent = 'No English description available.'
    output.removeAttribute('lang')
    return
  }

  output.hidden = false
  output.textContent = `Translating to ${getLanguageLabel(lang)}...`
  output.removeAttribute('lang')

  try {
    const translator = await Translator.create({
      sourceLanguage: 'en',
      targetLanguage: lang
    })
    const translated = await translator.translate(card.descriptionEn)
    const text =
      typeof translated === 'string'
        ? translated.trim()
        : String(translated || '').trim()
    if (!text) {
      throw new Error('Translation unavailable.')
    }
    card.translations[lang] = text
    output.textContent = text
    output.setAttribute('lang', lang)
    await setCards(cardsCache)
  } catch (error) {
    console.error('Translation failed', error)
    const message =
      error && error.message ? error.message : 'Translation unavailable.'
    output.textContent = message
    output.removeAttribute('lang')
  }
}

gallery.addEventListener('click', async event => {
  const btn = event.target.closest('button[data-act]')
  if (!btn) return
  const { act, id } = btn.dataset

  if (act === 'delete') {
    const index = cardIndexMap.get(id)
    if (typeof index !== 'number') return
    cardsCache.splice(index, 1)
    await setCards(cardsCache)
    await renderGallery()
  } else if (act === 'practice') {
    const url = new URL(chrome.runtime.getURL('pages/practice/practice.html'))
    url.hash = `cardId=${encodeURIComponent(id)}`
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: url.toString() })
        return
      }
    } catch (error) {
      console.warn('Failed to reuse current tab', error)
    }
    window.location.href = url.toString()
  }
})

gallery.addEventListener('change', event => {
  const select = event.target.closest('select[data-role="translation-lang"]')
  if (!select) return
  const cardId = select.dataset.id
  void translateCard(cardId, select.value)
})

clearAllBtn.addEventListener('click', async () => {
  cardsCache = []
  cardIndexMap.clear()
  await setCards([])
  await renderGallery()
})

refreshBtn.addEventListener('click', () => {
  void renderGallery()
})

targetLangSelect.addEventListener('change', async () => {
  const lang = resolveLanguageValue(targetLangSelect.value)
  targetLangSelect.value = lang
  await chrome.storage.local.set({ [TARGET_LANGUAGE_KEY]: lang })
})

async function initTargetLanguageSelector () {
  const stored = await chrome.storage.local.get([TARGET_LANGUAGE_KEY])
  const storedValue = stored[TARGET_LANGUAGE_KEY]
  const selected = resolveLanguageValue(storedValue || uiLanguage)
  populateTargetLanguageSelect(selected)
  if (!storedValue) {
    await chrome.storage.local.set({ [TARGET_LANGUAGE_KEY]: selected })
  }
}

async function init () {
  await initTargetLanguageSelector()
  await renderGallery()
}

init().catch(error => {
  console.error('Failed to initialise history page', error)
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[TARGET_LANGUAGE_KEY]) {
    const nextValue = resolveLanguageValue(changes[TARGET_LANGUAGE_KEY].newValue)
    targetLangSelect.value = nextValue
  }
})
