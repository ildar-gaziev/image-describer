export const MAX_CARDS = 200

export function formatDate (ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

export async function getCards () {
  const { cards } = await chrome.storage.local.get(['cards'])
  return Array.isArray(cards) ? cards : []
}

export async function setCards (cards) {
  await chrome.storage.local.set({ cards })
}

export async function getSessionSnapshot () {
  const {
    altTextEn,
    altText,
    translationText,
    translationLang,
    imageSrc,
    thumbDataUrl,
    pageUrl
  } =
    await chrome.storage.session.get([
      'altTextEn',
      'altText',
      'translationText',
      'translationLang',
      'imageSrc',
      'thumbDataUrl',
      'pageUrl'
    ])
  return {
    altTextEn: altTextEn || altText || '',
    translationText: translationText || '',
    translationLang: translationLang || '',
    imageSrc: imageSrc || '',
    thumbDataUrl: thumbDataUrl || '',
    pageUrl: pageUrl || ''
  }
}

export function cardFromSession (
  snap,
  { englishText, translationLang, translationText } = {}
) {
  const descriptionEn =
    typeof englishText === 'string' && englishText.length
      ? englishText
      : snap.altTextEn || ''

  const primaryTranslationLang =
    typeof translationLang === 'string' ? translationLang : snap.translationLang

  const primaryTranslationText =
    typeof translationText === 'string' && translationText.length
      ? translationText
      : snap.translationText || ''

  if (!descriptionEn && !snap.imageSrc && !snap.thumbDataUrl) return null

  const translations =
    primaryTranslationLang && primaryTranslationText
      ? { [primaryTranslationLang]: primaryTranslationText }
      : {}

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: Date.now(),
    descriptionEn,
    translations,
    targetLanguage: primaryTranslationLang || '',
    thumb:
      snap.thumbDataUrl ||
      (snap.imageSrc && !snap.imageSrc.startsWith('blob:')
        ? snap.imageSrc
        : ''),
    imageSrc: snap.imageSrc,
    pageUrl: snap.pageUrl
  }
}

export async function saveCard (card) {
  const arr = await getCards()
  arr.unshift(card)
  if (arr.length > MAX_CARDS) arr.length = MAX_CARDS
  await setCards(arr)
}

export async function saveCurrentCard (options) {
  const snap = await getSessionSnapshot()
  const card = cardFromSession(snap, options)
  if (!card) return false
  await saveCard(card)
  return true
}
