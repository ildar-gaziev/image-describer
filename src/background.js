const SESSION_KEYS = [
  'altTextEn',
  'translationText',
  'translationLang',
  'imageSrc',
  'thumbDataUrl',
  'pageUrl'
]
const CONTEXT_MENU_IDS = Object.freeze({
  describeImage: 'describe-image-for-alt',
  openHistory: 'open-alt-history'
})
const THUMB_MAX_DIMENSION = 320

const sessionStore =
  (chrome.storage && chrome.storage.session) ||
  (chrome.storage && chrome.storage.local) ||
  null

async function cacheSessionSnapshot (payload = {}, sender) {
  if (!sessionStore) return

  const {
    englishAltText,
    altText,
    translationText = '',
    translationLang = '',
    imageSrc = '',
    thumbDataUrl = '',
    pageUrl = ''
  } = payload

  const resolvedPageUrl = pageUrl || sender?.tab?.url || ''

  await sessionStore.set({
    altTextEn: englishAltText ?? altText ?? '',
    translationText,
    translationLang,
    imageSrc,
    thumbDataUrl,
    pageUrl: resolvedPageUrl
  })
}

async function clearSessionSnapshot () {
  if (!sessionStore) return
  try {
    await sessionStore.remove(SESSION_KEYS)
  } catch {
    const emptyValues = Object.fromEntries(
      SESSION_KEYS.map(key => [key, ''])
    )
    await sessionStore.set(emptyValues)
  }
}

async function openHistoryPage () {
  const url = chrome.runtime.getURL('pages/history.html')
  try {
    const existingTabs = await chrome.tabs
      .query({ url: [`${url}*`] })
      .catch(() => [])

    const targetTab = existingTabs.find(tab => !tab.pendingUrl)

    if (targetTab) {
      await chrome.tabs.update(targetTab.id, { active: true })
      if (typeof targetTab.windowId === 'number') {
        chrome.windows
          .update(targetTab.windowId, { focused: true })
          .catch(() => {})
      }
      await chrome.tabs.reload(targetTab.id, { bypassCache: true }).catch(
        () => {}
      )
      return
    }

    await chrome.tabs.create({ url })
  } catch (error) {
    console.error('Failed to open history page', error)
  }
}

function ensureContextMenus () {
  if (!chrome.contextMenus?.create) return
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.describeImage,
      title: 'Generate image description',
      contexts: ['image']
    })
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.openHistory,
      title: 'Open ALT history',
      contexts: ['action']
    })
  })
}

function setActionPopup (popupPath) {
  if (!chrome.action?.setPopup) return Promise.resolve()
  return chrome.action.setPopup({ popup: popupPath })
}

async function openAltTextPopup () {
  if (!chrome.action?.openPopup) return
  try {
    await setActionPopup('popup/popup.html')
    await chrome.action.openPopup()
  } catch (error) {
    console.warn('Failed to open popup automatically', error)
  } finally {
    setActionPopup('').catch(() => {})
  }
}

async function collectImageDetailsFromPage (tabId, srcUrl) {
  if (!chrome.scripting?.executeScript || !tabId) return null
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [srcUrl, THUMB_MAX_DIMENSION],
      func: (url, maxDimension) => {
        const images = Array.from(document.images || [])
        const match = images.find(img => {
          try {
            return img.currentSrc === url || img.src === url
          } catch {
            return false
          }
        })
        if (!match) {
          return { thumbDataUrl: '', altText: '' }
        }

        const altCandidates = [
          match.getAttribute('alt'),
          match.getAttribute('aria-label'),
          match.getAttribute('title')
        ]
        const altText =
          altCandidates
            .map(text => (typeof text === 'string' ? text.trim() : ''))
            .find(Boolean) || ''

        let thumbDataUrl = ''
        try {
          const naturalWidth = match.naturalWidth || match.width || 0
          const naturalHeight = match.naturalHeight || match.height || 0
          if (naturalWidth && naturalHeight) {
            const scale =
              naturalWidth > naturalHeight
                ? Math.min(1, maxDimension / naturalWidth)
                : Math.min(1, maxDimension / naturalHeight)
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(naturalWidth * scale))
            canvas.height = Math.max(1, Math.round(naturalHeight * scale))
            const ctx = canvas.getContext('2d')
            ctx.drawImage(match, 0, 0, canvas.width, canvas.height)
            thumbDataUrl = canvas.toDataURL('image/jpeg', 0.85)
          }
        } catch (error) {
          console.warn('Unable to render thumbnail', error)
        }

        return { thumbDataUrl, altText }
      }
    })
    return result || null
  } catch (error) {
    console.warn('Failed to collect image details', error)
    return null
  }
}

async function generateAltText (imgSrc) {
  if (!self?.LanguageModel?.create) {
    throw new Error('LanguageModel API unavailable')
  }

  const session = await self.LanguageModel.create({
    temperature: 0.0,
    topK: 1.0,
    expectedInputs: [{ type: 'image' }]
  })

  const response = await fetch(imgSrc)
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`)
  }

  const blob = await response.blob()
  const imageBitmap = await createImageBitmap(blob)

  const prompt = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          value:
            'Provide an objective description of this image in around 30 words using an object-action-context structure. Include important visible text if present. Avoid starting with "The image".'
        },
        { type: 'image', value: imageBitmap }
      ]
    }
  ]

  const result = await session.prompt(prompt)
  if (typeof result === 'string') return result.trim()
  const output = result?.output
  if (!output) return ''
  if (typeof output === 'string') return output.trim()
  if (Array.isArray(output)) {
    return output
      .map(part => (typeof part === 'string' ? part : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return String(output || '').trim()
}

async function describeImageFromContext (info, tab) {
  if (!info?.srcUrl || !tab?.id) return

  const imageSrc = info.srcUrl
  const pageUrl = info.pageUrl || tab.url || ''

  await cacheSessionSnapshot(
    {
      englishAltText: '',
      translationText: '',
      translationLang: '',
      imageSrc: '',
      thumbDataUrl: '',
      pageUrl
    },
    { tab }
  )

  chrome.runtime
    .sendMessage({
      type: 'ALT_TEXT_GENERATION_STARTED',
      imageSrc
    })
    .catch(() => {})

  const openPopupPromise = openAltTextPopup()

  const [altResult, detailsResult] = await Promise.allSettled([
    generateAltText(imageSrc),
    collectImageDetailsFromPage(tab.id, imageSrc)
  ])

  const englishAltText =
    altResult.status === 'fulfilled' ? altResult.value : ''
  if (altResult.status === 'rejected') {
    console.error('Failed to generate alt text', altResult.reason)
  }

  const details =
    detailsResult.status === 'fulfilled' ? detailsResult.value : null
  if (detailsResult.status === 'rejected') {
    console.warn('Failed to gather image details', detailsResult.reason)
  }

  const fallbackAlt = details?.altText || ''
  const thumbDataUrl = details?.thumbDataUrl || ''

  await cacheSessionSnapshot(
    {
      englishAltText: englishAltText || fallbackAlt,
      translationText: '',
      translationLang: '',
      imageSrc,
      thumbDataUrl,
      pageUrl
    },
    { tab }
  )

  chrome.runtime.sendMessage({
    type: 'ENGLISH_ALT_TEXT_READY',
    englishText: englishAltText || fallbackAlt
  })

  await openPopupPromise
}

chrome.runtime.onInstalled.addListener(() => {
  clearSessionSnapshot().catch(() => {})

  ensureContextMenus()
  setActionPopup('').catch(() => {})
})

chrome.runtime.onStartup?.addListener(() => {
  clearSessionSnapshot().catch(() => {})
  ensureContextMenus()
  setActionPopup('').catch(() => {})
})

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_IDS.openHistory) {
      openHistoryPage().catch(() => {})
    } else if (info.menuItemId === CONTEXT_MENU_IDS.describeImage) {
      describeImageFromContext(info, tab).catch(error => {
        console.error('Failed to process image from context menu', error)
      })
    }
  })
}

if (chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(() => {
    openHistoryPage().catch(error => {
      console.error('Failed to open history from action click', error)
    })
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return

  if (message.type === 'ALT_TEXT_RESULT') {
    cacheSessionSnapshot(message.payload, sender)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  }

  if (message.type === 'CLEAR_ALT_TEXT_RESULT') {
    clearSessionSnapshot()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  }

  if (message.type === 'OPEN_HISTORY_PAGE') {
    openHistoryPage()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  }
})

setActionPopup('').catch(() => {})
ensureContextMenus()
